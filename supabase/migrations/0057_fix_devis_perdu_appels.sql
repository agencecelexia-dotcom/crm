-- ============================================================================
-- 0057 — Corrections statuts artisan + justification perdu + log d'appel
-- ----------------------------------------------------------------------------
-- BUG 1 : quand un artisan déclarait « devis_signe », add_suivi_by_token
--   SUPPRIMAIT toutes les autres affectations du projet (delete ... id <> af.id).
--   → un seul artisan signe et tous les autres « sautent ». CORRIGÉ : on ne
--   supprime plus rien ; on enregistre juste le gagnant au niveau projet.
-- BUG 2 : un projet « perdu » était purgé (hard delete) 48 h plus tard par un
--   cron. → un projet pouvait disparaître alors que d'autres artisans étaient
--   encore dessus. CORRIGÉ : on désactive la purge (plus de suppression auto).
-- AJOUT 3 : déclarer « perdu » exige désormais une justification écrite.
-- AJOUT 4 : l'artisan peut logguer une tentative d'appel (ex : pas de réponse).
-- ============================================================================

-- ---------- BUG 2 : on enlève la suppression automatique des perdus ----------
do $$ begin perform cron.unschedule('purge-projets-perdus'); exception when others then null; end $$;

-- ---------- AJOUT 4 : le type 'appel' devient un type de suivi valide --------
alter table public.suivis drop constraint if exists suivis_type_check;
alter table public.suivis add constraint suivis_type_check
  check (type = any (array['statut','note','appel']));

-- ---------- BUG 1 + AJOUT 3 : add_suivi_by_token réécrit -------------------
create or replace function public.add_suivi_by_token(
  p_token text, p_statut text default null, p_message text default null,
  p_date_rdv timestamp with time zone default null
) returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false);
  end if;

  -- AJOUT 3 : justification écrite OBLIGATOIRE pour déclarer « perdu ».
  if p_statut = 'perdu' and coalesce(btrim(p_message), '') = '' then
    return json_build_object('ok', false, 'error', 'justification_requise');
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (
    af.projet_id, af.id, 'artisan',
    case when coalesce(p_statut, '') <> '' then 'statut' else 'note' end,
    nullif(p_statut, ''), nullif(p_message, '')
  );

  if coalesce(p_statut, '') <> '' then
    update public.affectations
      set statut = p_statut,
          date_rdv = case when p_statut = 'rdv_pris' and p_date_rdv is not null
                          then p_date_rdv else date_rdv end
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
    -- BUG 1 CORRIGÉ : on NE supprime PLUS les autres affectations.
    -- Un devis signé par un artisan ne doit pas faire disparaître le chantier
    -- pour les autres. On note simplement le gagnant au niveau du projet.
    update public.projets
      set artisan_id = af.artisan_id, statut = 'devis_signe',
          montant_devis_signe = af.montant_devis_signe
      where id = af.projet_id;
  elsif p_statut in ('contacte', 'rdv_pris', 'en_attente', 'devis_envoye', 'termine', 'perdu') then
    -- Statut projet = meilleur statut parmi les affectations encore actives.
    -- Devient « perdu » seulement si TOUTES les affectations sont perdu.
    update public.projets p set statut = coalesce(
      (
        select af2.statut from public.affectations af2
        where af2.projet_id = p.id and af2.statut <> 'perdu'
        order by case af2.statut
          when 'termine' then 5 when 'devis_signe' then 4 when 'devis_envoye' then 3
          when 'rdv_pris' then 2 when 'contacte' then 1 else 0 end desc
        limit 1
      ),
      'perdu'
    )
    where p.id = af.projet_id;
  end if;

  return json_build_object('ok', true);
end;
$function$;

-- ---------- AJOUT 4 : log d'une tentative d'appel par l'artisan -------------
create or replace function public.log_appel_by_token(
  p_token text, p_resultat text default 'pas_de_reponse', p_message text default null
) returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare af public.affectations; v_txt text;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  v_txt := case p_resultat
    when 'pas_de_reponse' then '📞 Appel — pas de réponse'
    when 'repondu'        then '📞 Appel — client joint'
    when 'rappeler'       then '📞 Appel — à rappeler plus tard'
    when 'faux_numero'    then '📞 Appel — numéro injoignable / invalide'
    else '📞 Appel' end;
  if coalesce(btrim(p_message), '') <> '' then
    v_txt := v_txt || ' — ' || btrim(p_message);
  end if;
  insert into public.suivis (projet_id, affectation_id, auteur, type, message)
  values (af.projet_id, af.id, 'artisan', 'appel', v_txt);
  return json_build_object('ok', true);
end;
$function$;

grant execute on function public.log_appel_by_token(text,text,text) to anon, authenticated, service_role;
