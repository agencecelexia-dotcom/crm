-- 0054 — Notif email INTERNE quand un artisan s'auto-inscrit (lien Facebook/WhatsApp…).
-- Trigger sur insertion d'un artisan source 'auto:%' → POST n8n (event nouvel_artisan_inscrit)
-- → email à l'agence. Découplé de inscrire_artisan (fiabilité).

create or replace function public.notif_artisan_inscrit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source like 'auto:%' then
    perform net.http_post(
      url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
      body := jsonb_build_object(
        'event', 'nouvel_artisan_inscrit',
        'canal', coalesce(nullif(split_part(new.source, ':', 2), ''), 'le lien'),
        'nom', trim(coalesce(new.prenom, '') || ' ' || coalesce(new.nom, '')),
        'societe', new.societe,
        'telephone', new.telephone,
        'email', new.email,
        'ville', new.ville,
        'metiers', array_to_string(new.metiers, ', '),
        'lien', 'https://crm-ci7k.vercel.app/artisans/' || new.id
      ),
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notif_artisan_inscrit on public.artisans;
create trigger trg_notif_artisan_inscrit
  after insert on public.artisans
  for each row execute function public.notif_artisan_inscrit();
