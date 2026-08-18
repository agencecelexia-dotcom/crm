-- « En attente » est un SOUS-STATUT, pas une étape du parcours.
--
-- Symptôme constaté : des chantiers affichés « devis signé » ET « en attente »
-- en même temps, alors que l'artisan n'avait jamais cliqué sur « en attente ».
-- Trois dossiers signés (5 226 €, 7 827 €, 8 166 €) étaient dans ce cas, et
-- 60 affectations au total avaient un `statut` en contradiction avec leur
-- `etape` réelle.
--
-- Cause : `add_suivi_by_token` écrasait `affectations.statut` avec la valeur
-- déclarée, quelle qu'elle soit. Or « en attente » ne dit pas où en est le
-- chantier — il dit que l'artisan met le dossier en pause. Écrit dans la même
-- colonne que « devis envoyé » ou « RDV pris », il effaçait l'avancement.
--
-- `appliquer_etape` (0074) traitait déjà correctement ce cas en posant
-- `en_attente_depuis` sans toucher à l'étape. On aligne la seconde porte
-- d'entrée sur la première.

create or replace function public.add_suivi_by_token(
  p_token text,
  p_statut text default null,
  p_message text default null,
  p_date_rdv timestamptz default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  af public.affectations;
begin
  select * into af from public.affectations where token = p_token and retire_at is null;
  if af.id is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;

  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false, 'error', 'rien_a_enregistrer');
  end if;

  -- Statuts déclarables par l'ARTISAN. « mort » est réservé à l'agence :
  -- l'artisan ne décide pas qu'un lead est définitivement perdu pour tous.
  if coalesce(p_statut, '') <> '' and p_statut not in
     ('contacte', 'rdv_pris', 'en_attente', 'devis_envoye', 'devis_signe', 'termine', 'perdu') then
    return json_build_object('ok', false, 'error', 'statut_non_autorise');
  end if;

  -- Un abandon doit être motivé : sans justification, le lead n'est pas
  -- exploitable pour comprendre pourquoi il a échoué.
  if p_statut = 'perdu' and coalesce(btrim(p_message), '') = '' then
    return json_build_object('ok', false, 'error', 'motif_requis');
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (
    af.projet_id, af.id, 'artisan',
    case when coalesce(p_statut, '') <> '' then 'statut' else 'note' end,
    nullif(p_statut, ''), nullif(p_message, '')
  );

  -- « En attente » est un DRAPEAU, pas une étape : il marque une pause sans
  -- effacer l'avancement. Un chantier dont le devis est parti reste « devis
  -- envoyé » même si l'artisan le met en pause — sinon on perd l'information
  -- la plus utile du dossier.
  if p_statut = 'en_attente' then
    update public.affectations
       set en_attente_depuis = coalesce(en_attente_depuis, now())
     where id = af.id;

    return json_build_object('ok', true, 'sous_statut', 'en_attente');
  end if;

  if coalesce(p_statut, '') <> '' then
    update public.affectations
      set statut = p_statut,
          -- Toute étape déclarée lève la pause : l'artisan a repris la main.
          en_attente_depuis = null,
          date_rdv = case when p_statut = 'rdv_pris' and p_date_rdv is not null
                          then p_date_rdv else date_rdv end,
          -- Horodate la perte (compte à rebours des 15 jours) ; repartir sur un
          -- autre statut remet le chantier dans le pipe.
          perdu_at = case when p_statut = 'perdu' then coalesce(perdu_at, now()) else null end
      where id = af.id;
    select * into af from public.affectations where id = af.id;

    perform net.http_post(
      url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
      body := jsonb_build_object(
        'event', 'changement_statut',
        'statut', p_statut,
        'artisan', (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id),
        'client_nom', (select p.client_nom from public.projets p where p.id = af.projet_id),
        'client_ville', (select p.client_ville from public.projets p where p.id = af.projet_id),
        'metier', (select p.metier from public.projets p where p.id = af.projet_id),
        'lien', 'https://crm-ci7k.vercel.app/projets/' || af.projet_id
      )
    );
  end if;

  if p_statut = 'devis_signe' then
    -- Un devis signé par un artisan ne fait pas disparaître le chantier pour
    -- les autres : on note simplement le gagnant au niveau du projet.
    update public.projets
      set artisan_id = af.artisan_id, statut = 'devis_signe',
          montant_devis_signe = af.montant_devis_signe
      where id = af.projet_id;

  elsif p_statut in ('contacte', 'rdv_pris', 'devis_envoye', 'termine', 'perdu') then
    if exists (select 1 from public.affectations af2
                where af2.projet_id = af.projet_id and af2.statut <> 'perdu'
                  and af2.retire_at is null) then
      -- Au moins un artisan encore actif : le projet prend le meilleur statut actif.
      update public.projets p set statut = (
        select af2.statut from public.affectations af2
         where af2.projet_id = p.id and af2.statut <> 'perdu' and af2.retire_at is null
         order by case af2.statut
                    when 'termine' then 6 when 'devis_signe' then 5
                    when 'devis_envoye' then 4 when 'rdv_pris' then 3
                    when 'contacte' then 2 else 1 end desc
         limit 1)
      where p.id = af.projet_id and p.statut not in ('mort', 'devis_signe', 'termine');
    else
      -- Plus aucun artisan actif : le chantier retourne dans le pipe agence
      -- (statut 'nouveau', détaché de l'artisan). Un projet déjà déclaré
      -- mort le reste.
      update public.projets set statut = 'nouveau', artisan_id = null
       where id = af.projet_id and statut <> 'mort';
    end if;
  end if;

  return json_build_object('ok', true);
end;
$$;

-- `revoke ... from public` seul ne suffit pas sur Supabase : `alter default
-- privileges` réaccorde EXECUTE à `anon`, qu'il faut donc nommer avant de le
-- réattribuer explicitement.
revoke execute on function public.add_suivi_by_token(text, text, text, timestamptz) from public, anon;
grant execute on function public.add_suivi_by_token(text, text, text, timestamptz) to anon;

-- ---------------------------------------------------------------------------
-- Rattrapage des 60 affectations dont le statut contredit l'étape.
--
-- L'étape fait foi : elle est reconstruite depuis l'historique des suivis
-- (0073) et n'a jamais été écrasée. Le drapeau d'attente est conservé pour
-- celles qui étaient réellement en pause — on ne perd aucune information.
update public.affectations af
   set en_attente_depuis = coalesce(af.en_attente_depuis, af.updated_at, now()),
       statut = af.etape
 where af.retire_at is null
   and af.statut = 'en_attente'
   and af.etape is not null;
