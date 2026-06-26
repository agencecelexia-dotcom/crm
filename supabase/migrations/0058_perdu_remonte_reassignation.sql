-- 0058 — Artisan seul qui declare « perdu » : le dossier REMONTE pour reassignation.
-- Au lieu de finir « perdu », quand plus aucun artisan n'est actif sur un chantier,
-- le projet repasse en 'nouveau' (pile a attribuer), se detache de l'artisan, et une
-- notification interne 'a_reassigner' est creee. (add_suivi_by_token regenere + patche)

CREATE OR REPLACE FUNCTION public.add_suivi_by_token(p_token text, p_statut text DEFAULT NULL::text, p_message text DEFAULT NULL::text, p_date_rdv timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    if exists (select 1 from public.affectations af2
               where af2.projet_id = af.projet_id and af2.statut <> 'perdu') then
      -- Au moins un artisan encore actif : le projet prend le meilleur statut actif.
      update public.projets p set statut = (
        select af2.statut from public.affectations af2
        where af2.projet_id = p.id and af2.statut <> 'perdu'
        order by case af2.statut
          when 'termine' then 5 when 'devis_signe' then 4 when 'devis_envoye' then 3
          when 'rdv_pris' then 2 when 'contacte' then 1 else 0 end desc
        limit 1)
      where p.id = af.projet_id;
    else
      -- PLUS AUCUN artisan actif (tous perdu, ex. artisan seul qui abandonne) :
      -- le dossier REMONTE pour reassignation rapide -> statut 'nouveau'
      -- (de retour dans la pile a attribuer), detache de l'artisan.
      update public.projets set statut = 'nouveau', artisan_id = null
        where id = af.projet_id;
      insert into public.notifications (type, titre, message, projet_id)
      values ('a_reassigner',
        'A reassigner : ' || coalesce((select client_nom from public.projets where id = af.projet_id), 'chantier'),
        'Plus aucun artisan actif (declare perdu). A reattribuer rapidement.'
          || case when coalesce(btrim(p_message), '') <> '' then ' Raison : ' || btrim(p_message) else '' end,
        af.projet_id);
    end if;
  end if;

  return json_build_object('ok', true);
end;
$function$
;
