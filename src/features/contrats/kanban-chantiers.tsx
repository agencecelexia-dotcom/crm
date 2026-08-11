import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { EnteteChantier, LisereStatut } from './entete-chantier'
import { dateReception, urgenceChantier } from './urgence-chantier'
import { ETAPE_LABEL, ETAPES_ORDRE, type EtapeFunnel } from '@/types/database'
import type { ProjetEspace } from '@/types/database'

/** Colonne « pas encore commencé », avant la première étape franchie. */
const COLONNE_INITIALE = 'a_faire' as const
type CleColonne = typeof COLONNE_INITIALE | EtapeFunnel

const COLONNES: { cle: CleColonne; label: string; accent: string }[] = [
  { cle: COLONNE_INITIALE, label: 'À contacter', accent: 'bg-muted-foreground' },
  ...ETAPES_ORDRE.map((e) => ({
    cle: e as CleColonne,
    label: ETAPE_LABEL[e],
    accent:
      e === 'contacte'
        ? 'bg-[#0EA5E9]'
        : e === 'rdv_pris'
          ? 'bg-[#7C3AED]'
          : e === 'devis_envoye'
            ? 'bg-[#F59E0B]'
            : 'bg-[#22C55E]',
  })),
]

/**
 * Vue kanban par étape du funnel.
 *
 * Une liste plate de plusieurs dizaines de cartes ne permet pas de piloter :
 * on ne voit ni où le flux se bloque, ni combien d'argent stagne à chaque
 * cran (audit §6). Les colonnes reposent sur `etape` — l'axe monotone du
 * modèle 0073 — et non sur `statut`, qui était écrasable.
 *
 * Les chantiers gagnés ou perdus sont exclus : ils ne sont plus dans le flux.
 */
export function KanbanChantiers({
  projets,
  signe,
  onOuvrir,
}: {
  projets: ProjetEspace[]
  signe: boolean
  onOuvrir: (p: ProjetEspace) => void
}) {
  const actifs = projets.filter((p) => (p.issue ?? 'en_cours') === 'en_cours')

  const parColonne = COLONNES.map((c) => {
    const items = actifs
      .filter((p) => (c.cle === COLONNE_INITIALE ? !p.etape : p.etape === c.cle))
      // Urgence puis le plus récent : même règle que la liste, sinon un
      // chantier neuf se retrouve en bas de sa colonne.
      .sort((a, b) => {
        const ecart = urgenceChantier(b).score - urgenceChantier(a).score
        return ecart !== 0 ? ecart : dateReception(b) - dateReception(a)
      })
    return {
      ...c,
      items,
      montant: items.reduce((t, p) => t + (p.montant_devis ?? 0), 0),
    }
  })

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-3">
        {parColonne.map((c) => (
          <section
            key={c.cle}
            aria-label={`${c.label} — ${c.items.length} chantier${c.items.length > 1 ? 's' : ''}`}
            className="w-[260px] shrink-0"
          >
            <header className="mb-2 flex items-center gap-2">
              <span aria-hidden className={cn('h-4 w-1 rounded-full', c.accent)} />
              <span className="text-sm font-semibold">{c.label}</span>
              <span className="rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                {c.items.length}
              </span>
            </header>

            {/* Le montant par colonne montre où l'argent stagne. */}
            {c.montant > 0 && (
              <p className="montant mb-2 text-xs text-muted-foreground">
                {formatEuros(c.montant)}
              </p>
            )}

            <div className="space-y-2">
              {c.items.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                  Aucun chantier
                </p>
              ) : (
                c.items.map((p) => (
                  <Card
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOuvrir(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOuvrir(p)
                      }
                    }}
                    className="relative cursor-pointer overflow-hidden py-0 shadow-card transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <LisereStatut statut={p.statut} />
                    <EnteteChantier projet={p} signe={signe} compact />
                  </Card>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
