import { useMemo, useState } from 'react'
import { ChevronRight, Ruler, Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import type { ProjetEspace } from '@/types/database'
import { FeuilleMetreDifferee } from './feuille-metre-differee'
import { useEtatsMetrage } from './use-metrage'

/** Les mesures restent attachées au chantier choisi, à son client et à l'agence. */
export function EcranMetres({ token, projets }: { token: string; projets: ProjetEspace[] }) {
  const [recherche, setRecherche] = useState('')
  const [choisi, setChoisi] = useState<ProjetEspace | null>(null)
  const { data: etats, isLoading, isError, refetch } = useEtatsMetrage(token)
  const liste = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    const actifs = projets.filter((p) => p.issue !== 'perdu')
    if (!q) return actifs
    return actifs.filter((p) => [p.client_nom, p.client_ville, p.metier, p.client_adresse].filter(Boolean).some((v) => v!.toLowerCase().includes(q)))
  }, [projets, recherche])

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">Choisissez un chantier pour ouvrir sa vue aérienne et consulter la surface, le périmètre et la toiture du bâtiment. Les mesures restent rattachées au bon client.</p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input aria-label="Rechercher un chantier à mesurer" className="h-10 bg-card pl-9" placeholder="Client, adresse ou métier" value={recherche} onChange={(e) => setRecherche(e.target.value)} /></div>
          <p className="text-xs tabular-nums text-muted-foreground">{liste.length} chantier{liste.length > 1 ? 's' : ''}</p>
        </div>
        {isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3"><p className="text-xs text-muted-foreground">L’état des métrés est indisponible. Vous pouvez toujours ouvrir un chantier.</p><Button variant="outline" size="sm" onClick={() => void refetch()}>Réessayer</Button></div>}
        {liste.length === 0 ? (
          <div className="p-5"><EmptyState icon={Ruler} titre={recherche ? 'Aucun chantier correspondant' : 'Aucun chantier disponible'} description={recherche ? `Aucun résultat pour « ${recherche} »` : 'Les mesures se prennent depuis un chantier, pour être rattachées au bon client.'} action={recherche ? <Button variant="outline" onClick={() => setRecherche('')}>Effacer la recherche</Button> : undefined} /></div>
        ) : (
          <ul className="divide-y divide-border">{liste.map((p) => {
            const aVerifier = (etats?.get(p.token)?.a_verifier ?? 0) > 0
            const pret = (etats?.get(p.token)?.retenues ?? 0) > 0
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setChoisi(p)} className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/50 sm:gap-4">
                  <Ruler className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{p.client_nom || 'Client'}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{[p.client_adresse, p.client_ville].filter(Boolean).join(' · ') || 'Adresse non renseignée'}{p.metier ? ` · ${p.metier}` : ''}</span><span className={`mt-2 block text-xs sm:hidden ${aVerifier ? 'text-amber-800' : 'text-muted-foreground'}`}>{isLoading ? 'Chargement du métré…' : isError ? 'Ouvrir le métré' : aVerifier ? 'Métrés à vérifier' : pret ? 'Métrés prêts' : 'À mesurer'}</span></span>
                  <span className={`hidden shrink-0 text-xs sm:inline ${aVerifier ? 'text-amber-800' : 'text-muted-foreground'}`}>{isLoading ? 'Chargement…' : isError ? 'Ouvrir le métré' : aVerifier ? 'Métrés à vérifier' : pret ? 'Métrés prêts' : 'À mesurer'}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            )
          })}</ul>
        )}
      </div>
      {choisi && <FeuilleMetreDifferee key={choisi.token} token={token} affectationToken={choisi.token} titre={choisi.client_nom} onClose={() => setChoisi(null)} />}
    </div>
  )
}
