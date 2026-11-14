begin;
-- Droits Supabase déjà présents en production, absents du socle PGlite.
-- Les RLS de production restent actives pour les appels sous authenticated.
grant usage on schema auth to authenticated;
grant select on public.membres, public.projets to authenticated;
do $audit$
declare f uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); p uuid; prive uuid; a uuid; r jsonb;
begin
  insert into auth.users(id) values(f),(c);
  insert into public.membres(user_id,role,nom,actif) values(f,'fondateur','Fictif recherche',true),(c,'commercial','Commercial fictif recherche',true);
  insert into public.projets(client_nom,client_ville,client_telephone,client_email,client_code_postal,metier,metiers,created_by,masque_agence_at)
    values('Émilie Zyxrecherche','Évian-les-Bains','06 12 34 56 78','emilie@zyxrecherche.test','74500','Couverture',array['Couverture'],c,now()) returning id into p;
  insert into public.projets(client_nom,client_ville,metier,metiers,created_by)
    values('Dossier confidentiel Zyxrecherche','Évian-les-Bains','Couverture',array['Couverture'],f) returning id into prive;
  insert into public.artisans(nom,prenom,societe,ville,telephone,email,metiers,partenaire_at,siren,ecarte_at)
    values('Zyxrecherche','André','Atelier Zyxrecherche','Évian-les-Bains','+33 6 98 76 54 32','contact@zyxrecherche.test',array['Couverture'],now(),'987654321',now()) returning id into a;
  perform set_config('request.jwt.claim.sub',f::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r:=public.recherche_globale('zyxrecherche');
  assert (r->>'total')::int=3, 'recherche globale incomplète';
  assert exists(select 1 from jsonb_array_elements(r->'resultats') x where x->>'id'=p::text and x->>'masque'='true'), 'projet masqué absent';
  assert exists(select 1 from jsonb_array_elements(r->'resultats') x where x->>'id'=a::text and x->>'type'='partenaire' and x->>'masque'='true'), 'partenaire écarté absent';
  r:=public.recherche_globale('+33 6 12 34 56 78');
  assert r->'resultats'->0->>'id'=p::text, 'téléphone international non retrouvé';
  r:=public.recherche_globale('0698765432');
  assert r->'resultats'->0->>'id'=a::text, 'téléphone français non retrouvé';
  r:=public.recherche_globale('0033698765432');
  assert r->'resultats'->0->>'id'=a::text, 'préfixe 0033 non retrouvé';
  r:=public.recherche_globale('CONTACT@ZYXRECHERCHE.TEST');
  assert r->'resultats'->0->>'id'=a::text, 'email insensible à la casse absent';
  assert (public.recherche_globale('emilie evian')->>'total')::int=1, 'accents ou mots croisés non gérés';
  assert (public.recherche_globale('74500')->>'total')::int=1, 'code postal absent';
  assert (public.recherche_globale('987654321')->>'total')::int=1, 'SIREN absent';
  assert (public.recherche_globale('%')->>'total')::int=0, 'joker public liste toutes les fiches';
  assert not exists(select 1 from jsonb_array_elements(r->'resultats') x where x ? 'token' or x ? 'iban'), 'données inutiles exposées';
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',c::text,true);
  execute 'set local role authenticated';
  r:=public.recherche_globale('zyxrecherche');
  assert (r->>'total')::int=2, 'périmètre commercial incorrect';
  assert not exists(select 1 from jsonb_array_elements(r->'resultats') x where x->>'id'=prive::text), 'RLS contournée';
  execute 'reset role';
  update public.projets set deleted_at=now() where id=p;
  execute 'set local role authenticated';
  assert (public.recherche_globale('emilie evian')->>'total')::int=0, 'fiche supprimée incluse';
  execute 'reset role';
  insert into public.projets(client_nom,metier,created_by)
    select 'Test limite Zyxrecherche ' || i, 'Couverture', c from generate_series(1,35) i;
  execute 'set local role authenticated';
  r:=public.recherche_globale('limite zyxrecherche');
  assert (r->>'total')::int=35 and jsonb_array_length(r->'resultats')=30, 'limite de résultats incorrecte';
  execute 'reset role';
  update public.membres set actif=false where user_id=c;
  execute 'set local role authenticated';
  begin
    perform public.recherche_globale('zyxrecherche');
    raise exception 'membre inactif autorisé';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  assert not has_function_privilege('anon','public.recherche_globale(text)','execute'), 'recherche publique';
end
$audit$;
rollback;
