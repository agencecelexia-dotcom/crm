-- Suppression définitive d'un projet (0199) : le commercial efface sa propre
-- erreur de saisie, jamais un dossier engagé ni celui d'un autre ; le
-- fondateur efface tout, et plus rien ne reste en base.
begin;
do $audit$
declare
  f uuid := gen_random_uuid(); c uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  p_erreur uuid; p_autre uuid; p_engage uuid; a uuid;
begin
  insert into auth.users(id) values(f),(c),(c2);
  insert into public.membres(user_id,role,nom) values
    (f,'fondateur','Fictif'),(c,'commercial','Fictif commercial'),(c2,'commercial','Fictif commercial 2');
  perform set_config('request.jwt.claim.role','authenticated',true);

  insert into public.projets(client_nom,metier,created_by) values('Fictif erreur','Couverture',c) returning id into p_erreur;
  insert into public.projets(client_nom,metier,created_by) values('Fictif autre','Couverture',c2) returning id into p_autre;
  insert into public.projets(client_nom,metier,created_by) values('Fictif engagé','Couverture',c) returning id into p_engage;
  insert into public.projet_notes(projet_id,contenu) values(p_erreur,'note fictive');
  insert into public.artisans(nom,contrat_externe) values('Fictif suppression',true) returning id into a;
  insert into public.affectations(projet_id,artisan_id,statut) values(p_engage,a,'artisan_assigne');

  -- Le commercial efface sa propre erreur, et ce qui en dépend part avec.
  perform set_config('request.jwt.claim.sub',c::text,true);
  assert public.supprimer_projet_definitivement(p_erreur)->>'ok'='true', 'suppression refusée';
  assert not exists(select 1 from public.projets where id=p_erreur), 'projet encore en base';
  assert not exists(select 1 from public.projet_notes where projet_id=p_erreur), 'notes orphelines';

  -- Pas le dossier d'un autre commercial.
  begin
    perform public.supprimer_projet_definitivement(p_autre);
    raise exception 'un commercial a supprimé le dossier d’un autre';
  exception when insufficient_privilege or no_data_found then null;
  end;
  assert exists(select 1 from public.projets where id=p_autre), 'dossier d’un autre supprimé';

  -- Pas un dossier déjà passé chez un artisan.
  begin
    perform public.supprimer_projet_definitivement(p_engage);
    raise exception 'un commercial a supprimé un dossier engagé';
  exception when insufficient_privilege then null;
  end;
  assert exists(select 1 from public.affectations where projet_id=p_engage), 'historique artisan perdu';

  -- Sans session : rien.
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.supprimer_projet_definitivement(p_autre);
    raise exception 'suppression anonyme acceptée';
  exception when insufficient_privilege then null;
  end;

  -- Le fondateur tranche, même sur un dossier engagé.
  perform set_config('request.jwt.claim.sub',f::text,true);
  perform public.supprimer_projet_definitivement(p_engage);
  assert not exists(select 1 from public.projets where id=p_engage), 'fondateur bloqué';
  assert not exists(select 1 from public.affectations where projet_id=p_engage), 'affectation orpheline';
end
$audit$;
rollback;
