import type { QueryClient } from '@tanstack/react-query'

/** Les montants, statuts et affectations alimentent plusieurs vues métier.
 * Les marquer ensemble évite un compteur ou solde périmé au retour à l'accueil. */
export function invaliderDonneesProjets(qc: QueryClient) {
  return Promise.all([
    'projets', 'affectations', 'kpi-agence', 'kpi-artisan', 'ca-signe-par-mois',
    'commissions-dues', 'a-traiter', 'action-du-jour', 'qualite-leads',
    'stats-artisans', 'scoring-artisan', 'dossiers-envoyes', 'a-reattribuer',
    'mon-pipe', 'stats-commercial', 'mes-retrocessions', 'reprises-commerciaux',
    'vue-commercial', 'taches',
  ].map((cle) => qc.invalidateQueries({ queryKey: [cle] })))
}
