-- Interrupteur universel pour toutes les automatisations.
--
-- Le CRM déclenche aujourd'hui 5 tâches planifiées, 5 notifications par
-- déclencheur et 9 fonctions qui appellent n8n. Une seule était pilotable
-- depuis l'écran d'automatisations : les relances. Toutes les autres
-- s'exécutaient sans aucun moyen de les couper autrement qu'en SQL.
--
-- Principe retenu : le drapeau est LU par l'automatisation elle-même, pas
-- seulement affiché. Un interrupteur qui n'arrête rien serait pire que pas
-- d'interrupteur du tout — il donnerait une fausse impression de contrôle.
--
-- Choix du défaut : `on`. La migration ne doit rien éteindre de ce qui
-- tourne aujourd'hui ; elle rend pilotable, elle ne change pas le
-- comportement. Seul `relances_pause` garde son sens inversé historique
-- (`on` = en pause), qu'on ne touche pas pour ne pas réveiller les relances
-- à l'insu de l'utilisateur.

-- ---------- 1) Lecture d'un drapeau ----------

create or replace function public.automatisation_active(p_cle text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Absent = actif. Une automatisation ajoutée sans son réglage continue de
  -- fonctionner ; elle n'est pas silencieusement désactivée par un oubli.
  select coalesce(
    (select lower(trim(valeur)) <> 'off' from public.app_settings where cle = p_cle),
    true
  );
$$;

comment on function public.automatisation_active(text) is
  'Vrai si l''automatisation est active. Absente d''app_settings = active. '
  'Lue par les triggers, les crons et les fonctions webhook.';

-- ---------- 2) Les drapeaux, un par automatisation ----------

insert into public.app_settings (cle, valeur)
values
  -- Tâches planifiées
  ('auto_taches',            'on'),
  ('auto_rappels',           'on'),
  ('auto_recontacts',        'on'),
  ('auto_coherence',         'on'),
  -- Notifications internes (vers l'agence)
  ('auto_notif_assignation', 'on'),
  ('auto_notif_inscription', 'on'),
  ('auto_notif_contrat',     'on'),
  ('auto_notif_devis',       'on'),
  ('auto_notif_suivi',       'on'),
  ('auto_notif_retrait',     'on'),
  ('auto_notif_perdu',       'on'),
  -- E-mails externes (vers artisans et clients)
  ('auto_mail_invitation',   'on')
on conflict (cle) do nothing;

-- ---------- 3) Câblage : chaque fonction lit son drapeau ----------
--
-- On enveloppe plutôt que de réécrire : le corps métier reste intact, seule
-- une garde est ajoutée en tête. Réécrire ces fonctions risquerait de perdre
-- un comportement au passage.

do $wrap$
declare
  r record;
  def text;
  garde text;
begin
  for r in
    select * from (values
      ('notif_projet_assigne',  'auto_notif_assignation'),
      ('notif_artisan_inscrit', 'auto_notif_inscription'),
      ('notif_contrat_signe',   'auto_notif_contrat'),
      ('notif_devis_depose',    'auto_notif_devis')
    ) as t(fonction, drapeau)
  loop
    select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = r.fonction
    limit 1;

    if def is null then
      raise notice 'fonction % absente, ignorée', r.fonction;
      continue;
    end if;

    -- Déjà câblée : on ne double pas la garde si la migration est rejouée.
    if def ilike '%automatisation_active(%' then
      continue;
    end if;

    garde := format(
      'if not public.automatisation_active(%L) then return coalesce(new, old); end if;',
      r.drapeau
    );

    -- Insertion après le `begin` du corps. Attention : un bloc `declare` peut
    -- s'intercaler entre `$function$` et `begin`, d'où la recherche du premier
    -- `begin` en début de ligne plutôt que d'un `$function$ begin` accolé.
    def := regexp_replace(def, '\mbegin\M', E'begin\n  ' || garde, 'i');
    execute def;
  end loop;
end
$wrap$;

-- ---------- 4) Les crons passent par un garde ----------

create or replace function public.rafraichir_taches_si_actif()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.automatisation_active('auto_taches') then return; end if;
  perform public.rafraichir_taches();
end
$$;

create or replace function public.traiter_rappels_si_actif()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.automatisation_active('auto_rappels') then return; end if;
  perform public.traiter_rappels();
end
$$;

create or replace function public.traiter_recontacts_si_actif()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.automatisation_active('auto_recontacts') then return; end if;
  perform public.traiter_recontacts();
end
$$;

create or replace function public.surveiller_coherence_si_actif()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.automatisation_active('auto_coherence') then return; end if;
  perform public.surveiller_coherence();
end
$$;

-- ---------- 5) Rebranchement des tâches planifiées ----------

select cron.alter_job(
  (select jobid from cron.job where jobname = 'taches_tick'),
  command => 'select public.rafraichir_taches_si_actif();'
) where exists (select 1 from cron.job where jobname = 'taches_tick');

select cron.alter_job(
  (select jobid from cron.job where jobname = 'rappels_tick'),
  command => 'select public.traiter_rappels_si_actif();'
) where exists (select 1 from cron.job where jobname = 'rappels_tick');

select cron.alter_job(
  (select jobid from cron.job where jobname = 'recontacts_tick'),
  command => 'select public.traiter_recontacts_si_actif();'
) where exists (select 1 from cron.job where jobname = 'recontacts_tick');

select cron.alter_job(
  (select jobid from cron.job where jobname = 'coherence_tick'),
  command => 'select public.surveiller_coherence_si_actif();'
) where exists (select 1 from cron.job where jobname = 'coherence_tick');
