-- Sépare les deux pipes : le neuf et la reprise.
--
-- LE PROBLÈME
--
-- Quand un artisan rend un chantier, le projet retourne au statut `nouveau` —
-- exactement comme un lead qui n'a jamais été traité. Les deux flux sont donc
-- indistinguables dans la donnée elle-même.
--
-- Mesuré en production : sur 76 projets affichés « nouveau », 61 sont des
-- retours d'artisan et 15 seulement sont réellement neufs. Toutes les
-- statistiques d'entrée étaient fausses, et un commercial ne pouvait pas
-- distinguer ce qui le rémunère (la reprise) de ce qui ne le rémunère pas.
--
-- LA SOLUTION
--
-- Une colonne `origine` maintenue par trigger, qui dit d'où vient le chantier
-- indépendamment de son statut d'avancement. Les deux axes sont orthogonaux :
-- `statut` dit OÙ EN EST le chantier, `origine` dit D'OÙ IL VIENT.

-- ---------- 1) La colonne ----------

alter table public.projets
  add column if not exists origine text not null default 'neuf';

comment on column public.projets.origine is
  'D''où vient le chantier, indépendamment de son avancement : '
  'neuf = jamais parti chez un artisan · chez_artisan = au moins un artisan '
  'travaille dessus · reprise = tous les artisans sont sortis, à replacer. '
  'Maintenue par trg_origine_chantier. Le commercial n''est commissionné que '
  'sur les reprises.';

-- ---------- 2) Le calcul, en un seul endroit ----------

create or replace function public.calculer_origine(p_projet_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    -- Aucune affectation : le chantier n'est jamais parti.
    when not exists (
      select 1 from public.affectations a where a.projet_id = p_projet_id
    ) then 'neuf'
    -- Au moins un artisan travaille encore dessus. Un chantier « rendu par
    -- Batryx » mais repris par un autre artisan n'est PAS à replacer : le
    -- commercial n'a rien à y faire.
    when exists (
      select 1 from public.affectations a
       where a.projet_id = p_projet_id
         and a.retire_at is null
         and a.masque_at is null
         and coalesce(a.statut, '') <> 'perdu'
    ) then 'chez_artisan'
    -- Tous sortis : personne ne s'en occupe, c'est la zone de commission.
    else 'reprise'
  end;
$function$;

-- ---------- 3) Le trigger ----------

create or replace function public.trg_origine_chantier()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_projet uuid;
begin
  v_projet := coalesce(new.projet_id, old.projet_id);

  update public.projets
     set origine = public.calculer_origine(v_projet)
   where id = v_projet
     -- Éviter une écriture inutile : le trigger se déclenche sur chaque
     -- mouvement d'affectation, et la plupart ne changent pas l'origine.
     and origine is distinct from public.calculer_origine(v_projet);

  return coalesce(new, old);
end
$function$;

drop trigger if exists trg_origine_chantier on public.affectations;

create trigger trg_origine_chantier
  after insert or update or delete on public.affectations
  for each row
  execute function public.trg_origine_chantier();

-- ---------- 4) Le motif « signé chez un concurrent » tue le chantier ----------
--
-- Un client parti avec un artisan hors Celexia n'a plus rien à vendre : il ne
-- doit pas atterrir dans la pile du commercial, qui perdrait son temps.

create or replace function public.trg_perte_definitive()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.motif_perte = 'signe_concurrent'
     and coalesce(old.motif_perte, '') is distinct from 'signe_concurrent' then
    update public.projets
       set statut = 'mort'
     where id = new.projet_id
       and statut not in ('devis_signe', 'termine');
  end if;
  return new;
end
$function$;

drop trigger if exists trg_perte_definitive on public.affectations;

create trigger trg_perte_definitive
  after update of motif_perte on public.affectations
  for each row
  execute function public.trg_perte_definitive();

-- ---------- 5) Rattrapage de l'existant ----------

update public.projets p
   set origine = public.calculer_origine(p.id)
 where p.origine is distinct from public.calculer_origine(p.id);

create index if not exists idx_projets_origine
  on public.projets (origine)
  where deleted_at is null;

-- ---------- 6) La pile de reprise ne garde que les chantiers orphelins ----------
--
-- 22 chantiers sur 96 avaient encore un artisan actif : un commercial pouvait
-- rappeler un client déjà suivi. On s'appuie désormais sur `origine`, qui porte
-- exactement cette notion.

create or replace function public.chantiers_a_reattribuer()
returns json
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(json_agg(x order by x.sorti_le desc), '[]'::json)
  from (
    select
      p.id                         as projet_id,
      af.id                        as affectation_id,
      p.client_nom,
      p.client_telephone,
      p.client_ville,
      p.client_code_postal,
      p.metier,
      p.metiers,
      p.description,
      p.statut                     as statut_projet,
      coalesce(a.societe, a.nom)   as artisan_nom,
      af.artisan_id,
      af.etape,
      af.montant_devis,
      af.devis_url is not null     as devis_depose,
      af.motif_perte,
      af.motif_perte_detail,
      coalesce(af.retire_at, af.perdu_at, af.updated_at) as sorti_le,
      case
        when af.retire_at is not null then 'retrait'
        when af.statut = 'perdu'      then 'perdu'
        else 'masque'
      end as nature,
      (select s.message from public.suivis s
        where s.affectation_id = af.id and coalesce(btrim(s.message), '') <> ''
        order by s.created_at desc limit 1) as derniere_raison,
      -- Toujours 0 par construction (origine = 'reprise'), mais conservé : le
      -- front l'affiche et d'autres appelants peuvent en dépendre.
      0::bigint as artisans_actifs,
      p.assigne_a,
      (select m.nom from public.membres m where m.user_id = p.assigne_a) as assigne_nom,
      (current_date - coalesce(af.retire_at, af.perdu_at, af.updated_at)::date) as jours_dattente
    from public.affectations af
    join public.projets p on p.id = af.projet_id
    left join public.artisans a on a.id = af.artisan_id
    where p.deleted_at is null
      -- Le filtre tient maintenant en une condition : plus personne dessus.
      and p.origine = 'reprise'
      and p.statut not in ('mort', 'devis_signe', 'termine', 'artisan_demarche')
      and (af.retire_at is not null or af.masque_at is not null or af.statut = 'perdu')
      -- Une seule ligne par projet : la sortie la plus récente. Sans cela, un
      -- chantier passé par trois artisans apparaissait trois fois.
      and af.id = (
        select af2.id from public.affectations af2
         where af2.projet_id = p.id
           and (af2.retire_at is not null or af2.masque_at is not null
                or af2.statut = 'perdu')
         order by coalesce(af2.retire_at, af2.perdu_at, af2.updated_at) desc
         limit 1
      )
  ) x;
$function$;

comment on function public.chantiers_a_reattribuer() is
  'Chantiers à replacer : plus aucun artisan dessus (projets.origine = reprise). '
  'Une ligne par projet, la sortie la plus récente.';
