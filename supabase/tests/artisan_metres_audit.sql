-- PostgreSQL local jetable uniquement. Réseau neutralisé ; fixtures fictives.
begin;
select set_config('request.jwt.claim.role', 'anon', true);
do $audit$
declare
  a uuid; autre uuid; non_signe uuid; p uuid; r json; n int; valeur numeric;
begin
  insert into public.artisans(nom, societe, contrat_externe, token)
  values ('Audit fictif métrés', 'Entreprise fictive', true, 'audit-local-metres') returning id into a;
  insert into public.artisans(nom, contrat_externe, token)
  values ('Autre artisan fictif', true, 'audit-local-autre-metres') returning id into autre;
  insert into public.projets(client_nom, metier, statut)
  values ('Client fictif métrés', 'Ravalement', 'nouveau') returning id into p;
  insert into public.affectations(projet_id, artisan_id, token)
  values (p, a, 'audit-local-affectation-metres');
  insert into public.metrage_chantier(projet_id, cle, unite, valeur_mesuree, mesure_source)
  values (p, 'facades_total', 'm2', 120, 'lidar');

  -- Baseline du défaut : les appels unitaires sont indépendants.
  perform public.corriger_metrage_by_token('audit-local-metres', 'audit-local-affectation-metres', 'facades_total', 'm2', 125, 'Baseline fictive');
  r := public.corriger_metrage_by_token('audit-local-metres', 'audit-local-affectation-metres', 'facade_nette', 'm2', -1, null);
  select valeur_retenue into valeur from public.metrage_chantier where projet_id = p and cle = 'facades_total';
  if r->>'error' <> 'valeur_invalide' or valeur <> 125 then raise exception 'AUDIT: baseline inattendue'; end if;

  -- Le nouveau lot échoue à la seconde valeur : première valeur restaurée.
  r := public.corriger_metrages_by_token('audit-local-metres', 'audit-local-affectation-metres',
    '[{"cle":"facades_total","unite":"m2","valeur":150},{"cle":"facade_nette","unite":"m2","valeur":-1}]', 'Lot refusé fictif');
  select valeur_retenue into valeur from public.metrage_chantier where projet_id = p and cle = 'facades_total';
  if r->>'error' <> 'valeur_invalide' or valeur <> 125 then raise exception 'AUDIT: lot partiellement écrit %', r; end if;
  select count(*) into n from public.metrage_chantier where projet_id = p and cle = 'facade_nette';
  if n <> 0 then raise exception 'AUDIT: ligne rejetée persistée'; end if;

  -- Le lot valide enregistre les deux valeurs, sans effacer la source brute.
  r := public.corriger_metrages_by_token('audit-local-metres', 'audit-local-affectation-metres',
    '[{"cle":"facades_total","unite":"m2","valeur":150},{"cle":"facade_nette","unite":"m2","valeur":130}]', 'Mesuré sur place fictivement');
  if not (r->>'ok')::boolean or (r->>'nombre')::int <> 2 then raise exception 'AUDIT: lot valide refusé %', r; end if;
  select count(*) into n from public.metrage_chantier where projet_id = p and statut = 'confirme' and retenue_par = 'artisan';
  if n <> 2 then raise exception 'AUDIT: corrections manquantes'; end if;
  select valeur_mesuree into valeur from public.metrage_chantier where projet_id = p and cle = 'facades_total';
  if valeur <> 120 then raise exception 'AUDIT: estimation initiale écrasée'; end if;

  -- La correction unitaire et le lot sont refusés sans contrat signé.
  insert into public.artisans(nom, contrat_externe, token)
  values ('Artisan fictif non signé', false, 'audit-local-metres-non-signe') returning id into non_signe;
  insert into public.affectations(projet_id, artisan_id, token)
  values (p, non_signe, 'audit-local-affectation-metres-non-signee');
  r := public.corriger_metrage_by_token('audit-local-metres-non-signe', 'audit-local-affectation-metres-non-signee', 'facades_total', 'm2', 999, null);
  if r->>'error' <> 'contrat_requis' then raise exception 'AUDIT: correction unitaire non signée acceptée %', r; end if;
  r := public.corriger_metrages_by_token('audit-local-metres-non-signe', 'audit-local-affectation-metres-non-signee',
    '[{"cle":"facades_total","unite":"m2","valeur":999}]', null);
  if r->>'error' <> 'contrat_requis' then raise exception 'AUDIT: lot non signé accepté %', r; end if;

  -- Le lot ne contourne ni le propriétaire du chantier ni la validation.
  r := public.corriger_metrages_by_token('audit-local-autre-metres', 'audit-local-affectation-metres',
    '[{"cle":"facades_total","unite":"m2","valeur":999}]', null);
  if r->>'error' <> 'chantier_introuvable' then raise exception 'AUDIT: autre artisan accepté %', r; end if;
  r := public.corriger_metrages_by_token('audit-local-metres', 'audit-local-affectation-metres', '[]', null);
  if r->>'error' <> 'quantite_invalide' then raise exception 'AUDIT: lot vide accepté'; end if;
  r := public.corriger_metrages_by_token('audit-local-metres', 'audit-local-affectation-metres',
    '[{"cle":"facades_total","unite":"m2","valeur":"abc"}]', null);
  if r->>'error' <> 'valeur_invalide' then raise exception 'AUDIT: texte accepté comme quantité'; end if;
  update public.affectations set retire_at = now() where token = 'audit-local-affectation-metres';
  r := public.corriger_metrages_by_token('audit-local-metres', 'audit-local-affectation-metres',
    '[{"cle":"facades_total","unite":"m2","valeur":999}]', null);
  if r->>'error' <> 'chantier_retire' then raise exception 'AUDIT: chantier retiré modifiable %', r; end if;
  update public.affectations set retire_at = null where token = 'audit-local-affectation-metres';
  update public.projets set statut = 'mort' where id = p;
  r := public.corriger_metrages_by_token('audit-local-metres', 'audit-local-affectation-metres',
    '[{"cle":"facades_total","unite":"m2","valeur":999}]', null);
  if r->>'error' <> 'projet_clos' then raise exception 'AUDIT: projet clos modifiable %', r; end if;
end
$audit$;
rollback;
