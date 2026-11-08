-- Réessais persistants et qualification client, sur fixtures locales annulées.
begin;
select set_config('request.jwt.claim.role', 'anon', true);
do $audit$
declare
  a uuid; p uuid; p2 uuid; af uuid; af2 uuid;
  cle uuid := gen_random_uuid(); cle_appel uuid := gen_random_uuid(); cle_perte uuid := gen_random_uuid();
  r json; etat public.affectations; n int; recus int;
begin
  insert into public.artisans(nom,contrat_externe) values('Audit rejouement fictif',true) returning id into a;
  insert into public.projets(client_nom,metier,statut) values('Client fictif A','Couverture','nouveau') returning id into p;
  insert into public.projets(client_nom,metier,statut) values('Client fictif B','Couverture','nouveau') returning id into p2;
  insert into public.affectations(projet_id,artisan_id,token) values(p,a,'audit-rejeu-suivi-A') returning id into af;
  insert into public.affectations(projet_id,artisan_id,token) values(p2,a,'audit-rejeu-suivi-B') returning id into af2;

  r := public.add_suivi_by_token('audit-rejeu-suivi-A',null,'Note privée fictive',null,cle,null);
  assert (r->>'ok')::boolean, 'première note refusée';
  r := public.add_suivi_by_token('audit-rejeu-suivi-A',null,'Note privée fictive',null,cle,null);
  assert (r->>'ok')::boolean, 'rejeu de la note refusé';
  assert (select count(*)=1 from public.suivis where affectation_id=af), 'réponse perdue : note dupliquée';
  r := public.add_suivi_by_token('audit-rejeu-suivi-A',null,'Autre texte',null,cle,null);
  assert r->>'error'='idempotence_conflit', 'même clé avec contenu différent acceptée';
  assert (select count(*)=1 from public.suivis where affectation_id=af), 'conflit a écrit une note';
  -- La clé est cloisonnée par affectation ; une nouvelle intention identique est possible.
  r := public.add_suivi_by_token('audit-rejeu-suivi-B',null,'Note privée fictive',null,cle,null);
  assert (r->>'ok')::boolean, 'clé de l’autre affectation a bloqué la note';
  r := public.add_suivi_by_token('audit-rejeu-suivi-A',null,'Note privée fictive',null,gen_random_uuid(),null);
  assert (select count(*)=2 from public.suivis where affectation_id=af), 'deux intentions identiques fusionnées';

  r := public.log_appel_by_token('audit-rejeu-suivi-A','repondu',null,cle_appel);
  assert (r->>'ok')::boolean, 'appel refusé';
  perform public.log_appel_by_token('audit-rejeu-suivi-A','repondu',null,cle_appel);
  assert (select count(*)=1 from public.suivis where affectation_id=af and type='appel'), 'appel dupliqué';
  r := public.log_appel_by_token('audit-rejeu-suivi-A','rappeler',null,cle_appel);
  assert r->>'error'='idempotence_conflit', 'appel différent avec même clé accepté';
  r := public.log_appel_by_token('audit-rejeu-suivi-A','repondu',null,cle);
  assert r->>'error'='idempotence_conflit', 'clé de note réutilisée pour un appel';
  r := public.log_appel_by_token('audit-rejeu-suivi-A','repondu',null,null);
  assert r->>'error'='cle_requise', 'clé absente acceptée';
  select count(*) into recus from public.suivi_requetes_artisan where affectation_id=af;
  r := public.log_appel_by_token('audit-rejeu-suivi-A','resultat_inconnu',null,gen_random_uuid());
  assert r->>'error'='resultat_invalide', 'validation du résultat contournée';
  assert (select count(*)=recus from public.suivi_requetes_artisan where affectation_id=af), 'erreur métier mémorisée comme succès';

  -- Un garde-fou financier continue de refuser la perte avant toute qualification.
  perform public.add_suivi_by_token('audit-rejeu-suivi-A','devis_signe',null,null);
  update public.affectations set montant_devis_signe=100 where id=af;
  r := public.add_suivi_by_token('audit-rejeu-suivi-A','perdu','Le client a refusé',null,cle_perte,'prix_trop_eleve');
  assert r->>'error'='affaire_signee', 'perte signée autorisée par la surcharge';
  assert (select motif_perte is null from public.affectations where id=af), 'perte refusée a enregistré un motif';
  perform public.corriger_etape_by_token('audit-rejeu-suivi-A','contacte');
  select count(*) into n from public.suivis where affectation_id=af;
  r := public.add_suivi_by_token('audit-rejeu-suivi-A','perdu','Le client a refusé',null,cle_perte,null);
  assert r->>'error'='motif_requis', 'motif manquant accepté';
  r := public.add_suivi_by_token('audit-rejeu-suivi-A','perdu','Hors de ma zone',null,cle_perte,'hors_zone');
  assert r->>'error'='motif_non_autorise', 'refus artisan classé comme perte client';
  r := public.add_suivi_by_token('audit-rejeu-suivi-A','perdu','Non',null,cle_perte,'autre');
  assert r->>'error'='justification_requise', 'justification trop courte acceptée';
  assert (select count(*)=n from public.suivis where affectation_id=af), 'perte invalide a écrit un suivi';
  r := public.add_suivi_by_token('audit-rejeu-suivi-A','perdu','Le client a choisi ailleurs',null,cle_perte,'signe_concurrent');
  assert (r->>'ok')::boolean, 'perte qualifiée refusée';
  select * into etat from public.affectations where id=af;
  assert etat.statut='perdu' and etat.issue='perdu' and etat.retire_at is null, 'perte transformée en retrait';
  assert etat.motif_perte='signe_concurrent' and etat.origine_perte='client'
    and etat.motif_perte_detail='Le client a choisi ailleurs', 'motif client non enregistré';
  r := public.add_suivi_by_token('audit-rejeu-suivi-A','perdu','Le client a choisi ailleurs',null,cle_perte,'signe_concurrent');
  assert (r->>'ok')::boolean, 'accusé de perte inaccessible après clôture du projet';
  assert (select count(*)=n+1 from public.suivis where affectation_id=af), 'perte qualifiée rejouée';
  r := public.add_suivi_by_token('audit-rejeu-suivi-A',null,'Nouvelle note interdite',null,gen_random_uuid(),null);
  assert r->>'error'='projet_clos', 'nouvelle intention autorisée sur projet clos';
  r := public.retirer_chantier_by_token('audit-rejeu-suivi-B','Hors de mon secteur','hors_zone',null);
  assert (r->>'ok')::boolean, 'retrait historique refusé';
  assert (select origine_perte='artisan' and retire_at is not null from public.affectations where id=af2), 'distinction du retrait artisan perdue';

  -- Contrat et accès toujours contrôlés, y compris sur une clé déjà exécutée.
  update public.artisans set contrat_externe=false where id=a;
  r := public.log_appel_by_token('audit-rejeu-suivi-A','repondu',null,cle_appel);
  assert r->>'error'='contrat_requis', 'rejeu accepté après révocation du contrat : ' || r::text;
  assert not has_table_privilege('anon','public.suivi_requetes_artisan','select'), 'journal lisible publiquement';
  assert not has_table_privilege('authenticated','public.suivi_requetes_artisan','insert'), 'journal falsifiable par compte utilisateur';
  assert not has_function_privilege('anon','public.acces_accuse_suivi_par_jeton(text)','execute'), 'garde interne ouverte publiquement';
  assert has_function_privilege('anon','public.add_suivi_by_token(text,text,text,timestamptz,uuid,text)','execute'), 'nouvelle surcharge inaccessible';
  assert to_regprocedure('public.add_suivi_by_token(text,text,text,timestamptz)') is not null, 'ancienne signature supprimée';
  assert to_regprocedure('public.log_appel_by_token(text,text,text)') is not null, 'ancienne signature appel supprimée';
  raise notice 'Audit suivi : note/appel rejoués une fois, conflits/refus, motif client et retrait artisan distincts';
end
$audit$;

-- Si le reçu ne peut pas être écrit, la note elle-même doit être annulée.
create function pg_temp.refuser_accuse_audit() returns trigger language plpgsql as $test$
begin raise exception 'audit_accuse_indisponible'; end
$test$;
create trigger audit_refuser_accuse before insert on public.suivi_requetes_artisan
for each row execute function pg_temp.refuser_accuse_audit();
do $audit$
declare a uuid; p uuid; af uuid;
begin
  insert into public.artisans(nom,contrat_externe) values('Audit atomicité fictif',true) returning id into a;
  insert into public.projets(client_nom,metier,statut) values('Client fictif atomicité','Couverture','nouveau') returning id into p;
  insert into public.affectations(projet_id,artisan_id,token) values(p,a,'audit-rejeu-atomicite') returning id into af;
  begin
    perform public.add_suivi_by_token('audit-rejeu-atomicite',null,'Cette note doit être annulée',null,gen_random_uuid(),null);
    raise exception using errcode='XX000', message='échec du reçu non propagé';
  exception when raise_exception then
    assert sqlerrm='audit_accuse_indisponible', 'exception inattendue';
  end;
  assert (select count(*)=0 from public.suivis where affectation_id=af), 'note conservée sans reçu atomique';
  assert (select count(*)=0 from public.suivi_requetes_artisan where affectation_id=af), 'reçu partiel conservé';
end
$audit$;
rollback;
