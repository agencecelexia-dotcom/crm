-- ============================================================================
--  AUDIT CRM CELEXIA — Script de vérification de l'état RÉEL en production
--  ---------------------------------------------------------------------
--  100 % LECTURE SEULE. Aucun INSERT / UPDATE / DELETE / ALTER / DROP.
--  Aucune donnée métier n'est extraite (pas de nom client, pas de téléphone).
--  Les emails des comptes admin sont masqués (tho***@domaine.com).
--
--  MODE D'EMPLOI
--    1. Supabase → SQL Editor → New query
--    2. Coller TOUT ce fichier, cliquer Run
--    3. Une seule cellule de résultat s'affiche → clic droit → Copy
--    4. Me la renvoyer telle quelle
--
--  POURQUOI : le repo contient 60 migrations dont certaines redéfinissent la
--  même fonction jusqu'à 10 fois, et plusieurs fonctions n'ont jamais reçu de
--  GRANT. Le code décrit une intention ; seule la base dit ce qui est vraiment
--  appliqué. Ce script mesure l'écart.
-- ============================================================================

select jsonb_pretty(jsonb_build_object(

  -- ── 0. Contexte ───────────────────────────────────────────────────────────
  'meta', jsonb_build_object(
    'genere_le',        now(),
    'version_postgres', version(),
    'base',             current_database()
  ),

  -- ── 1. RLS réellement activée, table par table ────────────────────────────
  --    Cible : une table du schéma public SANS RLS est lisible/écrivable par
  --    n'importe qui via PostgREST avec la seule clé anon (publique, dans le
  --    bundle JS). Le repo prétend que les 14 tables ont la RLS activée.
  'rls_par_table', (
    select jsonb_agg(jsonb_build_object(
             'table',        c.relname,
             'rls_activee',  c.relrowsecurity,
             'rls_forcee',   c.relforcerowsecurity,
             'nb_policies',  (select count(*) from pg_policies p
                              where p.schemaname = 'public' and p.tablename = c.relname),
             'VERDICT',      case
                               when not c.relrowsecurity then '### RLS DESACTIVEE — TABLE OUVERTE ###'
                               when (select count(*) from pg_policies p
                                     where p.schemaname='public' and p.tablename=c.relname) = 0
                                    then 'RLS ON sans policy (table verrouillee)'
                               else 'ok'
                             end
           ) order by c.relrowsecurity, c.relname)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  ),

  -- ── 2. Contenu réel des policies du schéma public ─────────────────────────
  --    Cible : confirmer que tout est bien `authenticated / using(true)`, et
  --    repérer toute policy accordée à anon ou public qui ne serait pas dans
  --    les migrations.
  'policies_public', (
    select jsonb_agg(jsonb_build_object(
             'table',      tablename,
             'policy',     policyname,
             'commande',   cmd,
             'roles',      roles,
             'using',      qual,
             'with_check', with_check
           ) order by tablename, policyname)
    from pg_policies where schemaname = 'public'
  ),

  -- ── 3. Droits de table du rôle anon ───────────────────────────────────────
  --    Cible : la RLS n'est le dernier rempart que parce que anon possède les
  --    GRANT de table. Si une table perd sa RLS, ces droits deviennent l'accès.
  'grants_table_anon', (
    select jsonb_agg(jsonb_build_object(
             'table', table_name,
             'droits', privs
           ) order by table_name)
    from (
      select table_name, string_agg(distinct privilege_type, ', ' order by privilege_type) as privs
      from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
      group by table_name
    ) t
  ),

  -- ── 4. Buckets Storage : flag public réel ─────────────────────────────────
  --    Cible : le repo crée `devis` et `projet-photos` avec public = true.
  --    Un bucket public sert ses objets sans aucune policy, à qui a l'URL.
  'storage_buckets', (
    select jsonb_agg(jsonb_build_object(
             'bucket',           id,
             'public',           public,
             'limite_taille',    file_size_limit,
             'mimes_autorises',  allowed_mime_types,
             'VERDICT',          case when public then '### BUCKET PUBLIC ###' else 'prive' end
           ) order by public desc, id)
    from storage.buckets
  ),

  -- ── 5. Policies Storage réelles ───────────────────────────────────────────
  --    Cible n°1 de l'audit : le repo accorde à anon INSERT + UPDATE + DELETE
  --    sur le bucket `devis` avec pour seul prédicat `bucket_id = 'devis'`,
  --    donc sans restriction de chemin ni de propriétaire. À confirmer ici.
  'storage_policies', (
    select jsonb_agg(jsonb_build_object(
             'policy',     policyname,
             'commande',   cmd,
             'roles',      roles,
             'using',      qual,
             'with_check', with_check,
             'VERDICT',    case
                             when roles::text like '%anon%' or roles::text like '%public%'
                               then '### ACCESSIBLE ANON ###'
                             else 'authentifie'
                           end
           ) order by policyname)
    from pg_policies where schemaname = 'storage' and tablename = 'objects'
  ),

  -- ── 6. Fonctions : SECURITY DEFINER + ACL réelle ──────────────────────────
  --    Cible n°2 : en PostgreSQL, CREATE FUNCTION accorde EXECUTE à PUBLIC par
  --    défaut. Une fonction SECURITY DEFINER sans GRANT explicite est donc
  --    appelable par anon. Le repo en compte 8 dans ce cas, dont
  --    traiter_relances() qui déclenche des envois d'emails en masse.
  --    Colonne `acl` à NULL = droits par défaut = EXECUTE ouvert à PUBLIC.
  'fonctions', (
    select jsonb_agg(jsonb_build_object(
             'nom',              p.proname,
             'args',             pg_get_function_identity_arguments(p.oid),
             'security_definer', p.prosecdef,
             'proprietaire',     pg_get_userbyid(p.proowner),
             'search_path',      coalesce(array_to_string(p.proconfig, ', '), '(non fige)'),
             'acl',              coalesce(p.proacl::text, 'NULL = DEFAUT = EXECUTE PUBLIC'),
             'VERDICT',          case
                                   when p.prosecdef and p.proacl is null
                                     then '### DEFINER + EXECUTE PUBLIC ###'
                                   when p.prosecdef and p.proacl::text like '%anon=X%'
                                     then 'definer, expose anon (intentionnel ?)'
                                   when p.prosecdef then 'definer, restreint'
                                   else 'invoker'
                                 end
           ) order by (p.prosecdef and p.proacl is null) desc, p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  ),

  -- ── 7. Doublons de signatures ─────────────────────────────────────────────
  --    Cible : le repo définit add_suivi_by_token en 3-args ET 4-args, et
  --    update_projet_by_token a changé de sémantique de token entre 0022 et
  --    0025. Si les deux surcharges coexistent en base, un appel peut atterrir
  --    sur la mauvaise version.
  'fonctions_surchargees', (
    select jsonb_agg(jsonb_build_object(
             'nom', proname, 'nb_surcharges', n, 'signatures', sigs
           ) order by n desc, proname)
    from (
      select p.proname,
             count(*) as n,
             jsonb_agg(pg_get_function_identity_arguments(p.oid) order by p.oid) as sigs
      from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
      where n2.nspname = 'public' and p.prokind = 'f'
      group by p.proname having count(*) > 1
    ) t
  ),

  -- ── 8. Tâches planifiées pg_cron ──────────────────────────────────────────
  --    Cible : le repo planifie 4 jobs et en désactive 1 en 0057. Un job
  --    fantôme encore actif rejouerait une purge par suppression définitive.
  'cron_jobs', case when to_regclass('cron.job') is null then '"pg_cron absent"'::jsonb else (
    select coalesce(jsonb_agg(to_jsonb(j) order by j.jobid), '[]'::jsonb)
    from (select jobid, jobname, schedule, active, command from cron.job) j
  ) end,

  -- ── 9. Comptes d'authentification (emails masqués) ────────────────────────
  --    Cible LA PLUS IMPORTANTE : toutes les policies sont
  --    `to authenticated using (true)`. Donc TOUT compte authentifié lit et
  --    écrit l'intégralité de la base. Si l'inscription est restée ouverte
  --    côté dashboard, n'importe qui sur Internet crée un compte et obtient
  --    un accès total. Le code seul ne peut pas trancher — seule cette requête
  --    le peut. Un nombre de comptes > 2 est un signal d'alarme immédiat.
  'comptes_auth', (
    select jsonb_build_object(
      'nb_comptes', count(*),
      'detail', jsonb_agg(jsonb_build_object(
                  'email_masque',  left(u.email, 3) || '***@' || split_part(u.email, '@', 2),
                  'cree_le',       u.created_at,
                  'confirme',      u.email_confirmed_at is not null,
                  'dernier_login', u.last_sign_in_at,
                  'provider',      u.raw_app_meta_data ->> 'provider',
                  'role',          u.role,
                  'est_anonyme',   u.is_anonymous
                ) order by u.created_at)
    ) from auth.users u
  ),

  -- ── 10. Extensions installées ─────────────────────────────────────────────
  --     pg_net permet les appels HTTP sortants depuis SQL (webhooks n8n),
  --     pg_cron les tâches planifiées. On vérifie aussi le schéma d'install.
  'extensions', (
    select jsonb_agg(jsonb_build_object(
             'nom', e.extname, 'version', e.extversion, 'schema', n.nspname
           ) order by e.extname)
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  ),

  -- ── 11. Volumétrie ────────────────────────────────────────────────────────
  --     Aucune donnée métier, uniquement des compteurs. Sert à évaluer le
  --     risque réel de l'absence totale de pagination (`select *` non borné
  --     sur toutes les listes) et le volume de PII soumis au RGPD.
  'volumetrie', (
    select jsonb_agg(jsonb_build_object(
             'table', relname, 'lignes_vivantes', n_live_tup, 'lignes_mortes', n_dead_tup
           ) order by n_live_tup desc)
    from pg_stat_user_tables where schemaname = 'public'
  ),

  -- ── 12. Triggers actifs ───────────────────────────────────────────────────
  --     Cible : confirmer quels triggers déclenchent réellement des POST n8n
  --     (donc des emails) et qu'aucun n'a été désactivé ou dupliqué.
  'triggers', (
    select jsonb_agg(jsonb_build_object(
             'table', c.relname, 'trigger', t.tgname, 'fonction', p.proname,
             'actif', case t.tgenabled when 'O' then true else false end
           ) order by c.relname, t.tgname)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and not t.tgisinternal
  ),

  -- ── 13. Intégrité : tokens ────────────────────────────────────────────────
  --     Cible : les tokens sont des identifiants porteurs permanents. On
  --     compte les lignes SANS token (lien mort) et on vérifie l'absence de
  --     doublon. Aucun token n'est affiché.
  'integrite_tokens', jsonb_build_object(
    'artisans_total',        (select count(*) from public.artisans),
    'artisans_sans_token',   (select count(*) from public.artisans where token is null),
    'artisans_tokens_uniq',  (select count(distinct token) from public.artisans where token is not null),
    'projets_total',         (select count(*) from public.projets),
    'projets_tokens_uniq',   (select count(distinct token) from public.projets where token is not null),
    'affectations_total',    (select count(*) from public.affectations),
    'affect_tokens_uniq',    (select count(distinct token) from public.affectations where token is not null),
    'contrats_total',        (select count(*) from public.contrats),
    'contrats_signes',       (select count(*) from public.contrats where statut = 'signe')
  ),

  -- ── 14. Intégrité financière ──────────────────────────────────────────────
  --     Cible : la commission doit être calculée par la base. On cherche les
  --     incohérences entre montant signé, taux et commission stockée, et les
  --     taux hors bornes (le taux est modifiable par l'artisan via ?taux=).
  'integrite_financiere', jsonb_build_object(
    'projets_avec_montant_signe',
      (select count(*) from public.projets where montant_devis_signe is not null),
    'projets_montant_signe_negatif',
      (select count(*) from public.projets where montant_devis_signe < 0),
    'artisans_taux_hors_bornes',
      (select count(*) from public.artisans
       where taux_commission is not null and (taux_commission < 5 or taux_commission > 30)),
    'artisans_taux_distincts',
      (select jsonb_agg(distinct taux_commission) from public.artisans where taux_commission is not null)
  )

)) as audit_prod;
