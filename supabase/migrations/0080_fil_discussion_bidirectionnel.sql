-- ============================================================
--  0080 — P1-9 : fil de discussion agence ↔ artisan.
--
--  CONSTAT (audit §5) : la boucle est à sens unique. L'artisan écrit à
--  Celexia, Celexia ne peut pas répondre dans le fil. Tous les événements sont
--  attribués à « Artisan », donc l'agence n'a aucune voix dans le dossier :
--  pas de consigne, pas de contexte, pas de « ce lead est prioritaire ».
--
--  La table `suivis` porte DÉJÀ une colonne `auteur` contrainte à
--  ('artisan','agence') : le modèle était prêt, rien côté agence ne l'écrivait.
--  On ajoute donc l'écriture agence, la lecture par l'artisan, et un accusé de
--  lecture — sans nouvelle table.
-- ============================================================

alter table public.suivis
  add column if not exists lu_at timestamptz;

comment on column public.suivis.lu_at is
  'Accusé de lecture. Renseigné quand le destinataire a ouvert le fil.';

-- ---------- 1. L'agence écrit dans le fil ----------
create or replace function public.message_agence(
  p_affectation_id uuid, p_message text, p_prioritaire boolean default false
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare af public.affectations;
begin
  if length(coalesce(btrim(p_message), '')) < 2 then
    return json_build_object('ok', false, 'error', 'message_vide');
  end if;

  select * into af from public.affectations where id = p_affectation_id;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, message)
  values (af.projet_id, af.id, 'agence',
          case when p_prioritaire then 'consigne' else 'note' end,
          btrim(p_message));

  return json_build_object('ok', true);
end;
$function$;

-- `suivis_type_check` doit accepter le nouveau type de message agence.
alter table public.suivis drop constraint if exists suivis_type_check;
alter table public.suivis add constraint suivis_type_check
  check (type = any (array['statut','note','appel','retrait','consigne']));

revoke execute on function public.message_agence(uuid, text, boolean) from public, anon;
grant  execute on function public.message_agence(uuid, text, boolean) to authenticated;

-- ---------- 2. L'artisan marque le fil comme lu ----------
create or replace function public.marquer_lu_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare af public.affectations; n int;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  update public.suivis
     set lu_at = now()
   where affectation_id = af.id and auteur = 'agence' and lu_at is null;
  get diagnostics n = row_count;

  return json_build_object('ok', true, 'marques', n);
end;
$function$;

revoke execute on function public.marquer_lu_by_token(text) from public;
grant  execute on function public.marquer_lu_by_token(text) to anon, authenticated;

-- ---------- 3. Compteur de messages non lus, par affectation ----------
-- Permet d'afficher une pastille sur la carte du chantier, sans charger
-- l'intégralité des fils.
create or replace function public.non_lus_par_affectation(p_artisan_id uuid)
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(json_object_agg(affectation_id, n), '{}'::json)
  from (
    select s.affectation_id, count(*)::int n
    from public.suivis s
    join public.affectations af on af.id = s.affectation_id
    where af.artisan_id = p_artisan_id
      and s.auteur = 'agence' and s.lu_at is null
    group by 1
  ) t;
$function$;

revoke execute on function public.non_lus_par_affectation(uuid) from public, anon;
grant  execute on function public.non_lus_par_affectation(uuid) to authenticated, service_role;
