import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { EnteteChantier, LisereStatut } from './entete-chantier'
import { dateReception } from './urgence-chantier'
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
 * Le périmètre reste celui des filtres de liste : les dossiers gagnés et
 * perdus gardent leur étape et restent consultables dans cette vue.
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
  const parColonne = COLONNES.map((c) => {
    const items = projets
      .filter((p) => (c.cle === COLONNE_INITIALE ? !p.etape : p.etape === c.cle))
      // Ordre chronologique, comme la liste : les colonnes portent déjà
      // l'information d'étape, un tri par urgence par-dessus rendait la
      // position des cartes imprévisible d'un jour à l'autre.
      .sort((a, b) => dateReception(b) - dateReception(a))
    return {
      ...c,
      items,
      montant: items.reduce((t, p) => t + (p.montant_devis ?? 0), 0),
    }
  })

  return (
    <div className="max-w-full overflow-x-auto overscroll-x-contain pb-3">
      <div className="flex min-w-max items-start gap-4">
        {parColonne.map((c) => (
          <section
            key={c.cle}
            aria-label={`${c.label} — ${c.items.length} chantier${c.items.length > 1 ? 's' : ''}`}
            className="w-[272px] shrink-0 rounded-[10px] border border-border bg-muted/30 p-3 sm:w-[288px]"
          >
            <header className="mb-3 flex items-center gap-2">
              <span aria-hidden className={cn('size-1.5 rounded-full opacity-70', c.accent)} />
              <h3 className="flex-1 text-sm font-semibold">{c.label}</h3>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {c.items.length}
              </span>
            </header>

            {/* Le montant par colonne montre où l'argent stagne. */}
            {c.montant > 0 && (
              <p className="montant -mt-1 mb-3 text-xs text-muted-foreground">
                {formatEuros(c.montant)}
              </p>
            )}

            <div className="space-y-2">
              {c.items.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
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
                    className="relative cursor-pointer overflow-hidden rounded-lg border-border bg-card py-0 shadow-none transition-colors hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
