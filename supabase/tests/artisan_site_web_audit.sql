-- Site web de l'artisan (0201). Exécuté sur PostgreSQL LOCAL jetable ; tout est annulé.
begin;
do $audit$
declare l public.liens_inscription_artisan; r json; v_id uuid; u uuid := gen_random_uuid();
begin
  -- 1. Normalisation : adresse web complétée, tout le reste refusé.
  assert public.normaliser_site_web(' www.atelier-fictif.fr ') = 'https://www.atelier-fictif.fr', 'www sans schéma non complété';
  assert public.normaliser_site_web('http://atelier.fr/accueil?x=1') = 'http://atelier.fr/accueil?x=1', 'adresse complète modifiée';
  assert public.normaliser_site_web('javascript:alert(1)') is null, 'javascript: accepté';
  assert public.normaliser_site_web('https://user@atelier.fr') is null, 'identifiants dans l’adresse acceptés';
  assert public.normaliser_site_web('non') is null, 'texte libre accepté';
  assert public.normaliser_site_web('mon site . fr') is null, 'espaces acceptés';
  assert public.normaliser_site_web('') is null and public.normaliser_site_web(null) is null, 'vide non nul';

  -- 2. Inscription publique : le site est enregistré, une adresse invalide est refusée.
  select * into l from public.liens_inscription_artisan where canal = 'email' and taux = 20;
  execute 'set local role anon';
  r := public.inscrire_artisan(jsonb_build_object('nom', 'Audit site', 'societe', 'Atelier fictif',
    'invitation_token', l.token, 'site_web', 'www.atelier-fictif.fr'));
  execute 'reset role';
  assert r->>'ok' = 'true', 'inscription avec site refusée';
  v_id := (r->>'id')::uuid;
  assert (select site_web from public.artisans where id = v_id) = 'https://www.atelier-fictif.fr', 'site non enregistré';

  execute 'set local role anon';
  r := public.inscrire_artisan(jsonb_build_object('nom', 'Audit site', 'societe', 'Atelier fictif',
    'invitation_token', l.token, 'site_web', 'javascript:alert(1)'));
  execute 'reset role';
  assert r->>'ok' = 'false' and r->>'error' like '%site web%', 'adresse dangereuse acceptée à l’inscription';

  execute 'set local role anon';
  r := public.inscrire_artisan(jsonb_build_object('nom', 'Audit sans site', 'invitation_token', l.token));
  execute 'reset role';
  assert r->>'ok' = 'true', 'inscription sans site refusée';
  assert (select site_web is null from public.artisans where id = (r->>'id')::uuid), 'site inventé';

  -- 3. L'équipe lit et corrige le site ; la base refuse un lien non web.
  insert into auth.users(id) values (u);
  insert into public.membres(user_id, role, nom, actif) values (u, 'fondateur', 'Fondateur fictif', true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.artisans set site_web = 'https://atelier-corrige.fr' where id = v_id;
  assert (select site_web from public.artisans where id = v_id) = 'https://atelier-corrige.fr', 'correction refusée';
  begin
    update public.artisans set site_web = 'javascript:alert(1)' where id = v_id;
    raise exception 'AUDIT: lien javascript: enregistré';
  exception when check_violation then null;
  end;
  execute 'reset role';
end
$audit$;
rollback;
