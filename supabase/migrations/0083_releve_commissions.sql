-- ============================================================
--  0083 — P2-13 : relevé de commissions détaillé.
--
--  CONSTAT (audit §2) : « la commission est un chiffre nu : pas de taux
--  affiché, pas d'assiette, pas d'échéance, pas de détail ligne par ligne,
--  pas de justificatif, pas de dates de règlement. C'est le point le plus
--  sensible de la relation apporteur/artisan et le moins documenté. »
--
--  Cette fonction renvoie une ligne par chantier facturé, avec tout ce qui
--  permet de vérifier le calcul : montant signé (assiette), taux appliqué,
--  commission due, état du règlement et dates. L'artisan peut recouper, et
--  l'agence n'a plus à justifier un total agrégé sans détail.
-- ============================================================

create or replace function public.releve_commissions_by_token(p_token text)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare a public.artisans;
begin
  select * into a from public.artisans where token = p_token;
  if a.id is null then return null; end if;

  return json_build_object(
    'taux_contractuel', a.taux_commission,
    'lignes', (
      select coalesce(json_agg(json_build_object(
        'projet_id', p.id,
        'client', p.client_nom,
        'ville', p.client_ville,
        'metier', p.metier,
        -- Assiette : le montant sur lequel la commission est calculée.
        'assiette', p.montant_devis_signe,
        'taux', p.taux_commission,
        'commission', p.commission,
        'reglee', p.commission_encaissee,
        'date_signature', p.date_signature,
        'devis_url', af.devis_signe_url
      ) order by p.date_signature desc nulls last, p.created_at desc), '[]'::json)
      from public.affectations af
      join public.projets p on p.id = af.projet_id
      where af.artisan_id = a.id
        and p.deleted_at is null
        and p.artisan_id = a.id
        and af.issue = 'gagne'
        and p.commission is not null
        and p.commission > 0
    ),
    'total_du', (
      select coalesce(sum(p.commission), 0)
      from public.affectations af join public.projets p on p.id = af.projet_id
      where af.artisan_id = a.id and p.artisan_id = a.id and p.deleted_at is null
        and af.issue = 'gagne' and not p.commission_encaissee),
    'total_regle', (
      select coalesce(sum(p.commission), 0)
      from public.affectations af join public.projets p on p.id = af.projet_id
      where af.artisan_id = a.id and p.artisan_id = a.id and p.deleted_at is null
        and p.commission_encaissee)
  );
end;
$function$;

revoke execute on function public.releve_commissions_by_token(text) from public;
grant  execute on function public.releve_commissions_by_token(text) to anon, authenticated;
