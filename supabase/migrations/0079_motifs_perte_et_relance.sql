-- ============================================================
--  0079 — P1-10 : motifs de perte normalisés + relance différée.
--
--  CONSTAT (audit §8) : 44 dossiers perdus, soit 40 % du volume transmis,
--  traités comme une corbeille. Les motifs sont en texte libre, donc
--  inexploitables : impossible de sortir « X % perdus sur le prix »,
--  « Y % de doublons », « Z % injoignables ».
--
--  Deux réalités opposées sont aujourd'hui confondues sous le même libellé :
--   • le CLIENT a dit non ou signé ailleurs  → interroge l'artisan ;
--   • l'ARTISAN a refusé le lead (hors zone, doublon, pas rentable)
--                                            → interroge la qualité des leads.
--  D'où la colonne `origine_perte`, qui sépare les deux.
--
--  CONSTAT complémentaire : plusieurs motifs en texte libre disent « dans
--  6 mois », « rappel 3 mois ». Sans champ date, ce CA part à la poubelle.
--  → `recontacter_le` remet le dossier dans le flux automatiquement.
--
--  ⚠️ Le texte libre existant est CONSERVÉ dans `motif_perte_detail` : rien
--  n'est écrasé, on ajoute seulement une dimension exploitable à côté.
-- ============================================================

alter table public.affectations
  add column if not exists motif_perte text,
  add column if not exists motif_perte_detail text,
  add column if not exists origine_perte text,
  add column if not exists recontacter_le date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'affectations_motif_perte_check') then
    alter table public.affectations add constraint affectations_motif_perte_check
      check (motif_perte is null or motif_perte in (
        'prix_trop_eleve',      -- le client trouve le devis trop cher
        'budget_insuffisant',   -- le client n'a pas les moyens du projet
        'delai_incompatible',   -- planning inconciliable
        'signe_concurrent',     -- le client a signé ailleurs
        'client_injoignable',   -- jamais réussi à le joindre
        'client_renonce',       -- le client abandonne son projet
        'hors_zone',            -- trop loin pour l'artisan
        'doublon',              -- lead déjà reçu
        'hors_competence',      -- métier non couvert
        'non_eligible_aides',   -- le projet ne passe pas sans les aides
        'autre'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'affectations_origine_perte_check') then
    alter table public.affectations add constraint affectations_origine_perte_check
      check (origine_perte is null or origine_perte in ('client', 'artisan'));
  end if;
end $$;

comment on column public.affectations.motif_perte is
  'Motif normalisé, exploitable statistiquement. Le commentaire libre reste '
  'dans motif_perte_detail.';
comment on column public.affectations.origine_perte is
  'client = le client a dit non ou signé ailleurs (interroge l''artisan) ; '
  'artisan = le lead a été refusé (interroge la qualité des leads de l''agence).';
comment on column public.affectations.recontacter_le is
  'Relance différée : le dossier revient automatiquement dans le flux à cette '
  'date. Sans ce champ, les « rappeler dans 6 mois » se perdaient en note libre.';

-- L'origine se déduit du motif : elle n'est pas à saisir deux fois.
create or replace function public.origine_du_motif(p_motif text)
returns text language sql immutable as $$
  select case p_motif
    when 'hors_zone'        then 'artisan'
    when 'doublon'          then 'artisan'
    when 'hors_competence'  then 'artisan'
    when 'delai_incompatible' then 'artisan'
    when 'prix_trop_eleve'  then 'client'
    when 'budget_insuffisant' then 'client'
    when 'signe_concurrent' then 'client'
    when 'client_injoignable' then 'client'
    when 'client_renonce'   then 'client'
    when 'non_eligible_aides' then 'client'
    else null end;
$$;

-- ---------- Retrait enrichi ----------
-- Surcharge à 4 arguments : l'ancienne signature à 2 arguments reste en place,
-- donc le front déployé continue de fonctionner pendant la transition.
create or replace function public.retirer_chantier_by_token(
  p_token text, p_raison text, p_motif text, p_recontacter_le date
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare af public.affectations; v_garde json; v_restants int;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if af.retire_at is not null then return json_build_object('ok', true, 'deja_retire', true); end if;

  if length(coalesce(btrim(p_raison), '')) < 5 then
    return json_build_object('ok', false, 'error', 'justification_requise');
  end if;
  if p_motif is null then
    return json_build_object('ok', false, 'error', 'motif_requis');
  end if;

  v_garde := public.peut_abandonner_affectation(af.id);
  if (v_garde->>'ok')::boolean is false then
    return json_build_object('ok', false, 'error', v_garde->>'raison');
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (af.projet_id, af.id, 'artisan', 'retrait', 'perdu', btrim(p_raison));

  update public.affectations
     set statut = 'perdu', retire_at = now(), issue = 'perdu',
         motif_perte = p_motif,
         motif_perte_detail = btrim(p_raison),
         origine_perte = public.origine_du_motif(p_motif),
         recontacter_le = p_recontacter_le
   where id = af.id;

  select count(*) into v_restants
    from public.affectations af2
   where af2.projet_id = af.projet_id and af2.issue <> 'perdu' and af2.retire_at is null;

  if v_restants = 0 then
    update public.projets
       set statut = 'nouveau', artisan_id = null,
           montant_devis_signe = null, montant_devis = null
     where id = af.projet_id and statut <> 'mort';

    insert into public.notifications (type, titre, message, projet_id)
    values ('a_reassigner',
      'À réassigner : ' || coalesce((select client_nom from public.projets where id = af.projet_id), 'chantier'),
      'Motif : ' || p_motif || ' — ' || btrim(p_raison), af.projet_id);
  end if;

  insert into public.notifications (type, titre, message, projet_id)
  values ('artisan_retrait',
    'Retrait artisan : ' || coalesce(
      (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id), 'artisan'),
    p_motif || ' — ' || btrim(p_raison), af.projet_id);

  return json_build_object('ok', true, 'restants', v_restants);
end;
$function$;

revoke execute on function public.retirer_chantier_by_token(text, text, text, date) from public;
grant  execute on function public.retirer_chantier_by_token(text, text, text, date)
  to anon, authenticated;

-- ---------- Statistiques de perte, pour l'agence ----------
create or replace function public.stats_pertes(p_artisan_id uuid default null)
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  with perdus as (
    select af.* from public.affectations af
    join public.projets p on p.id = af.projet_id
    where af.issue = 'perdu' and p.deleted_at is null
      and (p_artisan_id is null or af.artisan_id = p_artisan_id)
  )
  select json_build_object(
    'total', (select count(*) from perdus),
    'non_qualifies', (select count(*) from perdus where motif_perte is null),
    'par_motif', (select coalesce(json_agg(json_build_object(
                     'motif', motif, 'origine', public.origine_du_motif(motif),
                     'nb', nb, 'montant', montant) order by nb desc), '[]'::json)
                  from (select motif_perte motif, count(*)::int nb,
                               coalesce(sum(montant_devis), 0) montant
                        from perdus where motif_perte is not null
                        group by 1) t),
    'par_origine', (select coalesce(json_object_agg(og, nb), '{}'::json)
                    from (select public.origine_du_motif(motif_perte) og, count(*)::int nb
                          from perdus where motif_perte is not null
                          group by 1) t),
    'a_recontacter', (select count(*) from perdus
                       where recontacter_le is not null and recontacter_le <= current_date),
    'montant_total_perdu', (select coalesce(sum(montant_devis), 0) from perdus)
  );
$function$;

revoke execute on function public.stats_pertes(uuid) from public, anon;
grant  execute on function public.stats_pertes(uuid) to authenticated, service_role;

-- ---------- Relance différée : le dossier revient tout seul ----------
create or replace function public.traiter_recontacts()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; n int := 0;
begin
  for r in
    select af.id, af.projet_id, af.artisan_id, p.client_nom
    from public.affectations af
    join public.projets p on p.id = af.projet_id
    where af.recontacter_le is not null
      and af.recontacter_le <= current_date
      and af.issue = 'perdu'
      and p.deleted_at is null
      and p.statut <> 'mort'
  loop
    insert into public.notifications (type, titre, message, projet_id)
    values ('a_recontacter',
      'À recontacter : ' || coalesce(r.client_nom, 'chantier'),
      'La date de relance différée est atteinte. Le dossier peut être remis dans le flux.',
      r.projet_id);

    -- La date est consommée : on ne notifie qu'une fois.
    update public.affectations set recontacter_le = null where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke execute on function public.traiter_recontacts() from public, anon;
grant  execute on function public.traiter_recontacts() to service_role;

select cron.unschedule('recontacts_tick')
 where exists (select 1 from cron.job where jobname = 'recontacts_tick');
select cron.schedule('recontacts_tick', '0 7 * * *',
  $$ select public.traiter_recontacts(); $$);
