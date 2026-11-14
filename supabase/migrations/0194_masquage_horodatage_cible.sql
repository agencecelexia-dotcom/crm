-- Le masquage seul conserve l'horodatage métier. Une autre écriture, même
-- identique (ex. signal d'activité), garde le comportement historique.
create or replace function public.set_projet_updated_at() returns trigger language plpgsql as $$
begin
  if new.masque_agence_at is distinct from old.masque_agence_at
     and (to_jsonb(new) - array['masque_agence_at','updated_at','commission'])
       = (to_jsonb(old) - array['masque_agence_at','updated_at','commission']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.masquer_projet(p_projet_id uuid, p_masque boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.projets p where p.id = p_projet_id
      and p.id in (select public.mes_projets())
      and (public.est_fondateur() or p.created_by = auth.uid() or p.assigne_a = auth.uid())
  ) then
    raise exception 'Projet inaccessible' using errcode = '42501';
  end if;
  if p_masque is null then raise exception 'Visibilité requise'; end if;
  if not exists (select 1 from public.projets where id=p_projet_id and deleted_at is null) then
    raise exception 'Projet introuvable';
  end if;
  -- Un double clic/réessai ne constitue pas une nouvelle activité métier.
  update public.projets
    set masque_agence_at = case when p_masque then now() else null end
    where id = p_projet_id and deleted_at is null
      and (masque_agence_at is not null) is distinct from p_masque;
  return jsonb_build_object('ok', true);
end;
$$;
