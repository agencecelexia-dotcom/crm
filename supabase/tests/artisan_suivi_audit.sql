-- Exécuter sur PostgreSQL LOCAL jetable avec net/http et cron neutralisés.
-- Aucune valeur réelle, aucun lien utilisable ; toutes les écritures sont annulées.
begin;
select set_config('request.jwt.claim.role', 'anon', true);

do $audit$
declare
  a uuid; a_non_signe uuid; p_futur uuid; af_futur uuid; p uuid; p_non_signe uuid; af uuid; af_non_signe uuid;
  r json; espace json; ligne json; n int; n_apres int; etat public.affectations;
  reception timestamptz := now() - interval '1 hour';
begin
  insert into public.artisans(nom, societe, contrat_externe, token)
  values ('Audit fictif suivi', 'Entreprise fictive audit suivi', true, 'audit-local-artisan-signe') returning id into a;
  insert into public.artisans(nom, contrat_externe, token)
  values ('Audit fictif non signé', false, 'audit-local-artisan-non-signe') returning id into a_non_signe;
  insert into public.projets(client_nom, metier, statut, created_at)
  values ('Client fictif audit suivi', 'Couverture', 'nouveau', now() - interval '40 days') returning id into p;
  insert into public.projets(client_nom, metier, statut)
  values ('Client fictif privé', 'Couverture', 'nouveau') returning id into p_non_signe;
  insert into public.affectations(projet_id, artisan_id, token, created_at)
  values (p, a, 'audit-local-affectation', reception) returning id into af;
  insert into public.affectations(projet_id, artisan_id, token)
  values (p_non_signe, a_non_signe, 'audit-local-affectation-non-signee') returning id into af_non_signe;

  -- 1. Date de réception = attribution, pas entrée du lead agence.
  espace := public.get_espace_artisan('audit-local-artisan-signe');
  ligne := espace->'projets'->0;
  if (ligne->>'recu_le')::timestamptz is distinct from reception then
    raise exception 'AUDIT: réception ne suit pas affectation.created_at';
  end if;
  if (espace->'stats'->>'jamais_contactes_48h')::int <> 0 then
    raise exception 'AUDIT: faux retard sur lead ancien attribué il y a une heure';
  end if;

  -- 2. Pause orthogonale et idempotente, reprise sans inventer une étape.
  r := public.add_suivi_by_token('audit-local-affectation', 'en_attente', null, null);
  if not (r->>'ok')::boolean then raise exception 'AUDIT: pause refusée %', r; end if;
  select * into etat from public.affectations where id = af;
  if etat.statut <> 'artisan_assigne' or etat.etape is not null or etat.en_attente_depuis is null then
    raise exception 'AUDIT: pause a effacé/inventé une étape';
  end if;
  select count(*) into n from public.suivis where affectation_id = af;
  perform public.add_suivi_by_token('audit-local-affectation', 'en_attente', null, null);
  select count(*) into n_apres from public.suivis where affectation_id = af;
  if n_apres <> n then raise exception 'AUDIT: pause répétée duplique le suivi'; end if;
  r := public.add_suivi_by_token('audit-local-affectation', 'reprendre', null, null);
  select * into etat from public.affectations where id = af;
  if not (r->>'ok')::boolean or etat.en_attente_depuis is not null or etat.etape is not null then
    raise exception 'AUDIT: reprise de pause incohérente %', r;
  end if;

  -- 3. Contrat : écritures refusées, retrait volontaire encore autorisé.
  r := public.add_suivi_by_token('audit-local-affectation-non-signee', 'contacte', null, null);
  if r->>'error' <> 'contrat_requis' then raise exception 'AUDIT: suivi non signé accepté %', r; end if;
  r := public.corriger_etape_by_token('audit-local-affectation-non-signee', 'contacte');
  if r->>'error' <> 'contrat_requis' then raise exception 'AUDIT: correction non signée acceptée %', r; end if;
  r := public.log_appel_by_token('audit-local-affectation-non-signee', 'repondu', null);
  if r->>'error' <> 'contrat_requis' then raise exception 'AUDIT: appel non signé accepté %', r; end if;
  r := public.definir_rappel_by_token('audit-local-affectation-non-signee', now() + interval '1 day');
  if r->>'error' <> 'contrat_requis' then raise exception 'AUDIT: rappel non signé accepté %', r; end if;
  r := public.retirer_chantier_by_token('audit-local-affectation-non-signee', 'Hors de mon secteur', 'hors_zone', null);
  if not (r->>'ok')::boolean then raise exception 'AUDIT: retrait volontaire non signé bloqué %', r; end if;
  r := public.restaurer_chantier_by_token('audit-local-affectation-non-signee');
  if r->>'error' <> 'contrat_requis' then raise exception 'AUDIT: reprise non signée acceptée %', r; end if;
  insert into public.suivis(projet_id, affectation_id, auteur, type, message)
  values (p_non_signe, af_non_signe, 'agence', 'note', 'Coordonnée confidentielle fictive audit');
  espace := public.get_espace_artisan('audit-local-artisan-non-signe');
  if espace::text like '%Coordonnée confidentielle fictive audit%' then
    raise exception 'AUDIT: message privé exposé avant signature';
  end if;

  -- 4. Rendez-vous obligatoire et erreur sans trace parasite.
  select count(*) into n from public.suivis where affectation_id = af;
  r := public.add_suivi_by_token('audit-local-affectation', 'rdv_pris', null, null);
  if r->>'error' <> 'date_rdv_requise' then raise exception 'AUDIT: RDV sans date accepté %', r; end if;
  select count(*) into n_apres from public.suivis where affectation_id = af;
  if n <> n_apres then raise exception 'AUDIT: RDV refusé a écrit un suivi'; end if;

  -- 5. Reprise après retrait : devis + étape + histoire préservés, dates échues nettoyées.
  perform public.add_suivi_by_token('audit-local-affectation', 'rdv_pris', 'Visite fictive', now() - interval '3 days');
  perform public.add_suivi_by_token('audit-local-affectation', 'devis_envoye', null, null);
  update public.affectations set montant_devis = 8200, devis_url = 'https://example.test/devis-fictif.pdf', rappel_le = now() - interval '1 day' where id = af;
  r := public.retirer_chantier_by_token('audit-local-affectation', 'Planning provisoirement complet', 'delai_incompatible', null);
  if not (r->>'ok')::boolean then raise exception 'AUDIT: retrait refusé %', r; end if;
  select count(*) into n from public.suivis where affectation_id = af;
  r := public.restaurer_chantier_by_token('audit-local-affectation');
  if not (r->>'ok')::boolean then raise exception 'AUDIT: restauration refusée %', r; end if;
  select * into etat from public.affectations where id = af;
  if etat.statut <> 'devis_envoye' or etat.etape <> 'devis_envoye' or etat.issue <> 'en_cours'
     or etat.montant_devis <> 8200 or etat.devis_url <> 'https://example.test/devis-fictif.pdf'
     or etat.rappel_le is not null or etat.date_rdv is not null or etat.retire_at is not null then
    raise exception 'AUDIT: reprise a perdu le devis/étape ou conservé dates périmées %', row_to_json(etat);
  end if;
  select count(*) into n_apres from public.suivis where affectation_id = af;
  if n_apres <> n + 1 then raise exception 'AUDIT: historique de reprise incohérent'; end if;
  perform public.restaurer_chantier_by_token('audit-local-affectation');
  select count(*) into n from public.suivis where affectation_id = af;
  if n <> n_apres then raise exception 'AUDIT: restauration répétée duplique historique'; end if;

  -- Les dates à venir sont conservées, y compris lorsque l'étape reprise est RDV.
  insert into public.projets(client_nom, metier) values ('Client fictif RDV futur', 'Couverture') returning id into p_futur;
  insert into public.affectations(projet_id, artisan_id, token) values (p_futur, a, 'audit-local-rdv-futur') returning id into af_futur;
  perform public.add_suivi_by_token('audit-local-rdv-futur', 'rdv_pris', 'RDV à venir', now() + interval '3 days');
  perform public.definir_rappel_by_token('audit-local-rdv-futur', now() + interval '2 days');
  perform public.retirer_chantier_by_token('audit-local-rdv-futur', 'Planning à réorganiser', 'delai_incompatible', null);
  r := public.restaurer_chantier_by_token('audit-local-rdv-futur');
  select * into etat from public.affectations where id = af_futur;
  if not (r->>'ok')::boolean or etat.rappel_le is null or etat.date_rdv is null
     or etat.statut <> 'rdv_pris' then raise exception 'AUDIT: reprise a effacé des dates futures %', r; end if;

  -- 6. Les preuves signées et les commissions réglées bloquent un recul direct.
  perform public.add_suivi_by_token('audit-local-affectation', 'devis_signe', null, null);
  update public.affectations set montant_devis_signe = 8200, devis_signe_url = 'https://example.test/signe-fictif.pdf' where id = af;
  r := public.add_suivi_by_token('audit-local-affectation', 'devis_envoye', null, null);
  if r->>'error' <> 'devis_signe_depose' then raise exception 'AUDIT: recul avec preuve signé accepté %', r; end if;
  select * into etat from public.affectations where id = af;
  if etat.devis_signe_url is null or etat.montant_devis_signe <> 8200 then
    raise exception 'AUDIT: refus de recul a effacé la preuve';
  end if;
  update public.affectations set devis_signe_url = null where id = af;
  update public.projets set artisan_id = a, commission_encaissee = true where id = p;
  r := public.add_suivi_by_token('audit-local-affectation', 'devis_envoye', null, null);
  if r->>'error' <> 'commission_encaissee' then raise exception 'AUDIT: recul avec commission réglée accepté %', r; end if;
  update public.projets set commission_encaissee = false where id = p;
  r := public.add_suivi_by_token('audit-local-affectation', 'devis_envoye', null, null);
  if not (r->>'ok')::boolean then raise exception 'AUDIT: correction non prouvée refusée %', r; end if;
  select * into etat from public.affectations where id = af;
  if etat.issue <> 'en_cours' or etat.montant_devis_signe is not null then
    raise exception 'AUDIT: correction de signature garde un gain fantôme';
  end if;

  raise notice 'Audit suivi artisan : assertions contrat, pause, reprise, RDV, réception et recul validées';
end;
$audit$;
rollback;
