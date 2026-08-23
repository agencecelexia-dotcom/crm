-- Rend les 4 droits `peut_*` réellement effectifs.
--
-- LE PROBLÈME
--
-- Les quatre droits sont réglables dans /equipe et stockés dans `membres`,
-- mais aucun écran ne les lit et une seule policy les consulte. Concrètement :
--
--   * `peut_creer_lead`, `peut_attribuer`, `peut_voir_commissions` n'ont AUCUN
--     effet, ni côté interface ni côté base ;
--   * `peut_creer_artisan` agit en RLS uniquement (migration 0100) — le
--     commercial voit le formulaire, le remplit, puis échoue à l'enregistrement
--     avec une erreur incompréhensible.
--
-- Quatre interrupteurs qui donnent l'illusion du contrôle sans rien contrôler.
--
-- LE PRINCIPE
--
-- Un droit doit agir des DEUX côtés : l'interface masque l'action (traité côté
-- front), la base la refuse (ici). Masquer sans bloquer serait cosmétique —
-- une URL tapée à la main suffirait. Bloquer sans masquer donne l'erreur
-- absurde d'aujourd'hui.

-- ---------- 1) Lecture d'un droit ----------

create or replace function public.a_le_droit(p_droit text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actif boolean;
begin
  -- Un fondateur a tous les droits, sans exception : c'est ce qui garantit
  -- qu'on ne peut pas se verrouiller hors de son propre CRM.
  if public.est_fondateur() then
    return true;
  end if;

  execute format(
    'select %I from public.membres where user_id = $1 and actif',
    p_droit
  ) into v_actif using auth.uid();

  -- Absent, inactif, ou droit non accordé : refus. Le défaut est toujours le
  -- périmètre le plus restreint.
  return coalesce(v_actif, false);
end
$function$;

comment on function public.a_le_droit(text) is
  'Vrai si le compte courant détient ce droit. Un fondateur les a tous. '
  'Le nom du droit doit être une colonne booléenne de `membres`.';

revoke all on function public.a_le_droit(text) from public, anon;
grant execute on function public.a_le_droit(text) to authenticated;

-- ---------- 2) Créer un lead ----------

do $$
begin
  drop policy if exists projets_creation on public.projets;
  drop policy if exists projets_insert on public.projets;

  -- Deux policies UPDATE coexistaient (`projets_modification` d'origine et
  -- `projets_update` posée en 0110). Étant permissives, elles se cumulaient :
  -- la plus large l'emportait et la restriction ne s'appliquait pas.
  drop policy if exists projets_modification on public.projets;
  drop policy if exists projets_update on public.projets;

  create policy projets_modification on public.projets
    for update
    using (
      public.est_fondateur() or created_by = auth.uid() or assigne_a = auth.uid()
    )
    with check (
      public.est_fondateur() or created_by = auth.uid() or assigne_a = auth.uid()
    );

  create policy projets_creation on public.projets
    for insert
    with check (
      public.a_le_droit('peut_creer_lead')
      -- L'auteur doit être soi-même : sans cela, un commercial pourrait créer
      -- un projet au nom d'un collègue et le sortir de son propre périmètre.
      and (created_by = auth.uid() or public.est_fondateur())
    );
end $$;

-- ---------- 3) Attribuer à un artisan ----------
--
-- L'attribution se matérialise par une ligne dans `affectations`. C'est donc
-- l'écriture sur cette table qui porte le droit.

do $$
begin
  -- `affectations_par_projet` couvrait ALL : on la découpe pour soumettre la
  -- seule CRÉATION au droit d'attribuer. Suivre l'avancement d'un chantier
  -- (update) n'est pas l'attribuer, et lire encore moins.
  drop policy if exists affectations_par_projet on public.affectations;
  drop policy if exists affectations_ecriture on public.affectations;
  drop policy if exists affectations_lecture on public.affectations;
  drop policy if exists affectations_maj on public.affectations;
  drop policy if exists affectations_suppression on public.affectations;

  create policy affectations_lecture on public.affectations
    for select
    using (projet_id in (select public.mes_projets()));

  create policy affectations_ecriture on public.affectations
    for insert
    with check (
      public.a_le_droit('peut_attribuer')
      and projet_id in (select public.mes_projets())
    );

  create policy affectations_maj on public.affectations
    for update
    using (projet_id in (select public.mes_projets()))
    with check (projet_id in (select public.mes_projets()));

  create policy affectations_suppression on public.affectations
    for delete
    using (projet_id in (select public.mes_projets()));
end $$;

-- ---------- 4) Ajouter un artisan ----------
--
-- Déjà appliqué par la migration 0100, réécrit ici pour passer par
-- `a_le_droit()` — une seule mécanique de lecture des droits, donc un seul
-- endroit à corriger le jour où elle évolue.

do $$
begin
  drop policy if exists artisans_ecriture on public.artisans;

  create policy artisans_ecriture on public.artisans
    for all
    using (public.a_le_droit('peut_creer_artisan'))
    with check (public.a_le_droit('peut_creer_artisan'));
end $$;

-- ---------- 5) Voir les commissions de l'agence ----------
--
-- Les commissions vivent sur `projets` (colonnes `commission`,
-- `commission_encaissee`, `taux_commission`) : elles ne peuvent pas être
-- masquées par une policy de ligne sans masquer le projet entier, dont le
-- commercial a besoin.
--
-- Ce droit reste donc appliqué côté interface : il conditionne l'accès à
-- l'écran Commissions et l'affichage des montants d'agence. C'est assumé —
-- un commercial déterminé pourrait lire la donnée via l'API, mais il n'y a
-- aucun moyen de l'en empêcher sans lui retirer l'accès aux chantiers.
