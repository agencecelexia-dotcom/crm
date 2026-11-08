-- Base jetable locale : même id, recalcul, concurrence, droits et absence d'effet sur les valeurs retenues.
begin;
do $audit$
declare
  a uuid; b uuid; p uuid; autre_projet uuid; af uuid; autre_af uuid; v_id uuid; r json;
  g jsonb := '[[2.35,48.856],[2.35015,48.856],[2.35015,48.8561],[2.35,48.8561]]';
  g2 jsonb := '[[2.35,48.856],[2.3502,48.856],[2.3502,48.8561],[2.35,48.8561]]';
  geom jsonb; m public.metres; n int;
begin
  insert into public.artisans(nom, contrat_externe, token) values ('Artisan fictif carnet', true, 'audit-carnet-a') returning artisans.id into a;
  insert into public.artisans(nom, contrat_externe, token) values ('Autre artisan fictif carnet', true, 'audit-carnet-b') returning artisans.id into b;
  insert into public.projets(client_nom, metier, statut) values ('Client fictif carnet', 'Couverture', 'nouveau') returning projets.id into p;
  insert into public.projets(client_nom, metier, statut) values ('Autre chantier fictif carnet', 'Couverture', 'nouveau') returning projets.id into autre_projet;
  insert into public.affectations(projet_id, artisan_id, token) values (p,a,'audit-carnet-af') returning affectations.id into af;
  insert into public.affectations(projet_id, artisan_id, token) values (autre_projet,a,'audit-carnet-autre-af') returning affectations.id into autre_af;
  insert into public.metres(projet_id,affectation_id,artisan_id,nom,type,geometrie,source,surface_m2,surface_reelle_m2)
    values (p,af,a,'Terrasse','surface',g,'dessin',public.aire_polygone(g),public.aire_polygone(g)) returning metres.id into v_id;
  insert into public.metrage_chantier(projet_id,cle,unite,valeur_retenue,retenue_par,statut)
    values (p,'terrasse','m2',999,'artisan','confirme');
  r := public.metre_contexte_by_token('audit-carnet-a','audit-carnet-af');
  assert (r->'metres'->0->>'modifiable_trace')::boolean, 'capacité du dessin propre absente';
  update public.metres set affectation_id=autre_af where metres.id=v_id;
  r := public.metre_contexte_by_token('audit-carnet-a','audit-carnet-af');
  assert not (r->'metres'->0->>'modifiable_trace')::boolean, 'ancienne affectation annoncée modifiable';
  update public.metres set affectation_id=af where metres.id=v_id;

  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Terrasse corrigée',g2,'Terrasse',g);
  assert (r->>'ok')::boolean, 'édition valide refusée';
  select * into m from public.metres where metres.id=v_id;
  assert m.nom='Terrasse corrigée' and m.geometrie=g2 and m.surface_m2=public.aire_polygone(g2), 'géométrie non recalculée';
  assert m.surface_reelle_m2=m.surface_m2 and m.perimetre_m=public.longueur_ligne(g2,true), 'ancien dessin plat incohérent';
  select count(*) into n from public.metres where projet_id=p;
  assert n=1, 'édition dupliquée';
  assert (select valeur_retenue=999 from public.metrage_chantier where projet_id=p and cle='terrasse'), 'quantité validée écrasée';

  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Terrasse corrigée',g2,'Terrasse',g);
  assert (r->>'ok')::boolean, 'réessai identique après réponse perdue refusé';
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Ancienne version',g,'Terrasse',g);
  assert r->>'error'='trace_modifie', 'édition concurrente écrasée';
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Nom seul',g2,'Terrasse corrigée',g2);
  assert (r->>'ok')::boolean, 'renommage seul refusé';

  r := public.modifier_trace_by_token('audit-carnet-b','audit-carnet-af',v_id,'Autre artisan',g2,'Nom seul',g2);
  assert r->>'error'='chantier_introuvable', 'autre artisan accepté';
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-autre-af',v_id,'Autre chantier',g2,'Nom seul',g2);
  assert r->>'error'='trace_introuvable', 'autre chantier accepté';
  update public.metres set artisan_id=b where metres.id=v_id;
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Mesure autre artisan',g2,'Nom seul',g2);
  assert r->>'error'='trace_introuvable', 'mesure du confrère acceptée';
  update public.metres set artisan_id=a where metres.id=v_id;

  foreach geom in array array['{}'::jsonb, '[[null,48],[2.3,48],[2.4,48]]', '[[181,48],[2.3,48],[2.4,48]]', '[["2",48],[2.3,48],[2.4,48]]'] loop
    r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Invalide',geom,'Nom seul',g2);
    assert r->>'error'='geometrie_invalide', 'géométrie malformée acceptée';
  end loop;
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Incomplet','[[2.35,48.856],[2.35,48.856]]','Nom seul',g2);
  assert r->>'error'='geometrie_insuffisante', 'surface incomplète acceptée';
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Trop grand','[[2,48],[3,48],[3,49]]','Nom seul',g2);
  assert r->>'error'='trace_demesure', 'tracé gigantesque accepté';
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,' ',g2,'Nom seul',g2);
  assert r->>'error'='nom_invalide', 'nom vide accepté';

  update public.metres set pente_pct=30 where metres.id=v_id;
  r := public.metre_contexte_by_token('audit-carnet-a','audit-carnet-af');
  assert not (r->'metres'->0->>'modifiable_trace')::boolean, 'toiture annoncée modifiable';
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Toiture',g2,'Nom seul',g2);
  assert r->>'error'='trace_non_modifiable', 'toiture recalculée en surface plane';
  update public.metres set pente_pct=null, surface_reelle_m2=999 where metres.id=v_id;
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Dérivé',g2,'Nom seul',g2);
  assert r->>'error'='trace_non_modifiable', 'ancien chiffre dérivé écrasé';
  update public.metres set surface_reelle_m2=null, type='longueur', geometrie='[[2.35,48.856],[2.3501,48.856]]', surface_m2=null, perimetre_m=null where metres.id=v_id;
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Clôture','[[2.35,48.856],[2.3502,48.856]]','Nom seul','[[2.35,48.856],[2.3501,48.856]]');
  assert (r->>'ok')::boolean and (r->'metre'->>'longueur_m')::numeric=public.longueur_ligne('[[2.35,48.856],[2.3502,48.856]]'), 'longueur non recalculée';

  update public.artisans set contrat_externe=false where artisans.id=a;
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Refus',g,'Clôture',g);
  assert r->>'error'='contrat_requis', 'sans contrat accepté';
  update public.artisans set contrat_externe=true where artisans.id=a;
  update public.affectations set retire_at=now() where affectations.id=af;
  r := public.metre_contexte_by_token('audit-carnet-a','audit-carnet-af');
  assert not (r->'metres'->0->>'modifiable_trace')::boolean, 'chantier retiré annoncé modifiable';
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Refus',g,'Clôture',g);
  assert r->>'error'='chantier_retire', 'chantier retiré accepté';
  update public.affectations set retire_at=null, masque_at=now() where affectations.id=af;
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Refus',g,'Clôture',g);
  assert r->>'error'='chantier_retire', 'chantier masqué accepté';
  update public.affectations set masque_at=null where affectations.id=af;
  update public.projets set statut='mort' where projets.id=p;
  r := public.modifier_trace_by_token('audit-carnet-a','audit-carnet-af',v_id,'Refus',g,'Clôture',g);
  assert r->>'error'='projet_clos', 'chantier clos accepté';
end
$audit$;
rollback;
