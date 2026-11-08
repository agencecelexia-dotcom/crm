-- Isolation d'accès aux bâtiments : base locale jetable, aucun appel fournisseur.
begin;
do $audit$
declare a uuid; autre uuid; p uuid; r json;
begin
  insert into public.artisans(nom, contrat_externe, token)
  values ('Photos fictives autorisées', true, 'audit-local-photos') returning id into a;
  insert into public.artisans(nom, contrat_externe, token)
  values ('Autre artisan fictif photos', true, 'audit-local-autre-photos') returning id into autre;
  insert into public.projets(client_nom, metier, statut, batiment_cleabs)
  values ('Client fictif photos', 'Couverture', 'nouveau', 'BATIMENT0000000000000001') returning id into p;
  insert into public.affectations(projet_id, artisan_id, token)
  values (p, a, 'audit-local-affectation-photos');

  r := public.autoriser_photos_batiment('audit-local-photos', 'BATIMENT0000000000000001');
  if not (r->>'ok')::boolean then raise exception 'AUDIT: accès légitime refusé %', r; end if;
  r := public.autoriser_photos_batiment('audit-local-autre-photos', 'BATIMENT0000000000000001');
  if r->>'error' <> 'batiment_non_attribue' then raise exception 'AUDIT: autre artisan accepté %', r; end if;
  r := public.autoriser_photos_batiment('audit-local-photos', 'BATIMENT0000000000000002');
  if r->>'error' <> 'batiment_non_attribue' then raise exception 'AUDIT: autre bâtiment accepté %', r; end if;

  update public.artisans set contrat_externe = false where id = a;
  r := public.autoriser_photos_batiment('audit-local-photos', 'BATIMENT0000000000000001');
  if r->>'error' <> 'contrat_requis' then raise exception 'AUDIT: accès avant signature accepté %', r; end if;
  update public.artisans set contrat_externe = true where id = a;
  update public.affectations set retire_at = now() where token = 'audit-local-affectation-photos';
  r := public.autoriser_photos_batiment('audit-local-photos', 'BATIMENT0000000000000001');
  if r->>'error' <> 'batiment_non_attribue' then raise exception 'AUDIT: affectation retirée acceptée %', r; end if;
  update public.affectations set retire_at = null, masque_at = now() where token = 'audit-local-affectation-photos';
  r := public.autoriser_photos_batiment('audit-local-photos', 'BATIMENT0000000000000001');
  if r->>'error' <> 'batiment_non_attribue' then raise exception 'AUDIT: affectation masquée acceptée %', r; end if;
  update public.affectations set masque_at = null where token = 'audit-local-affectation-photos';
  update public.projets set deleted_at = now() where id = p;
  r := public.autoriser_photos_batiment('audit-local-photos', 'BATIMENT0000000000000001');
  if r->>'error' <> 'batiment_non_attribue' then raise exception 'AUDIT: projet supprimé accepté %', r; end if;
  update public.projets set deleted_at = null, statut = 'mort' where id = p;
  r := public.autoriser_photos_batiment('audit-local-photos', 'BATIMENT0000000000000001');
  if r->>'error' <> 'batiment_non_attribue' then raise exception 'AUDIT: projet mort accepté %', r; end if;
  update public.projets set statut = 'nouveau' where id = p;
  update public.artisans set ecarte_at = now() where id = a;
  r := public.autoriser_photos_batiment('audit-local-photos', 'BATIMENT0000000000000001');
  if r->>'error' <> 'token_invalide' then raise exception 'AUDIT: artisan écarté accepté %', r; end if;
end
$audit$;
rollback;
