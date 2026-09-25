-- La pré-mesure : les métrés d'un chantier prêts avant que l'artisan n'ouvre
-- sa fiche (fonction `pre-metre`).
--
-- Toute automatisation a son interrupteur, lu par le traitement lui-même
-- (catalogue.ts) : « auto_pre_metre », dans Paramètres › Automatisations. La
-- tâche planifiée le lit avant d'appeler la fonction, et la fonction le relit.
--
-- La fonction n'accepte que la tâche planifiée : une clé partagée, gardée ici
-- dans le coffre (`pre_metre_cle`) et, côté fonction, dans ses secrets
-- (PRE_METRE_CLE). Sans clé dans le coffre, la tâche ne fait rien.

-- La dernière tentative : un chantier sans maison sûre ne revient qu'une fois par jour.
alter table public.projets add column if not exists metrage_tente_le timestamptz;

insert into public.app_settings (cle, valeur) values ('auto_pre_metre', 'on')
on conflict (cle) do nothing;

-- Les chantiers à pré-mesurer : attribués à un artisan, à adresse numérotée,
-- sans aucune mesure au dossier, pas tentés depuis un jour. Les plus récents
-- d'abord : ce sont ceux que les artisans ouvrent.
create or replace function public.projets_a_premesurer(p_limite integer default 6)
returns table (
  id uuid, client_adresse text, client_code_postal text, client_ville text,
  latitude numeric, longitude numeric,
  batiment_cleabs text, batiment_source text, batiment_confirme_at timestamptz,
  batiment_lon numeric, batiment_lat numeric
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p.id, p.client_adresse, p.client_code_postal, p.client_ville,
         p.latitude::numeric, p.longitude::numeric,
         p.batiment_cleabs, p.batiment_source, p.batiment_confirme_at,
         p.batiment_lon, p.batiment_lat
    from public.projets p
   where p.deleted_at is null
     and p.statut not in ('mort', 'termine', 'perdu', 'artisan_demarche', 'demarchage')
     and p.client_adresse ~ '^\s*\d'
     and exists (select 1 from public.affectations a where a.projet_id = p.id and a.retire_at is null)
     and not exists (select 1 from public.metrage_chantier m where m.projet_id = p.id and m.valeur_mesuree is not null)
     and (p.metrage_tente_le is null or p.metrage_tente_le < now() - interval '1 day')
   order by p.created_at desc
   limit greatest(1, least(coalesce(p_limite, 6), 20));
$function$;

create or replace function public.marquer_premesure(p_projet_id uuid)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update public.projets set metrage_tente_le = now() where id = p_projet_id;
$function$;

revoke execute on function public.projets_a_premesurer(integer) from public, anon, authenticated;
revoke execute on function public.marquer_premesure(uuid) from public, anon, authenticated;
grant execute on function public.projets_a_premesurer(integer) to service_role;
grant execute on function public.marquer_premesure(uuid) to service_role;

-- Le déclencheur planifié.
create or replace function public.pre_metre_si_actif()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_cle text;
begin
  if not public.automatisation_active('auto_pre_metre') then return; end if;
  select decrypted_secret into v_cle from vault.decrypted_secrets where name = 'pre_metre_cle';
  if v_cle is null then return; end if;
  perform net.http_post(
    url := 'https://oymnthijjbwkatrhqzvi.supabase.co/functions/v1/pre-metre',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cle-pre-metre', v_cle),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end
$function$;

revoke execute on function public.pre_metre_si_actif() from public, anon, authenticated;

select cron.schedule('pre_metre_tick', '*/10 * * * *', 'select public.pre_metre_si_actif();');
