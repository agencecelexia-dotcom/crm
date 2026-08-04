-- ============================================================
--  0067 — Correctif : rétablir le dépôt de devis par l'artisan.
--
--  Bug introduit par 0066 : la policy `devis_insert_token` contenait
--    exists (select 1 from public.affectations a where a.token = ...)
--  Or le prédicat d'une policy s'évalue avec les droits du RÔLE APPELANT.
--  L'artisan appelle en tant que `anon`, et `affectations` a la RLS activée
--  avec une seule policy réservée à `authenticated` : la sous-requête ne voit
--  donc aucune ligne et renvoie toujours faux.
--
--  Symptôme : 403 « new row violates row-level security policy » sur tout
--  dépôt de devis, alors que le prédicat testé isolément valait bien `true`.
--
--  Correctif : encapsuler la vérification dans une fonction SECURITY DEFINER,
--  qui s'exécute avec les droits du propriétaire et contourne donc la RLS.
--
--  La fonction ne renvoie qu'un booléen : elle indique si un token existe,
--  sans divulguer aucune donnée. L'oracle est négligeable, les tokens faisant
--  122 bits d'entropie (gen_random_uuid).
-- ============================================================

create or replace function public.token_affectation_valide(p_token text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.affectations a
     where a.token = p_token
       and a.retire_at is null
  );
$function$;

comment on function public.token_affectation_valide(text) is
  'Vérifie qu''un token d''affectation est valide et non révoqué. Utilisée par '
  'la policy storage devis_insert_token : le prédicat d''une policy s''évalue '
  'avec les droits de l''appelant (anon), qui ne peut pas lire affectations.';

revoke execute on function public.token_affectation_valide(text) from public;
grant  execute on function public.token_affectation_valide(text) to anon, authenticated;

-- Rejouer la policy de dépôt avec la fonction.
drop policy if exists "devis_insert_token" on storage.objects;
create policy "devis_insert_token" on storage.objects
  for insert to anon with check (
    bucket_id = 'devis'
    and public.token_affectation_valide(split_part(name, '/', 1))
  );
