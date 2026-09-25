import { useMemo, useState } from 'react'
import { ChevronRight, Ruler, Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import type { ProjetEspace } from '@/types/database'
import { FeuilleMetreDifferee } from './feuille-metre-differee'
import { useEtatsMetrage } from './use-metrage'

/**
 * L'écran « Métrés ».
 *
 * Une mesure appartient toujours à un chantier : c'est ce qui lui donne un
 * sens et ce qui permet à l'agence de la voir. L'écran commence donc par la
 * liste des chantiers, et non par une carte flottante sur laquelle on mesure
 * dans le vide.
 */
export function EcranMetres({ token, projets }: { token: string; projets: ProjetEspace[] }) {
  const [recherche, setRecherche] = useState('')
  const [choisi, setChoisi] = useState<ProjetEspace | null>(null)
  // Les métrés préparés à l'avance (pré-mesure) : l'artisan voit d'un coup
  // d'œil les chantiers dont les chiffres l'attendent.
  const { data: etats } = useEtatsMetrage(token)

  const liste = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    const actifs = projets.filter((p) => p.issue !== 'perdu')
    if (!q) return actifs
    return actifs.filter((p) =>
      [p.client_nom, p.client_ville, p.metier, p.client_adresse]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    )
  }, [projets, recherche])

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Ruler className="size-4 text-primary" />
          Mesurer sans se déplacer
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Choisissez un chantier : la photo aérienne s’ouvre dessus, le bâtiment est déjà tracé
          avec sa hauteur. Touchez-le pour lire sa surface, son périmètre et sa toiture.
        </p>
      </div>

      {projets.length > 3 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            placeholder="Chercher un chantier…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
      )}

      {liste.length === 0 ? (
        <EmptyState
          icon={Ruler}
          titre={recherche ? 'Aucun chantier' : 'Pas encore de chantier'}
          description={
            recherche
              ? `Rien ne correspond à « ${recherche} ».`
              : 'Les mesures se prennent depuis un chantier, pour être rattachées au bon client.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {liste.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setChoisi(p)}
                className="w-full text-left"
              >
                <Card className="flex items-center gap-3 rounded-2xl border-border/70 p-3 shadow-card transition-all hover:shadow-card-hover active:scale-[0.99]">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10">
                    <Ruler className="size-5 text-primary" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{p.client_nom || 'Client'}</span>
                      {(etats?.get(p.token)?.a_verifier ?? 0) > 0 ? (
                        <span className="shrink-0 rounded-full bg-[#F59E0B]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#B45309]">
                          métrés à vérifier
                        </span>
                      ) : (etats?.get(p.token)?.retenues ?? 0) > 0 ? (
                        <span className="shrink-0 rounded-full bg-[#22C55E]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#16A34A]">
                          métrés prêts
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[p.client_adresse, p.client_ville].filter(Boolean).join(' · ') ||
                        p.client_ville ||
                        'Adresse non renseignée'}
                      {p.metier ? ` — ${p.metier}` : ''}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      {choisi && (
        <FeuilleMetreDifferee
          key={choisi.token}
          token={token}
          affectationToken={choisi.token}
          titre={choisi.client_nom}
          onClose={() => setChoisi(null)}
        />
      )}
    </div>
  )
}
