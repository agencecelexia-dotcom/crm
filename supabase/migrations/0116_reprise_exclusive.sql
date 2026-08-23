-- Un chantier repris appartient à son commercial, et à lui seul.
--
-- LE MODÈLE
--
-- Trois niveaux de visibilité, et non deux :
--
--   * TOUT LE PIPE — les chantiers chez un artisan, les leads neufs, la pile
--     à réattribuer. Tout le monde voit, exactement comme l'agence : un
--     commercial peut saisir un lead et l'envoyer chez un artisan.
--
--   * MON PIPE — ce que CE commercial a repris. Personne d'autre n'y accède :
--     ni les autres commerciaux, ni leurs listes. C'est là qu'il travaille et
--     qu'il gagne sa commission.
--
--   * L'AGENCE voit tout, y compris les reprises de chacun, pour suivre
--     l'avancement.
--
-- Sans cette exclusivité, deux commerciaux rappelleraient le même client et se
-- disputeraient la même commission.

create or replace function public.mes_projets()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p.id
    from public.projets p
   where exists (
     select 1 from public.membres m
      where m.user_id = auth.uid() and m.actif
   )
     and (
       -- Le fondateur voit tout, reprises comprises : c'est son rôle de suivre
       -- qui avance sur quoi.
       public.est_fondateur()
       -- Un chantier libre appartient au pipe commun.
       or p.assigne_a is null
       -- Un chantier repris n'est visible que par celui qui l'a pris.
       or p.assigne_a = auth.uid()
     );
$function$;

comment on function public.mes_projets() is
  'Projets visibles. Tout membre actif voit le pipe commun — il peut saisir un '
  'lead et l''envoyer chez un artisan, comme l''agence. Un chantier REPRIS '
  'n''est visible que par son commercial : sans cela, deux commerciaux '
  'rappelleraient le même client. Le fondateur voit tout.';

-- ---------- Mon pipe : ce que j'ai repris ----------

create or replace function public.mon_pipe()
returns json
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(json_agg(x order by x.repris_depuis desc), '[]'::json)
  from (
    select
      p.id                       as projet_id,
      p.client_nom,
      p.client_telephone,
      p.client_ville,
      p.client_code_postal,
      p.metiers,
      p.description,
      p.statut,
      p.montant_devis,
      p.commission,
      p.commission_encaissee,
      -- L'artisan actuellement sur le chantier, s'il a déjà été replacé.
      (select coalesce(a.societe, a.nom)
         from public.affectations af
         join public.artisans a on a.id = af.artisan_id
        where af.projet_id = p.id and af.retire_at is null
          and coalesce(af.statut, '') <> 'perdu'
        order by af.created_at desc limit 1) as artisan_actuel,
      -- Depuis combien de jours il l'a en main. Un dossier repris puis oublié
      -- est pire qu'un dossier non repris : plus personne d'autre ne peut le
      -- prendre, et le client attend.
      (current_date - p.updated_at::date) as repris_depuis,
      -- Ce que ce chantier lui rapportera, une fois la commission encaissée.
      round(
        coalesce(p.commission, 0)
        * coalesce((select m.taux_retrocession from public.membres m
                     where m.user_id = auth.uid()), 0.10),
        2
      ) as ma_part
    from public.projets p
   where p.deleted_at is null
     and p.assigne_a = auth.uid()
  ) x;
$function$;

comment on function public.mon_pipe() is
  'Les chantiers que le commercial connecté a repris : son périmètre exclusif. '
  'Inclut sa part estimée, calculée sur son taux de rétrocession.';

revoke all on function public.mon_pipe() from public, anon;
grant execute on function public.mon_pipe() to authenticated;
