-- Aucun modèle IA appelé : vérification du rattachement réel des prix en SQL.
begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); prix uuid:=gen_random_uuid();
  jeton text:='audit-prix-'||gen_random_uuid(); r json; lignes jsonb;
begin
  insert into public.artisans(id,nom,token,metiers) values(a,'Artisan fictif prix',jeton,array['Couverture']);
  insert into public.artisans(id,nom,token) values(b,'Autre artisan fictif prix','audit-autre-prix-'||b);
  insert into public.devis_prix(id,artisan_id,designation,unite,prix_unitaire)
    values(prix,a,'Nettoyage toiture','m2',15);
  lignes:=jsonb_build_array(jsonb_build_object('designation','Nettoyage toiture','unite','m2','quantite',80,'prix_id',prix,'prix_unitaire',999,'source','reference'));
  r:=public.garnir_lignes_by_token(jeton,lignes,'Couverture',null);
  assert (r->'lignes'->0->>'prix_unitaire')::numeric=15, 'prix IA conservé au lieu du tarif réel';
  assert r->'lignes'->0->>'source'='bibliotheque', 'source IA conservée';
  r:=public.garnir_lignes_by_token(jeton,jsonb_set(lignes,'{0,unite}','"u"'),'Couverture',null);
  assert r->'lignes'->0->>'prix_unitaire' is null, 'prix au m² réutilisé à l’unité';
  r:=public.garnir_lignes_by_token('audit-autre-prix-'||b,lignes,'Couverture',null);
  assert r->'lignes'->0->>'prix_unitaire' is null, 'tarif privé visible à un autre artisan';
  r:=public.garnir_lignes_by_token(jeton,lignes #- '{0,prix_id}','Couverture',null);
  assert r->'lignes'->0->>'prix_unitaire' is null, 'prix inventé accepté sans provenance';
  update public.artisans set ecarte_at=now() where id=a;
  r:=public.garnir_lignes_by_token(jeton,lignes,'Couverture',null);
  assert not (r->>'ok')::boolean, 'artisan écarté peut obtenir les tarifs';
end $$;
rollback;
