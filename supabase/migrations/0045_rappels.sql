-- 0045 — Rappels internes : une tâche to-do datée qui s'envoie par email à l'échéance.
-- Un rappel = ligne `taches` (categorie='rappel') avec rappel_at = échéance. À l'heure
-- dite, traiter_rappels() POST l'event n8n 'rappel_interne' (email « T'AS DU TAFF »)
-- puis marque notifie_at pour ne jamais renvoyer. La tâche reste dans la to-do jusqu'à
-- ce qu'elle soit cochée (puis purge auto 24 h comme les autres tâches).

alter table public.taches add column if not exists notifie_at timestamptz;  -- email rappel envoyé
alter table public.taches add column if not exists rappel_pour text;         -- nom pour l'objet (« Thomas »)
alter table public.taches add column if not exists rappel_email text;         -- destinataire (null = boîte agence)

-- Envoie les emails des rappels arrivés à échéance (idempotent via notifie_at).
create or replace function public.traiter_rappels()
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  WEBHOOK constant text := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events';
  BASE constant text := 'https://crm-ci7k.vercel.app';
begin
  for r in
    select t.* from public.taches t
    where t.categorie = 'rappel'
      and t.statut = 'a_faire'
      and t.notifie_at is null
      and t.rappel_at is not null
      and t.rappel_at <= now()
  loop
    perform net.http_post(
      url := WEBHOOK,
      body := jsonb_build_object(
        'event', 'rappel_interne',
        'to', r.rappel_email,
        'pour', r.rappel_pour,
        'titre', r.titre,
        'details', r.details,
        'echeance', to_char(r.rappel_at at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI'),
        'lien', case
                  when r.projet_id is not null then BASE || '/projets/' || r.projet_id
                  else BASE || '/taches'
                end
      ),
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
    update public.taches set notifie_at = now() where id = r.id;
  end loop;
end;
$$;

-- Planification toutes les 5 min (rappels ponctuels même appli fermée).
create extension if not exists pg_cron with schema extensions;
select cron.unschedule('rappels_tick') where exists (select 1 from cron.job where jobname = 'rappels_tick');
select cron.schedule('rappels_tick', '*/5 * * * *', $$ select public.traiter_rappels(); $$);
