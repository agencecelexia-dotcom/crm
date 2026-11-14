import { StatutBadge } from './statut-badge'

export function LegendeStatuts() {
  return <details className="mb-4 rounded-lg border border-border bg-card px-4 py-3 text-xs">
    <summary className="cursor-pointer font-medium text-muted-foreground">Comprendre les couleurs</summary>
    <div className="mt-3 flex flex-wrap gap-2">
      {(['nouveau', 'contacte', 'a_rappeler', 'en_attente', 'rdv_pris', 'devis_envoye', 'devis_signe', 'termine', 'a_reattribuer', 'perdu'] as const).map((statut) => <StatutBadge key={statut} statut={statut} />)}
    </div>
    <p className="mt-3 leading-relaxed text-muted-foreground">Les mêmes couleurs accompagnent les mêmes étapes dans le CRM et l’espace artisan. Un projet masqué conserve son statut.</p>
  </details>
}
