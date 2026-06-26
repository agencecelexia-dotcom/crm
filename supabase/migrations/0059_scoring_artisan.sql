-- ============================================================================
-- 0059 — Scoring artisan (INTERNE, jamais exposé à l'artisan)
-- ----------------------------------------------------------------------------
-- 2 notes qualitatives saisies à la main par l'agence (1-5) :
--   note_elocution            = « comment il parle » (expression, contact client)
--   note_communication_agence = réactivité / qualité d'échange avec l'agence
-- + RPC scoring_artisan() qui calcule les métriques AUTO depuis l'historique :
--   vitesse (contact + devis), taux de transfo, duels gagnés face à nos artisans.
-- Pas de score global, pas de classement, pas de solvabilité (choix produit).
-- ============================================================================

alter table public.artisans
  add column if not exists note_elocution smallint check (note_elocution between 1 and 5),
  add column if not exists note_communication_agence smallint check (note_communication_agence between 1 and 5);

create or replace function public.scoring_artisan(p_artisan_id uuid)
returns json
language sql stable security definer set search_path to 'public'
as $function$
with aff as (
  select a.id, a.projet_id, a.created_at,
    -- a-t-il (au moins) envoyé un devis ? (statut courant OU url OU jalon historique)
    (a.statut in ('devis_envoye','devis_signe','termine') or a.devis_url is not null
       or exists (select 1 from suivis s where s.affectation_id = a.id and s.statut_artisan = 'devis_envoye')) as a_envoye,
    -- a-t-il signé ?
    (a.statut in ('devis_signe','termine') or a.devis_signe_url is not null
       or exists (select 1 from suivis s where s.affectation_id = a.id and s.statut_artisan = 'devis_signe')) as a_signe
  from affectations a
  where a.artisan_id = p_artisan_id
),
contact as ( -- 1er contact (contacte / rdv_pris) par affectation
  select af.id, min(s.created_at) c
  from aff af join suivis s on s.affectation_id = af.id and s.statut_artisan in ('contacte','rdv_pris')
  group by af.id
),
devis as ( -- 1er devis envoyé par affectation
  select af.id, min(s.created_at) d
  from aff af join suivis s on s.affectation_id = af.id and s.statut_artisan = 'devis_envoye'
  group by af.id
),
vit as (
  select
    round(avg(extract(epoch from (c.c - af.created_at))/3600.0)
          filter (where c.c is not null)::numeric, 1) h_contact,
    count(c.c) n_contact,
    round(avg(extract(epoch from (d.d - af.created_at))/3600.0)
          filter (where d.d is not null)::numeric, 1) h_devis,
    count(d.d) n_devis
  from aff af
  left join contact c on c.id = af.id
  left join devis d on d.id = af.id
),
ff as ( -- duels : projets multi-artisans où quelqu'un a signé
  select
    af.projet_id,
    (select count(*) from affectations x where x.projet_id = af.projet_id) n_art,
    af.a_signe moi_gagne,
    exists (
      select 1 from affectations y where y.projet_id = af.projet_id
      and (y.statut in ('devis_signe','termine') or y.devis_signe_url is not null
           or exists (select 1 from suivis s where s.affectation_id = y.id and s.statut_artisan = 'devis_signe'))
    ) qqn_signe
  from aff af
)
select json_build_object(
  'note_elocution', (select note_elocution from artisans where id = p_artisan_id),
  'note_communication_agence', (select note_communication_agence from artisans where id = p_artisan_id),
  'nb_projets', (select count(*) from aff),
  'vitesse', (select json_build_object(
      'h_contact', h_contact, 'n_contact', n_contact,
      'h_devis', h_devis, 'n_devis', n_devis) from vit),
  'transfo', (select json_build_object(
      'n_devis_envoyes', count(*) filter (where a_envoye),
      'n_signes', count(*) filter (where a_signe)) from aff),
  'face_a_face', (select json_build_object(
      'n_duels', count(*) filter (where n_art >= 2 and qqn_signe),
      'n_gagnes', count(*) filter (where n_art >= 2 and qqn_signe and moi_gagne)) from ff)
);
$function$;

grant execute on function public.scoring_artisan(uuid) to authenticated, service_role;
