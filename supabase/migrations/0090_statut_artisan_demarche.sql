-- Statut « artisan_demarche » : la personne au bout du fil n'est pas un
-- client, c'est un artisan qui cherche du travail.
--
-- Quatre cas en une semaine (Brive, Strasbourg, Lodève, Montbrison), tous
-- supprimés faute de catégorie. Sans trace, le même numéro revient dans une
-- liste de leads trois semaines plus tard et se fait rappeler.
--
-- On ne les range PAS dans « mort » : un artisan qui prospecte est un
-- fournisseur potentiel, pas un lead perdu. L'agence cherche justement des
-- artisans hors des zones déjà couvertes. Les deux cas appellent des actions
-- opposées — l'un ne se rappelle jamais, l'autre se rappelle quand un chantier
-- tombe dans son secteur.

alter table public.projets drop constraint if exists projets_statut_check;

alter table public.projets add constraint projets_statut_check check (
  statut = any (array[
    'nouveau', 'a_rappeler', 'en_attente', 'artisan_assigne', 'contacte',
    'rdv_pris', 'devis_envoye', 'devis_signe', 'termine', 'perdu', 'mort',
    'artisan_demarche'
  ])
);

comment on column public.projets.statut is
  'Étape du pipeline. « mort » = lead sans suite. « artisan_demarche » = ce n''est pas un client mais un artisan en recherche de travail : à ne jamais rappeler comme prospect, éventuellement à recruter.';

-- Rang 0 comme « nouveau » : ce statut ne fait pas avancer un projet, il le
-- sort du pipeline. Sans cette ligne, `rang_statut()` renverrait -1 et le
-- trigger de synchronisation (0089) le traiterait comme une valeur inconnue.
create or replace function public.rang_statut(p_statut text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_statut
    when 'nouveau'          then 0
    when 'artisan_demarche' then 0
    when 'a_rappeler'       then 1
    when 'en_attente'       then 2
    when 'artisan_assigne'  then 3
    when 'contacte'         then 4
    when 'rdv_pris'         then 5
    when 'devis_envoye'     then 6
    when 'devis_signe'      then 7
    when 'termine'          then 8
    else -1
  end;
$$;

-- Verrouillé au même titre que « perdu » et « mort » : c'est une
-- qualification humaine, qu'aucune affectation ne doit écraser.
create or replace function public.statut_projet_verrouille(p_statut text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_statut in ('perdu', 'mort', 'artisan_demarche');
$$;

revoke execute on function public.rang_statut(text) from public, anon;
revoke execute on function public.statut_projet_verrouille(text) from public, anon;

-- Recherche par téléphone pour la détection de doublon : c'est elle qui
-- empêchera de rappeler un artisan déjà identifié.
create index if not exists idx_projets_telephone_chiffres
  on public.projets ((regexp_replace(coalesce(client_telephone, ''), '\D', '', 'g')))
  where deleted_at is null;
