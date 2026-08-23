-- Prise en charge des chantiers à réattribuer.
--
-- 96 chantiers attendent d'être replacés. Sans savoir qui s'en occupe, deux
-- commerciaux rappellent le même client — et le client, lui, entend deux fois
-- la même agence.
--
-- On ajoute donc à la liste : qui l'a pris en charge, et depuis combien de
-- jours il attend. L'ancienneté n'est pas décorative : au-delà d'un mois, le
-- client a souvent signé ailleurs, et le chantier vaut moins qu'un lead frais.

CREATE OR REPLACE FUNCTION public.chantiers_a_reattribuer()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      coalesce(af.retire_at, af.perdu_at, af.updated_at) as sorti_le,
      case
        when af.retire_at is not null then 'retrait'
        when af.statut = 'perdu'      then 'perdu'
        else 'masque'
      end as nature,
      -- Le dernier commentaire dit souvent pourquoi ça a échoué : c'est
      -- l'élément qui décide d'une réattribution.
      (select s.message from public.suivis s
        where s.affectation_id = af.id and coalesce(btrim(s.message), '') <> ''
        order by s.created_at desc limit 1) as derniere_raison,
      -- Combien d'artisans travaillent encore dessus. À zéro, plus personne
      -- ne s'en occupe : ce sont les dossiers vraiment orphelins.
      (select count(*) from public.affectations af2
        where af2.projet_id = p.id and af2.retire_at is null
          and af2.statut <> 'perdu') as artisans_actifs,

      -- Qui s'en occupe. Sans cette information, deux commerciaux rappellent
      -- le même client — c'est précisément ce qu'on cherche à éviter.
      p.assigne_a,
      (select m.nom from public.membres m where m.user_id = p.assigne_a) as assigne_nom,

      -- Depuis combien de jours le chantier attend. Au-delà d'un mois, le
      -- client a souvent déjà signé ailleurs : la pile se trie là-dessus.
      (current_date - coalesce(af.retire_at, af.perdu_at, af.updated_at)::date) as jours_dattente
    from public.affectations af
    join public.projets p on p.id = af.projet_id
    left join public.artisans a on a.id = af.artisan_id
    where p.deleted_at is null
      -- Un projet gagné, mort ou clos n'a plus rien à réattribuer.
      and p.statut not in ('mort', 'devis_signe', 'termine', 'artisan_demarche')
      and (af.retire_at is not null or af.masque_at is not null or af.statut = 'perdu')
  ) x;
$function$;


/**
 * Prendre en charge un chantier à réattribuer.
 *
 * Le premier qui le prend le garde — mais un fondateur peut réassigner. Sans
 * cette règle, deux commerciaux travailleraient le même dossier sans le savoir.
 */
create or replace function public.prendre_chantier(p_projet_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_deja uuid;
  v_nom  text;
begin
  select assigne_a into v_deja from public.projets where id = p_projet_id;

  if v_deja is not null and v_deja <> auth.uid() and not public.est_fondateur() then
    select nom into v_nom from public.membres where user_id = v_deja;
    return json_build_object('ok', false, 'error', 'deja_pris',
                             'par', coalesce(v_nom, 'un collègue'));
  end if;

  update public.projets set assigne_a = auth.uid() where id = p_projet_id;
  return json_build_object('ok', true);
end $fn$;

/** Rendre un chantier à la pile commune. */
create or replace function public.rendre_chantier(p_projet_id uuid)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.projets set assigne_a = null
   where id = p_projet_id
     and (assigne_a = auth.uid() or public.est_fondateur());

  if not found then
    return json_build_object('ok', false, 'error', 'non_autorise');
  end if;
  return json_build_object('ok', true);
end $fn$;

revoke execute on function public.prendre_chantier(uuid) from public, anon;
revoke execute on function public.rendre_chantier(uuid) from public, anon;
grant execute on function public.prendre_chantier(uuid) to authenticated;
grant execute on function public.rendre_chantier(uuid) to authenticated;
