-- ============================================================
--  0064 — Fermer l'accès anonyme aux fonctions internes (audit A1-02).
--
--  Constat : sur 32 fonctions SECURITY DEFINER du schéma public, 29 étaient
--  appelables par le rôle `anon` — c'est-à-dire par n'importe qui, la clé
--  publiable étant servie dans le bundle JS. Pour 16 d'entre elles c'est
--  voulu (l'API artisan par token). Les 14 ci-dessous ne devraient pas
--  l'être : ce sont des fonctions internes de l'agence ou des triggers.
--
--  Deux causes, cumulées :
--    1. CREATE FUNCTION accorde EXECUTE à PUBLIC par défaut ;
--    2. Supabase pose un `alter default privileges ... grant execute ... to
--       anon, authenticated, service_role` sur le schéma public.
--  D'où le double revoke : `from public` ne suffit pas, il faut nommer anon.
--  (Vérifié en prod : après un revoke from public seul, pg_proc.proacl
--  contenait encore `anon=X/postgres`.)
--
--  Ce que ça referme concrètement :
--    - traiter_rappels     : déclencher vos mails « T'AS DU TAFF » en boucle
--    - action_du_jour      : lire votre pilotage commercial du jour
--    - stats_artisans      : lire vos statistiques artisans
--    - prospects_autour    : lire votre fichier de prospection
--    - couverture_*        : lire votre cartographie de couverture
--    - scoring_artisan     : lire vos notations d'artisans
--    - rafraichir_taches   : ÉCRIRE dans vos tâches
--    - ensure_engagement_contrat : CRÉER des contrats
--    - _devis_artisan      : récupérer une ligne artisan entière, token compris
--    - notif_*             : appeler des fonctions de trigger directement
--
--  Non concernées, volontairement laissées ouvertes à anon (API artisan) :
--    get_contrat_by_token, get_mission_by_token, get_espace_artisan,
--    signer_contrat, add_suivi_by_token, log_appel_by_token,
--    set_montant_by_token, set_devis_by_token, set_devis_pdf_by_token,
--    update_projet_by_token, inscrire_artisan, creer_devis_by_token,
--    envoyer_devis_by_token, list_devis_by_token, retirer_chantier_by_token.
--
--  Les fonctions internes appelées DEPUIS une fonction SECURITY DEFINER
--  (ex. _devis_artisan appelée par creer_devis_by_token, cfg appelée par
--  traiter_relances) continuent de fonctionner : le corps s'exécute avec les
--  droits du propriétaire, pas ceux de l'appelant. Idem pour pg_cron, qui
--  s'exécute sous le rôle du job et non via PostgREST.
-- ============================================================

-- ---------- Fonctions internes de l'agence ----------
revoke execute on function public.action_du_jour()      from public, anon;
revoke execute on function public.stats_artisans()      from public, anon;
revoke execute on function public.scoring_artisan(uuid) from public, anon;
revoke execute on function public.rafraichir_taches()   from public, anon;
revoke execute on function public.traiter_rappels()     from public, anon;

revoke execute on function public.couverture_carte(text, text, integer)          from public, anon;
revoke execute on function public.couverture_grille(text, text[], integer, text) from public, anon;
revoke execute on function public.prospects_autour(double precision, double precision, text, integer)
  from public, anon;

-- ---------- Fonctions internes appelées par d'autres definers ----------
revoke execute on function public.ensure_engagement_contrat(uuid) from public, anon;
revoke execute on function public._devis_artisan(text)            from public, anon;

-- ---------- Fonctions de trigger : jamais appelables directement ----------
revoke execute on function public.notif_artisan_inscrit() from public, anon, authenticated;
revoke execute on function public.notif_contrat_signe()   from public, anon, authenticated;
revoke execute on function public.notif_devis_depose()    from public, anon, authenticated;
revoke execute on function public.notif_projet_assigne()  from public, anon, authenticated;

-- ---------- Ré-accorder explicitement ce dont l'app authentifiée a besoin ----------
-- Les 2 associés (rôle authenticated) utilisent ces fonctions depuis le CRM.
grant execute on function public.action_du_jour()      to authenticated;
grant execute on function public.stats_artisans()      to authenticated;
grant execute on function public.scoring_artisan(uuid) to authenticated;
grant execute on function public.rafraichir_taches()   to authenticated;

grant execute on function public.couverture_carte(text, text, integer)          to authenticated;
grant execute on function public.couverture_grille(text, text[], integer, text) to authenticated;
grant execute on function public.prospects_autour(double precision, double precision, text, integer)
  to authenticated;

grant execute on function public.ensure_engagement_contrat(uuid) to authenticated;

-- traiter_rappels est purement cron : personne ne l'appelle depuis l'app.
grant execute on function public.traiter_rappels() to service_role;

-- ---------- Empêcher que le problème revienne ----------
-- Toute NOUVELLE fonction créée dans public n'aura plus EXECUTE ouvert à anon
-- par défaut. Il faudra un grant explicite — ce qui est le comportement voulu.
alter default privileges in schema public revoke execute on functions from anon;
