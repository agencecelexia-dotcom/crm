-- Le garde-fou existait mais ne tournait jamais.
--
-- `verifier_coherence_metriques()` n'était branchée sur aucun cron : elle ne
-- s'exécutait que si quelqu'un pensait à l'appeler. Une règle pouvait donc
-- casser pendant des semaines sans que rien ne le signale — c'est exactement
-- ce qui s'est produit avec les 26 anomalies de niveau projet.
--
-- Cette migration ajoute la surveillance : une vérification quotidienne qui
-- crée une notification agence dès qu'une règle tombe.

create or replace function public.surveiller_coherence()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res    jsonb;
  v_cle    text;
  v_val    jsonb;
  v_alertes text[] := '{}';
  v_msg    text;
begin
  v_res := public.verifier_coherence_metriques()::jsonb;

  for v_cle, v_val in select * from jsonb_each(v_res) loop
    -- Deux formes de règles : les booléennes (`*_ok`, vraies quand tout va
    -- bien) et les compteurs (sains quand ils valent zéro).
    if v_cle like '%\_ok' then
      if v_val::text <> 'true' then
        v_alertes := v_alertes || v_cle;
      end if;
    elsif (v_val::text)::numeric > 0 then
      v_alertes := v_alertes || format('%s (%s)', v_cle, v_val::text);
    end if;
  end loop;

  if array_length(v_alertes, 1) is null then
    return;
  end if;

  v_msg := 'Incohérence détectée : ' || array_to_string(v_alertes, ', ');

  -- Une seule notification par jour, même si le cron passe plusieurs fois :
  -- une alerte répétée devient du bruit qu'on finit par ignorer.
  if exists (
    select 1 from public.notifications
     where type = 'coherence'
       and created_at > now() - interval '20 hours'
  ) then
    return;
  end if;

  -- `titre` est NOT NULL : c'est lui qui s'affiche dans la cloche.
  insert into public.notifications (type, titre, message)
  values ('coherence',
          format('%s incohérence(s) détectée(s)', array_length(v_alertes, 1)),
          v_msg);
end $$;

comment on function public.surveiller_coherence() is
  'Vérifie les 14 règles de cohérence et crée une notification agence si l''une casse. Planifiée quotidiennement.';

revoke execute on function public.surveiller_coherence() from public, anon;
grant execute on function public.surveiller_coherence() to service_role, authenticated;

-- 7 h du matin : l'alerte est là au démarrage de la journée, et le contrôle
-- tourne sur une base au repos.
select cron.unschedule('coherence_tick')
 where exists (select 1 from cron.job where jobname = 'coherence_tick');

select cron.schedule('coherence_tick', '0 7 * * *',
                     $cron$select public.surveiller_coherence()$cron$);
