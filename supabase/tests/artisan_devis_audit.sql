-- Exécuter sur la base locale de test après 0185. Toutes les données sont
-- fictives et l'ensemble est annulé ; aucun appel réseau réel.
begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); jeton text:='audit-devis-local-'||gen_random_uuid();
  cle uuid:=gen_random_uuid(); r json; r2 json; d uuid; numero text; envoi uuid; n integer; rev integer;
  payload jsonb;
begin
  insert into public.artisans(id,nom,token,contrat_externe,assurances_validees_at,assurance_decennale_echeance,assurance_rc_pro_echeance,cgv,iban)
    values(a,'Audit fictif',jeton,true,now(),current_date+365,current_date+365,'CGV fictives conservées','IBAN FICTIF');
  insert into public.artisans(id,nom,token,contrat_externe,assurances_validees_at)
    values(b,'Autre artisan fictif','audit-autre-'||b,true,now());
  r:=public.capacites_devis_by_token(jeton);
  assert (r->>'ok')::boolean and (r->>'version')::integer=2 and (r->>'sauvegarde_idempotente')::boolean and (r->>'revisions')::boolean, 'protocole de sauvegarde moderne non annoncé';
  r:=public.capacites_devis_by_token('jeton-inconnu-fictif'); assert not (r->>'ok')::boolean, 'capacités révélées à un jeton inconnu';
  update public.artisans set assurances_validees_at=null where id=b;
  r:=public.capacites_devis_by_token('audit-autre-'||b); assert r->>'error'='chiffrage_non_active', 'artisan non validé accepté';
  update public.artisans set assurances_validees_at=now(),contrat_externe=false where id=b;
  r:=public.capacites_devis_by_token('audit-autre-'||b); assert r->>'error'='contrat_requis', 'artisan sans contrat accepté';
  update public.artisans set contrat_externe=true where id=b;
  payload:=jsonb_build_object('idempotency_key',cle,'client_nom','Client fictif','client_email','client@example.test',
    'tva_mode','normal','acompte_pct',30,'conditions','Conditions fictives','email_html','Devis __NUMERO_DEVIS__',
    'email_subject','Devis __NUMERO_DEVIS__','document_data','{}'::jsonb,
    'lignes',jsonb_build_array(jsonb_build_object('designation','Prestation fictive','quantite',5,'prix_unitaire',33.33,'unite','u','tva_taux',10)));
  r:=public.creer_devis_by_token(jeton,payload);
  assert (r->>'ok')::boolean, 'création refusée'; d:=(r->>'id')::uuid; numero:=r->>'numero'; rev:=(r->>'revision')::integer;
  assert (r->>'total_ttc')::numeric=183.32, 'TTC différent du PDF';
  r2:=public.creer_devis_by_token(jeton,payload);
  assert r2->>'id'=d::text and r2->>'numero'=numero, 'réponse perdue : doublon créé';
  select count(*) into n from public.devis where artisan_id=a; assert n=1, 'deux devis pour une même clé';
  r:=public.devis_by_token(jeton,d); assert r->'devis'->>'conditions'='Conditions fictives', 'conditions perdues à la reprise';
  assert r->'devis'->>'numero'=numero, 'numéro perdu à la reprise';
  r:=public.creer_devis_by_token(jeton,payload||jsonb_build_object('devis_id',d,'expected_revision',rev,'objet','Objet corrigé'));
  assert r->>'id'=d::text and r->>'numero'=numero, 'édition recrée un numéro'; rev:=(r->>'revision')::integer;
  r:=public.devis_by_token('audit-autre-'||b,d); assert not (r->>'ok')::boolean, 'autre artisan peut lire le devis';
  r:=public.creer_devis_by_token(jeton,jsonb_set(payload,'{lignes,0,prix_unitaire}','-1'));
  assert not (r->>'ok')::boolean, 'prix négatif accepté';
  r:=public.creer_devis_by_token(jeton,payload||'{"acompte_pct":101}'); assert not (r->>'ok')::boolean, 'acompte 101 accepté';
  r:=public.creer_devis_by_token(jeton,payload||'{"tva_mode":"inconnue"}'); assert not (r->>'ok')::boolean, 'TVA inconnue acceptée';
  r:=public.creer_devis_by_token(jeton,jsonb_set(payload,'{lignes,0,quantite}','"abc"')); assert not (r->>'ok')::boolean, 'quantité texte acceptée';
  -- Deux onglets : A a la révision rev ; B modifie puis A termine son ancien PDF.
  r:=public.creer_devis_by_token(jeton,payload||jsonb_build_object('devis_id',d,'expected_revision',rev,'objet','Révision onglet B'));
  assert (r->>'revision')::integer=rev+1, 'la nouvelle version n’incrémente pas la révision';
  r2:=public.set_devis_pdf_by_token(jeton,d,'https://test.supabase.co/storage/v1/object/public/devis/genere/'||public.empreinte(jeton)||'/ancien.pdf',rev);
  assert r2->>'error'='revision_conflit', 'PDF périmé de l’onglet A accepté';
  r2:=public.reserver_envoi_devis(jeton,d,rev); assert r2->>'error'='revision_conflit', 'envoi d’une révision périmée accepté';
  r2:=public.creer_devis_by_token(jeton,payload||jsonb_build_object('devis_id',d,'expected_revision',rev,'objet','Modification onglet A'));
  assert r2->>'error'='revision_conflit', 'modification obsolète écrase l’onglet B';
  rev:=rev+1;
  r:=public.reserver_envoi_devis(jeton,d,rev); assert r->>'error'='pdf_requis', 'envoi sans PDF accepté';
  r:=public.set_devis_pdf_by_token(jeton,d,'https://test.supabase.co/storage/v1/object/public/devis/genere/'||public.empreinte(jeton)||'/test.pdf',rev);
  assert (r->>'ok')::boolean, 'rattachement PDF refusé';
  r:=public.reserver_envoi_devis(jeton,d,rev); assert (r->>'ok')::boolean, 'réservation envoi refusée'; envoi:=(r->>'cle')::uuid;
  select count(*) into n from public.devis where id=d and statut='brouillon'; assert n=1, 'réservation marque envoyé prématurément';
  r:=public.reserver_envoi_devis(jeton,d,rev); assert r->>'error'='envoi_a_verifier', 'double envoi autorisé';
  r:=public.finaliser_envoi_devis(jeton,d,envoi,'incertain'); assert (r->>'ok')::boolean, 'état incertain refusé';
  r:=public.reserver_envoi_devis(jeton,d,rev); assert r->>'error'='envoi_a_verifier', 'renvoi automatique après résultat ambigu';
  r:=public.creer_devis_by_token(jeton,payload||jsonb_build_object('devis_id',d)); assert r->>'error'='envoi_a_verifier', 'modification pendant envoi ambigu';
  r:=public.finaliser_envoi_devis(jeton,d,envoi,'confirme'); assert (r->>'ok')::boolean, 'confirmation refusée';
  select count(*) into n from public.devis where id=d and statut='envoye' and sent_at is not null; assert n=1, 'confirmation ne marque pas envoyé';
  r:=public.reserver_envoi_devis(jeton,d,rev); assert (r->>'deja_envoye')::boolean, 'envoi confirmé non idempotent';
  r:=public.creer_devis_by_token(jeton,payload||jsonb_build_object('devis_id',d)); assert r->>'error'='devis_verrouille', 'devis envoyé modifiable';
  r:=public.enregistrer_identite_by_token(jeton,'{"ville":"Ville fictive"}');
  assert (select cgv from public.artisans where id=a)='CGV fictives conservées', 'CGV effacées sans demande';
  r:=public.enregistrer_identite_by_token(jeton,'{"iban":""}'); assert (select iban is null from public.artisans where id=a), 'IBAN vidé conservé';
  r:=public.enregistrer_identite_by_token(jeton,'{"cgv":""}'); assert (select cgv is null from public.artisans where id=a), 'retour CGV défaut impossible';
  r:=public.enregistrer_identite_by_token(jeton,'{"acompte_defaut":"150"}'); assert not (r->>'ok')::boolean, 'acompte entreprise hors bornes';
  update public.artisans set ecarte_at=now() where id=a;
  r:=public.capacites_devis_by_token(jeton); assert not (r->>'ok')::boolean, 'artisan écarté reçoit les capacités de création';
  r:=public.devis_by_token(jeton,d); assert not (r->>'ok')::boolean, 'artisan écarté peut relire';
  raise notice 'Audit devis : création/reprise/idempotence, arrondis, bornes, propriété, envoi, CGV vérifiés';
end $$;
rollback;
