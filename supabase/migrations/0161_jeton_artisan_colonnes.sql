-- Le jeton d'un artisan sort des privilèges de lecture et d'écriture ordinaires.
--
-- Suite de 0159, qui a créé `jeton_espace_artisan` et `regenerer_jeton_artisan`.
-- À N'APPLIQUER QU'APRÈS le déploiement du front qui lit `artisans` par une
-- liste explicite de colonnes (sans `token`) : l'ancien `select('*')` échouerait.
--
-- Testé en transaction annulée : un commercial ne lit plus, n'écrit plus et ne
-- régénère plus aucun jeton ; il liste toujours les 103 artisans ; le fondateur
-- obtient et régénère le lien ; anon n'a plus aucun droit sur la table.

revoke all on public.artisans from anon;
revoke select, update on public.artisans from authenticated;

grant select (
  id, nom, prenom, societe, telephone, email, metiers, zone_intervention,
  rayon_km, adresse, ville, code_postal, latitude, longitude, specificites,
  created_at, updated_at, sous_metiers, forme_juridique, capital_social,
  siren, ville_immatriculation, representant, qualite_representant,
  taux_commission, contrat_externe, ecarte_at, ecarte_motif,
  departements_couverts, source, nb_salaries, annees_experience,
  assurance_rc_pro, assurance_decennale, zones_couvertes, note_elocution,
  note_communication_agence, partenaire_at, assurance_decennale_url,
  assurance_decennale_assureur, assurance_decennale_police,
  assurance_decennale_echeance, assurance_rc_pro_url,
  assurance_rc_pro_assureur, assurance_rc_pro_police,
  assurance_rc_pro_echeance, assurances_validees_at, assurances_validees_par,
  logo_url, tva_intracom, code_ape, iban, bic, mediateur_nom, mediateur_url,
  cgv, conditions_paiement, garantie_zone, acompte_defaut, tva_mode_defaut
) on public.artisans to authenticated;

grant update (
  nom, prenom, societe, telephone, email, metiers, zone_intervention,
  rayon_km, adresse, ville, code_postal, latitude, longitude, specificites,
  updated_at, sous_metiers, forme_juridique, capital_social, siren,
  ville_immatriculation, representant, qualite_representant, taux_commission,
  contrat_externe, ecarte_at, ecarte_motif, departements_couverts, source,
  nb_salaries, annees_experience, assurance_rc_pro, assurance_decennale,
  zones_couvertes, note_elocution, note_communication_agence, partenaire_at,
  assurance_decennale_url, assurance_decennale_assureur,
  assurance_decennale_police, assurance_decennale_echeance,
  assurance_rc_pro_url, assurance_rc_pro_assureur, assurance_rc_pro_police,
  assurance_rc_pro_echeance, assurances_validees_at, assurances_validees_par,
  logo_url, tva_intracom, code_ape, iban, bic, mediateur_nom, mediateur_url,
  cgv, conditions_paiement, garantie_zone, acompte_defaut, tva_mode_defaut
) on public.artisans to authenticated;


-- ---------- Les anciens chemins de dépôt, qui portaient le jeton en clair ----------
--
-- 0158 a ouvert le dépôt sous l'EMPREINTE du jeton et gardé les anciennes
-- politiques le temps que le nouveau front soit en ligne. Une fois déployé, plus
-- rien ne dépose sous `<jeton d'affectation>/…` ni `logos/<jeton>/…` : on les
-- retire, pour qu'aucun jeton ne puisse plus finir dans une adresse publique.
drop policy if exists devis_insert_token on storage.objects;
drop policy if exists devis_logo_token on storage.objects;
