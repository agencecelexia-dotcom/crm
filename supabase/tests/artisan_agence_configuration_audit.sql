begin;
do $audit$
declare
  f uuid := gen_random_uuid(); c uuid := gen_random_uuid(); p uuid; a uuid; af uuid;
  ancien timestamptz := '2026-01-01'; r jsonb; avant jsonb;
begin
  insert into auth.users(id) values(f),(c);
  insert into public.membres(user_id,role,nom) values(f,'fondateur','Fictif'),(c,'commercial','Fictif commercial');
  perform set_config('request.jwt.claim.sub',f::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  insert into public.artisans(nom,contrat_externe) values('Fictif masquage',true) returning id into a;
  insert into public.projets(client_nom,client_telephone,metier,created_by,updated_at)
    values('Fictif masquage','0600000000','Couverture',f,ancien) returning id into p;
  insert into public.affectations(projet_id,artisan_id,statut,montant_devis_signe)
    values(p,a,'artisan_assigne',null) returning id into af;
  update public.affectations set statut='devis_signe',montant_devis_signe=1000 where id=af;
  update public.projets set montant_devis_signe=1000,statut='devis_signe' where id=p;
  select updated_at, to_jsonb(projets) - 'masque_agence_at' into ancien, avant from public.projets where id=p;
  assert exists(select 1 from public.commissions_dues() where projet_id=p), 'fixture sans commission';
  r := public.masquer_projet(p,true);
  assert r->>'ok'='true', 'masquage refusé';
  assert (select masque_agence_at is not null and deleted_at is null and updated_at=ancien from public.projets where id=p), 'masquage destructif ou date métier modifiée';
  assert (select to_jsonb(projets)-'masque_agence_at'=avant from public.projets where id=p), 'historique modifié par masquage';
  assert exists(select 1 from public.commissions_dues() where projet_id=p), 'commission cachée par archivage';
  perform public.masquer_projet(p,false);
  assert (select masque_agence_at is null from public.projets where id=p), 'restauration échouée';
  perform set_config('request.jwt.claim.sub',c::text,true);
  begin
    perform public.masquer_projet(p,true);
    raise exception 'un commercial a masqué le dossier d’un autre';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.masquer_projet(p,true);
    raise exception 'masquage sans session accepté';
  exception when insufficient_privilege then null;
  end;
  r := public.fonctionnalites_espace_artisan();
  assert r->>'devis'='false' and r->>'metres'='false' and r->>'chantiers'='true', 'défauts incorrects';
  assert r->>'entreprise'='true' and r->>'aide'='true' and r->>'commissions'='true', 'rubrique demandée absente';
  assert (select count(*) from jsonb_object_keys(r))=6, 'autres paramètres exposés';
  assert not has_table_privilege('anon','public.fonctionnalites_artisan','update'), 'configuration modifiable publiquement';
  assert not has_table_privilege('authenticated','public.invitations_artisans','insert'), 'journal falsifiable';
  assert not has_table_privilege('anon','public.invitations_artisans','select'), 'destinataires publics';
  assert not has_function_privilege('anon','public.masquer_projet(uuid,boolean)','execute'), 'masquage ouvert publiquement';
  perform set_config('request.jwt.claim.sub',c::text,true);
  execute 'set local role authenticated';
  update public.fonctionnalites_artisan set active=true where cle='devis';
  execute 'reset role';
  assert (select not active from public.fonctionnalites_artisan where cle='devis'), 'un commercial modifie les fonctionnalités';
  perform set_config('request.jwt.claim.sub',f::text,true);
  execute 'set local role authenticated';
  update public.fonctionnalites_artisan set active=true where cle='devis';
  execute 'reset role';
  assert public.fonctionnalites_espace_artisan()->>'devis'='true', 'le fondateur ne peut pas réactiver';
end
$audit$;
rollback;
