-- Synchronisation projets.statut ← affectations.statut
--
-- Constat : 8 triggers existent sur `affectations` (étape, taux, montants,
-- notifications, commission) mais AUCUN ne remonte le statut vers le projet.
-- Un projet restait donc à « nouveau » alors qu'un artisan lui était assigné :
-- invisible dans un filtre « attribués », et compté comme non traité dans les
-- statistiques agence. 8 dossiers étaient dans cet état en prod.
--
-- Principe : `projets.statut` reflète l'affectation la PLUS AVANCÉE, et ne
-- recule jamais de lui-même — même règle de monotonie que `affectations.etape`
-- (0073). Un statut saisi à la main côté agence (« perdu », « mort ») n'est
-- jamais écrasé par un trigger : ce sont des décisions métier, pas des états
-- dérivés.

-- Rang d'un statut dans le pipeline. Aligné sur STATUTS_ORDRE côté front
-- (src/lib/constants.ts). -1 pour toute valeur inconnue : les colonnes sont
-- des `text` sans contrainte, une valeur inattendue ne doit pas faire avancer
-- le projet.
create or replace function public.rang_statut(p_statut text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_statut
    when 'nouveau'         then 0
    when 'a_rappeler'      then 1
    when 'en_attente'      then 2
    when 'artisan_assigne' then 3
    when 'contacte'        then 4
    when 'rdv_pris'        then 5
    when 'devis_envoye'    then 6
    when 'devis_signe'     then 7
    when 'termine'         then 8
    else -1
  end;
$$;

comment on function public.rang_statut(text) is
  'Rang d''un statut dans le pipeline, pour comparer deux statuts. -1 si inconnu.';

-- Statuts que le trigger ne touche jamais : ils traduisent une décision de
-- l'agence, pas l'avancement d'un artisan. Un projet « perdu » avec une
-- affectation encore active existe légitimement (l'agence a tranché avant
-- l'artisan) — c'est le cas du dossier Fanny / Guérif Élagage.
create or replace function public.statut_projet_verrouille(p_statut text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_statut in ('perdu', 'mort');
$$;

create or replace function public.sync_statut_projet()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_projet_id uuid := coalesce(new.projet_id, old.projet_id);
  v_max text;
  v_actuel text;
begin
  select statut into v_actuel
    from public.projets
   where id = v_projet_id
   for update;

  if not found or public.statut_projet_verrouille(v_actuel) then
    return coalesce(new, old);
  end if;

  -- Affectation la plus avancée, hors retraits.
  select af.statut into v_max
    from public.affectations af
   where af.projet_id = v_projet_id
     and af.retire_at is null
   order by public.rang_statut(af.statut) desc
   limit 1;

  -- Monotone : on n'avance jamais à reculons. Le retrait d'un artisan ne doit
  -- pas ramener un projet « devis_envoyé » à « nouveau ».
  if v_max is not null
     and public.rang_statut(v_max) > public.rang_statut(v_actuel) then
    update public.projets
       set statut = v_max
     where id = v_projet_id;
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.sync_statut_projet() is
  'Remonte le statut de l''affectation la plus avancée vers le projet. Monotone, et sans effet sur les statuts verrouillés (perdu, mort).';

drop trigger if exists trg_sync_statut_projet on public.affectations;
create trigger trg_sync_statut_projet
  after insert or update of statut, retire_at or delete
  on public.affectations
  for each row
  execute function public.sync_statut_projet();

-- Rattrapage de l'existant, avec les mêmes garde-fous que le trigger :
-- on n'avance que vers l'avant, et jamais sur un statut verrouillé.
update public.projets p
   set statut = m.statut_max
  from (
    select af.projet_id,
           (array_agg(af.statut order by public.rang_statut(af.statut) desc))[1] as statut_max
      from public.affectations af
     where af.retire_at is null
     group by af.projet_id
  ) m
 where m.projet_id = p.id
   and p.deleted_at is null
   and not public.statut_projet_verrouille(p.statut)
   and public.rang_statut(m.statut_max) > public.rang_statut(p.statut);

revoke execute on function public.sync_statut_projet() from public, anon;
revoke execute on function public.rang_statut(text) from public, anon;
revoke execute on function public.statut_projet_verrouille(text) from public, anon;
