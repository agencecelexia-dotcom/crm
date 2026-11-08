import { useQuery } from '@tanstack/react-query'

import { CardTitre } from '@/components/card-titre'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'

interface LigneMetier {
  metier: string
  transmis: number
  gagnes: number
  refuses_artisan: number
  perdus_client: number
  panier_moyen: number
  taux_signature: number | null
}

interface LigneDep {
  dep: string
  transmis: number
  gagnes: number
  refuses_artisan: number
  jamais_contactes: number
}

interface Qualite {
  par_metier: LigneMetier[]
  par_departement: LigneDep[]
  total_transmis: number
  total_refuses_artisan: number
}

/**
 * Qualité des leads transmis, par métier et par département.
 *
 * Sans cette vue, impossible de distinguer un problème de CIBLAGE (l'artisan
 * refuse le lead d'emblée) d'un problème de CONVERSION (le client dit non).
 * `jamais_contactes` est le signal le plus direct : un département où les
 * leads ne sont même pas appelés indique soit un artisan hors zone, soit un
 * lead de mauvaise qualité.
 */
export function QualiteLeads() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['qualite-leads'],
    queryFn: async (): Promise<Qualite> => {
      const { data, error } = await supabase.rpc('qualite_leads')
      if (error) throw error
      return data as Qualite
    },
  })

  if (isLoading) return <Skeleton className="mb-4 h-64 w-full rounded-2xl" />
  if (isError || !data) {
    return (
      <Card className="mb-4 rounded-2xl border-destructive/30 bg-destructive/5">
        <CardContent className="py-4 text-sm">
          <p className="font-medium">Impossible de charger la qualité des leads.</p>
          <button onClick={() => void refetch()} className="mt-1 text-xs underline">
            Réessayer
          </button>
        </CardContent>
      </Card>
    )
  }

  const metiers = data.par_metier.slice(0, 8)
  const deps = [...data.par_departement]
    .sort((a, b) => b.jamais_contactes - a.jamais_contactes)
    .slice(0, 8)

  return (
    <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
      <CardHeader>
        <CardTitre>
          Qualité des leads
        </CardTitre>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Par métier
          </p>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Qualité des demandes par métier, tableau défilant">
            <table className="w-full min-w-[420px] text-sm">
              <caption className="sr-only">Qualité des demandes par métier, tout l’historique</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="pb-1.5 font-medium">Métier</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">Transmis</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">Gagnés</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">Signature</th>
                  <th scope="col" className="pb-1.5 text-right font-medium">Panier moyen</th>
                </tr>
              </thead>
              <tbody>
                {metiers.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">Aucune demande transmise à analyser</td></tr>}
                {metiers.map((m) => (
                  <tr key={m.metier} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-2">{m.metier}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.transmis}</td>
                    <td className="py-1.5 text-right tabular-nums">{m.gagnes}</td>
                    <td
                      className={cn(
                        'py-1.5 text-right tabular-nums',
                        m.taux_signature != null && m.taux_signature < 10 && 'text-[#DC2626]',
                      )}
                    >
                      {m.taux_signature != null ? `${m.taux_signature} %` : '—'}
                    </td>
                    <td className="montant py-1.5 text-right tabular-nums">
                      {m.panier_moyen > 0 ? formatEuros(m.panier_moyen) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Départements où les leads ne sont pas traités
          </p>
          <div className="flex flex-wrap gap-2">
            {deps.length === 0 && <p className="text-sm text-muted-foreground">Aucun département à analyser</p>}
            {deps.map((d) => (
              <span
                key={d.dep}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs',
                  d.jamais_contactes >= d.transmis / 2
                    ? 'border-[#DC2626]/30 bg-[#DC2626]/5 text-[#DC2626]'
                    : 'border-border bg-muted/30 text-muted-foreground',
                )}
              >
                <strong className="tabular-nums">{d.dep}</strong> · {d.jamais_contactes}/
                {d.transmis} jamais contactés
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Un lead jamais contacté signale soit un artisan hors de sa zone réelle, soit un
            lead mal ciblé. C'est le signal le plus direct sur la qualité de l'attribution.
          </p>
        </div>

        {data.total_refuses_artisan === 0 && (
          <p className="rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
            Aucun refus qualifié pour l'instant : les motifs normalisés ne sont enregistrés
            que depuis leur mise en place. Cette section s'enrichira à mesure que les
            artisans motiveront leurs retraits.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
