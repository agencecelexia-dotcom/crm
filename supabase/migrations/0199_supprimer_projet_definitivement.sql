-- Suppression définitive d'un projet depuis sa fiche (côté agence).
--
-- Cas d'usage : un lead saisi par erreur (doublon, mauvais numéro, test). Le
-- masquer le laisserait en base ; la corbeille le laisserait restaurable. Ici
-- la ligne disparaît, avec tout ce qui en dépend en cascade (notes, suivis,
-- tâches, relances, documents…) : plus rien ne le compte nulle part.
--
-- La politique RLS `projets_suppression` réserve le DELETE aux fondateurs.
-- Un commercial doit pourtant pouvoir effacer SA propre erreur de saisie :
-- cette fonction le lui permet, mais seulement tant que le dossier n'a jamais
-- été engagé. Dès qu'un artisan, un devis ou une rétrocession y est rattaché,
-- l'effacer ferait disparaître l'historique de l'artisan et des commissions :
-- seul un fondateur peut alors trancher.

create or replace function public.supprimer_projet_definitivement(p_projet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created_by uuid;
  v_assigne_a uuid;
begin
  if auth.uid() is null then
    raise exception 'Projet inaccessible' using errcode = '42501';
  end if;

  select p.created_by, p.assigne_a into v_created_by, v_assigne_a
    from public.projets p
   where p.id = p_projet_id
     and p.id in (select public.mes_projets());
  if not found then
    raise exception 'Projet introuvable' using errcode = 'P0002';
  end if;

  if not public.est_fondateur() then
    if v_created_by is distinct from auth.uid()
       and v_assigne_a is distinct from auth.uid() then
      raise exception 'Projet inaccessible' using errcode = '42501';
    end if;
    if exists (select 1 from public.affectations where projet_id = p_projet_id)
       or exists (select 1 from public.devis where projet_id = p_projet_id)
       or exists (select 1 from public.retrocessions where projet_id = p_projet_id) then
      raise exception 'Ce dossier est déjà passé chez un artisan : seul un fondateur peut le supprimer.'
        using errcode = '42501';
    end if;
  end if;

  delete from public.projets where id = p_projet_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.supprimer_projet_definitivement(uuid) from public, anon;
grant execute on function public.supprimer_projet_definitivement(uuid) to authenticated;
