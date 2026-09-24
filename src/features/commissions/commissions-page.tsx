import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BadgeEuro, Check, Loader2, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatEuros, formatDate } from '@/lib/format'
import { useProjets, usePatchProjet } from '@/features/projets/hooks/use-projets'
import { supabase } from '@/lib/supabase/client'

// Suivi de l'argent : devis signés dont la commission n'est pas encore encaissée.
export function CommissionsPage() {
  const { data: projets, isLoading } = useProjets()
  const patch = usePatchProjet()
  const qc = useQueryClient()

  // CE QUI EST DÛ, SELON LA MÊME DÉFINITION QUE LES INDICATEURS.
  //
  // La page listait tout projet portant un montant signé non encaissé : un
  // dossier « en attente », saisi à 60 000 € sans aucune signature, y figurait
  // pour 6 000 € de commission due, avec un bouton « Encaissée » — de quoi
  // facturer un artisan pour un chantier jamais signé. On ne liste plus que
  // les affaires réellement gagnées par un artisan (`commissions_dues`, 0166).
  const { data: dues } = useQuery({
    queryKey: ['commissions-dues'],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.rpc('commissions_dues')
      if (error) throw error
      return new Set(((data as { projet_id: string }[]) ?? []).map((d) => d.projet_id))
    },
  })

  const aEncaisser = useMemo(
    () =>
      (projets ?? [])
        .filter((p) => dues?.has(p.id))
        .sort((a, b) => (b.commission ?? 0) - (a.commission ?? 0)),
    [projets, dues],
  )

  const totalDu = aEncaisser.reduce((s, p) => s + (p.commission ?? 0), 0)

  function encaisser(id: string) {
    patch.mutate(
      { id, patch: { commission_encaissee: true } },
      {
        onSuccess: () => {
          toast.success('Commission encaissée')
          // La liste vient de `commissions_dues` : sans ceci, la ligne restait.
          void qc.invalidateQueries({ queryKey: ['commissions-dues'] })
        },
        onError: (e) =>
          toast.error('Échec', { description: e instanceof Error ? e.message : undefined }),
      },
    )
  }

  return (
    <div>
      <PageHeader
        titre="Commissions à encaisser"
        sousTitre="Devis signés dont la commission n'est pas encore encaissée"
      />

      {/* Total dû */}
      <Card className="mb-4 flex items-center justify-between rounded-2xl border-primary/25 bg-primary/5 p-4 shadow-card">
        <span className="text-sm font-medium text-muted-foreground">
          Total à encaisser ({aEncaisser.length})
        </span>
        <span className="montant text-2xl font-semibold text-primary">{formatEuros(totalDu)}</span>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : aEncaisser.length === 0 ? (
        <EmptyState
          icon={BadgeEuro}
          titre="Rien à encaisser 🎉"
          description="Toutes les commissions des devis signés sont encaissées."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {aEncaisser.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-col gap-3 rounded-2xl border-border/70 p-3.5 shadow-card transition-shadow hover:shadow-card-hover">
                <Link to={`/projets/${p.id}`} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.client_nom}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.artisan?.societe ?? p.artisan?.nom ?? 'Artisan ?'}
                      {p.client_ville && ` · ${p.client_ville}`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Signé {p.date_signature ? `le ${formatDate(p.date_signature)}` : ''} ·{' '}
                      {formatEuros(p.montant_devis_signe)} TTC
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  <span className="montant text-lg font-semibold text-primary">
                    {formatEuros(p.commission)}
                  </span>
                  <Button size="sm" disabled={patch.isPending} onClick={() => encaisser(p.id)}>
                    {patch.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    Encaissée
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
