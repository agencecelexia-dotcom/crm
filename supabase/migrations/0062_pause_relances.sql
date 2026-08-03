-- ============================================================
--  0062 — Pause générale des relances automatiques.
--
--  Besoin : suspendre TOUTES les relances automatiques vers les artisans
--  (contrat non signé, inaction, post-RDV) sans perdre le réglage fin de
--  chacune, pour pouvoir les réactiver plus tard telles quelles.
--
--  Choix d'implémentation : un interrupteur maître dans app_settings, lu par
--  un wrapper appelé par le cron. On NE réécrit pas traiter_relances() (150
--  lignes, 5 versions successives) : moins on la retouche, moins on risque
--  d'y réintroduire un bug. Les bascules existantes (auto_contrat,
--  auto_inaction, auto_post_rdv, auto_orphelin) restent intactes et
--  reprennent leur effet dès que la pause est levée.
--
--  Ce que la pause NE touche PAS :
--    - `envoyer_lien_mission` : le mail « nouveau chantier » envoyé à
--      l'artisan. Il part manuellement depuis le CRM (mission-link-card.tsx),
--      pas du cron. C'est précisément celui qu'on veut garder.
--    - `traiter_rappels()` : les rappels « T'AS DU TAFF » de VOS tâches
--      datées, qui vont à l'agence et pas aux artisans. Les couper casserait
--      votre to-do.
--    - Les notifications d'événement (contrat signé, devis déposé,
--      changement de statut, retrait artisan…), déclenchées par trigger.
-- ============================================================

-- ---------- 1) Le réglage, positionné sur « en pause » ----------
insert into public.app_settings (cle, valeur)
values ('relances_pause', 'on')
on conflict (cle) do update set valeur = 'on', updated_at = now();

-- ---------- 2) Wrapper lu par le cron ----------
create or replace function public.traiter_relances_si_actif()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.cfg('relances_pause', 'off') = 'on' then
    return;   -- pause générale active : aucune relance ne part
  end if;
  perform public.traiter_relances();
end;
$function$;

comment on function public.traiter_relances_si_actif() is
  'Point d''entrée cron des relances. Court-circuité par app_settings.relances_pause = on. '
  'Réactivation : update public.app_settings set valeur = ''off'' where cle = ''relances_pause'';';

-- ---------- 3) Le cron appelle le wrapper ----------
select cron.unschedule('relances_tick')
 where exists (select 1 from cron.job where jobname = 'relances_tick');
select cron.schedule('relances_tick', '*/30 * * * *',
  $$ select public.traiter_relances_si_actif(); $$);

-- ---------- 4) Fermer l'appel direct (audit A1-02) ----------
-- traiter_relances() n'a jamais reçu de GRANT : PostgreSQL laisse donc
-- EXECUTE ouvert à PUBLIC, et le rôle anon peut l'appeler via PostgREST.
-- Sans ce revoke, n'importe qui contourne la pause — et pouvait déjà
-- déclencher des envois d'emails en masse.
-- Attention : `revoke ... from public` ne suffit PAS sur Supabase. Un
-- `alter default privileges` accorde EXECUTE à anon/authenticated sur toute
-- fonction créée dans le schéma public : anon garde donc un droit explicite,
-- qu'il faut révoquer nommément. Vérifié en prod — sans la ligne `from anon`,
-- pg_proc.proacl contenait encore `anon=X/postgres`.
revoke execute on function public.traiter_relances()          from public, anon;
revoke execute on function public.traiter_relances_si_actif() from public, anon;
revoke execute on function public.cfg(text, text)             from public, anon;

-- Le cron s'exécute avec le rôle du job (postgres), pas via PostgREST :
-- ces revoke ne cassent pas la planification.
grant execute on function public.traiter_relances()          to service_role;
grant execute on function public.traiter_relances_si_actif() to service_role;
grant execute on function public.cfg(text, text)             to authenticated, service_role;
