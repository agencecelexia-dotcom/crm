import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ClipboardCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { supabase } from '@/lib/supabase/client'
import { QUANTITES, type Unite } from './catalogue-metrage'
import { SOURCE_MESURE, valeurLisible } from './affichage-metrage'
import { useTrancherMetrage, type LigneMetrage } from './use-metrage'

type Ecart = LigneMetrage & { projet: { id: string; client_nom: string | null; client_ville: string | null } | null }

/**
 * Les métrés à vérifier : là où la parole du client et la mesure divergent.
 *
 * L'outil mesure, l'agence tranche — comme les services de métré du marché,
 * où un humain relit chaque rapport avant qu'il parte. Un clic retient la
 * bonne valeur ; l'artisan lira celle-là.
 */
export function MetragesAVerifierPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['metrages-a-verifier'],
    queryFn: async (): Promise<Ecart[]> => {
      const { data, error } = await supabase
        .from('metrage_chantier')
        .select(
          'cle, unite, valeur_declaree, declaree_par, citation, valeur_mesuree, mesure_source, statut, valeur_retenue, retenue_par, note, projet:projets(id, client_nom, client_ville)',
        )
        .in('statut', ['ecart', 'sources_desaccord'])
      if (error) throw error
      return (data as unknown as Ecart[]) ?? []
    },
  })

  const parProjet = new Map<string, Ecart[]>()
  for (const e of data ?? []) {
    if (!e.projet) continue
    parProjet.set(e.projet.id, [...(parProjet.get(e.projet.id) ?? []), e])
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageHeader titre="Métrés à vérifier" sousTitre="Ce que dit le client contre ce que mesure l’outil." />
      {isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : parProjet.size === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          titre="Rien à vérifier"
          description="Chaque mesure concorde avec ce que les clients ont dit, ou a été tranchée."
        />
      ) : (
        [...parProjet.entries()].map(([id, lignes]) => (
          <Card key={id} className="space-y-2 rounded-2xl p-4">
            <Link to={`/projets/${id}`} className="flex items-center justify-between gap-2 font-medium hover:underline">
              <span className="truncate">
                {lignes[0].projet?.client_nom || 'Client'}
                {lignes[0].projet?.client_ville && (
                  <span className="font-normal text-muted-foreground"> · {lignes[0].projet.client_ville}</span>
                )}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
            <ul className="divide-y divide-border">
              {lignes.map((l) => (
                <Ligne key={l.cle} projetId={id} ligne={l} />
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  )
}

function Ligne({ projetId, ligne }: { projetId: string; ligne: Ecart }) {
  const trancher = useTrancherMetrage(projetId)
  const q = QUANTITES[ligne.cle]
  const unite = ligne.unite as Unite
  const retenir = (valeur: number) =>
    trancher.mutate(
      { cle: ligne.cle, unite, valeur },
      {
        onSuccess: () => toast.success('Valeur retenue'),
        onError: (e) => toast.error('Non enregistré', { description: e instanceof Error ? e.message : undefined }),
      },
    )
  return (
    <li className="space-y-1.5 py-2.5 text-sm">
      <p className="font-medium">{q?.libelle ?? ligne.cle}</p>
      <p className="text-xs text-muted-foreground">
        {ligne.valeur_declaree != null && (
          <>
            Dit : <span className="text-foreground">{valeurLisible(ligne.valeur_declaree, unite)}</span>
            {ligne.citation && <> « {ligne.citation} »</>}
            {' · '}
          </>
        )}
        Mesuré : <span className="text-foreground">{valeurLisible(ligne.valeur_mesuree, unite)}</span>
        {ligne.mesure_source && ` (${SOURCE_MESURE[ligne.mesure_source] ?? ligne.mesure_source})`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {ligne.valeur_mesuree != null && (
          <Button size="sm" variant="outline" disabled={trancher.isPending} onClick={() => retenir(ligne.valeur_mesuree!)}>
            Retenir {valeurLisible(ligne.valeur_mesuree, unite)} (mesuré)
          </Button>
        )}
        {ligne.valeur_declaree != null && (
          <Button size="sm" variant="outline" disabled={trancher.isPending} onClick={() => retenir(ligne.valeur_declaree!)}>
            Retenir {valeurLisible(ligne.valeur_declaree, unite)} (dit)
          </Button>
        )}
      </div>
    </li>
  )
}
