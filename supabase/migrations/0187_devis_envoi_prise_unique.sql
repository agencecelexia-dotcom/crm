-- Consommation durable d'une tentative AVANT le noeud de messagerie.
-- Un webhook rejoué ne doit jamais soumettre une deuxième fois le même mail.
-- Cette prise ne confirme pas la livraison : le workflow confirme ensuite
-- sa prise en charge, ou la tentative demeure à vérifier en cas d'incertitude.
alter table public.devis
  add column if not exists envoi_pris_at timestamptz;

create unique index if not exists devis_envoi_cle_unique
  on public.devis(envoi_cle) where envoi_cle is not null;

create or replace function public.prendre_envoi_devis(p_cle uuid)
returns boolean
language sql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with prise as (
    update public.devis
       set envoi_pris_at = now()
     where envoi_cle = p_cle
       and statut = 'brouillon'
       and envoi_etat = 'en_cours'
       and envoi_pris_at is null
    returning id
  )
  select exists(select 1 from prise);
$function$;

-- Le callback edge contrôle son secret avant d'utiliser service_role.
-- Ni le navigateur ni un jeton artisan ne peuvent consommer cette prise.
revoke execute on function public.prendre_envoi_devis(uuid) from public, anon, authenticated;
grant execute on function public.prendre_envoi_devis(uuid) to service_role;
