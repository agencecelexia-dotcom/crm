-- Cloisonnement par rôle : réécriture des 15 policies RLS.
--
-- Avant cette migration, chaque table portait une policy unique
-- `for all to authenticated using (true)` : tout compte connecté voyait et
-- modifiait tout. Un commercial aurait donc eu accès aux commissions de
-- l'agence, au fichier complet des artisans et aux leads de ses collègues.
--
-- Le cloisonnement s'appuie sur `mes_projets()` (0099), qui remonte au projet
-- parent pour les 8 tables filles — aucune n'a de `created_by`, seule
-- `projets` en a un.
--
-- Chaque policy est écrite en deux temps : `using` contrôle ce qu'on VOIT,
-- `with check` ce qu'on peut ÉCRIRE. Sans le second, un commercial pourrait
-- créer une ligne rattachée au projet d'un autre.

-- ---------------------------------------------------------------------------
-- 1. PROJETS — la table qui porte le cloisonnement

drop policy if exists projets_authenticated_all on public.projets;

create policy projets_lecture on public.projets
  for select to authenticated
  using (
    public.est_fondateur()
    or created_by = auth.uid()
    or assigne_a = auth.uid()
  );

create policy projets_creation on public.projets
  for insert to authenticated
  -- Un commercial ne peut créer un lead qu'à son propre nom : sans ce
  -- contrôle, il pourrait antidater un dossier au compte d'un collègue.
  with check (public.est_fondateur() or created_by = auth.uid());

create policy projets_modification on public.projets
  for update to authenticated
  using (public.est_fondateur() or created_by = auth.uid() or assigne_a = auth.uid())
  with check (public.est_fondateur() or created_by = auth.uid() or assigne_a = auth.uid());

-- La suppression (même douce) reste au fondateur : un commercial qui se
-- trompe doit demander, pas effacer.
create policy projets_suppression on public.projets
  for delete to authenticated
  using (public.est_fondateur());

-- ---------------------------------------------------------------------------
-- 2. TABLES FILLES — cloisonnées via le projet parent
--
-- `projet_id in (select public.mes_projets())` : la fonction est `stable`,
-- Postgres ne l'évalue donc qu'une fois par requête et non par ligne.

do $$
declare t text;
begin
  foreach t in array array[
    'affectations', 'suivis', 'projet_documents', 'projet_notes',
    'taches', 'relances', 'notifications'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_auth_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_auth', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);

    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using (projet_id in (select public.mes_projets()))
        with check (projet_id in (select public.mes_projets()))
    $f$, t || '_par_projet', t);
  end loop;
end $$;

-- `devis` : même logique, mais la table sert aussi au générateur artisan qui
-- passe par des RPC `security definer` — la policy ne le gêne pas.
drop policy if exists devis_auth on public.devis;
create policy devis_par_projet on public.devis
  for all to authenticated
  using (projet_id in (select public.mes_projets()))
  with check (projet_id in (select public.mes_projets()));

-- ---------------------------------------------------------------------------
-- 3. RÉFÉRENTIELS — lecture pour tous, écriture selon le droit
--
-- Un commercial doit voir les artisans pour attribuer un chantier. Il ne les
-- crée que si le fondateur lui en a donné le droit (`peut_creer_artisan`).

drop policy if exists artisans_authenticated_all on public.artisans;

create policy artisans_lecture on public.artisans
  for select to authenticated using (true);

create policy artisans_ecriture on public.artisans
  for all to authenticated
  using (
    public.est_fondateur()
    or exists (select 1 from public.membres m
                where m.user_id = auth.uid() and m.actif and m.peut_creer_artisan)
  )
  with check (
    public.est_fondateur()
    or exists (select 1 from public.membres m
                where m.user_id = auth.uid() and m.actif and m.peut_creer_artisan)
  );

-- `contrats` : liés à un artisan, pas à un projet. Lecture pour tous
-- (nécessaire pour savoir si un artisan est signé avant de lui attribuer),
-- écriture réservée au fondateur.
drop policy if exists contrats_authenticated_all on public.contrats;
create policy contrats_lecture on public.contrats
  for select to authenticated using (true);
create policy contrats_ecriture on public.contrats
  for all to authenticated
  using (public.est_fondateur()) with check (public.est_fondateur());

-- `zones` : référentiel de communes, en lecture seule pour tout le monde.
drop policy if exists zones_auth on public.zones;
create policy zones_lecture on public.zones
  for select to authenticated using (true);
create policy zones_ecriture on public.zones
  for all to authenticated
  using (public.est_fondateur()) with check (public.est_fondateur());

-- ---------------------------------------------------------------------------
-- 4. RÉSERVÉ AU FONDATEUR
--
-- `app_settings` porte la signature de l'apporteur et les réglages
-- d'automatisation ; `notes` est le bloc-notes des associés ; `prospects` est
-- le vivier de recrutement — 11 941 lignes qui n'ont rien à faire dans
-- l'écran d'un commercial.

do $$
declare t text;
begin
  foreach t in array array['app_settings', 'notes', 'prospects'] loop
    execute format('drop policy if exists %I on public.%I', t || '_auth_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_auth', t);

    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using (public.est_fondateur())
        with check (public.est_fondateur())
    $f$, t || '_fondateur', t);
  end loop;
end $$;
