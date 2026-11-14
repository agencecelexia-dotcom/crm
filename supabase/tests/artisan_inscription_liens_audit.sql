begin;
do $audit$
declare f uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); l record; r jsonb;
  jeton text; nb bigint; v_artisan_id uuid; contenu text;
begin
  insert into auth.users(id) values(f),(c);
  insert into public.membres(user_id,role,nom,actif,peut_creer_artisan)
    values(f,'fondateur','Fondateur fictif',true,false),(c,'commercial','Commercial fictif',true,false);
  assert (select count(*)=15 and count(distinct token)=15 from public.liens_inscription_artisan), 'liens manquants ou confondus';
  assert not has_table_privilege('anon','public.liens_inscription_artisan','select'), 'liste des jetons publique';
  assert not has_table_privilege('authenticated','public.liens_inscription_artisan','select'), 'liste des jetons lisible hors RPC contrôlée';
  assert not has_table_privilege('authenticated','public.liens_inscription_artisan','update'), 'taux du lien modifiable';
  assert not has_function_privilege('anon','public.liens_inscription_agence()','execute'), 'RPC de liste publique';
  perform set_config('request.jwt.claim.sub',f::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  assert jsonb_array_length(public.liens_inscription_agence())=15, 'fondateur sans liens';
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',c::text,true);
  begin
    perform public.liens_inscription_agence();
    raise exception 'commercial non autorisé lit les liens';
  exception when insufficient_privilege then null;
  end;
  update public.membres set peut_creer_artisan=true where user_id=c;
  assert jsonb_array_length(public.liens_inscription_agence())=15, 'invitation autorisée refusée';
  update public.membres set actif=false where user_id=c;
  begin
    perform public.liens_inscription_agence();
    raise exception 'membre inactif lit les liens';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','anon',true);

  for l in select * from public.liens_inscription_artisan where canal='email' loop
    execute 'set local role anon';
    r:=public.lien_inscription_artisan(l.token);
    assert r=jsonb_build_object('ok',true,'taux',l.taux,'canal','email'), 'résolution incorrecte ou fuite de données';
    -- Même un appel direct trafiqué ne peut imposer un autre taux/canal.
    r:=public.inscrire_artisan(jsonb_build_object('nom','Test inscription sécurisé', 'societe','Atelier fictif',
      'invitation_token',l.token, 'taux_commission','valeur malveillante', 'source','agence'));
    execute 'reset role';
    assert r->>'ok'='true', 'inscription valide refusée';
    v_artisan_id:=(r->>'id')::uuid;
    assert (select taux_commission=l.taux::numeric/100 and source='auto:email' from public.artisans where id=v_artisan_id), 'taux ou canal falsifié';
    assert (r->>'taux_commission')::numeric=l.taux::numeric/100, 'taux confirmé incorrect';
    select c.contenu into contenu from public.contrats c where c.artisan_id=v_artisan_id;
    assert contenu like '%' || l.taux || ' % du Montant TTC%', 'contrat au mauvais taux';
  end loop;

  select count(*) into nb from public.artisans;
  execute 'set local role anon';
  r:=public.inscrire_artisan('{"nom":"Ancien lien", "taux_commission":0.10, "source":"auto:email"}');
  assert r->>'ok'='false', 'inscription sans jeton acceptée';
  r:=public.inscrire_artisan(jsonb_build_object('nom','Jeton forgé','invitation_token',repeat('0',64),'taux_commission',0.1));
  assert r->>'ok'='false', 'jeton forgé accepté';
  assert public.lien_inscription_artisan(repeat('0',64))->>'ok'='false', 'résolution forgée acceptée';
  execute 'reset role';
  select token into jeton from public.liens_inscription_artisan where canal='email' and taux=20;
  update public.liens_inscription_artisan set actif=false where token=jeton;
  execute 'set local role anon';
  assert public.lien_inscription_artisan(jeton)->>'ok'='false', 'lien révoqué encore ouvert';
  r:=public.inscrire_artisan(jsonb_build_object('nom','Lien révoqué','invitation_token',jeton));
  assert r->>'ok'='false', 'lien révoqué utilisable';
  execute 'reset role';
  assert (select count(*)=nb from public.artisans), 'un refus a créé un artisan';
end
$audit$;
rollback;
