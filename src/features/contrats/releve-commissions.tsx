import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Clock, Download, Eye, Wallet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatEuros, formatDate } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'

interface LigneCommission {
  projet_id: string
  client: string | null
  ville: string | null
  metier: string | null
  /** Montant sur lequel la commission est calculée. */
  assiette: number | null
  taux: number | null
  commission: number | null
  reglee: boolean
  date_signature: string | null
  devis_url: string | null
}

interface Releve {
  taux_contractuel: number | null
  lignes: LigneCommission[]
  total_du: number
  total_regle: number
}

/** Export CSV, pour recouper avec la comptabilité. */
function exporterCsv(r: Releve) {
  const entetes = [
    'Client', 'Ville', 'Métier', 'Date signature',
    'Montant signé (assiette)', 'Taux', 'Commission', 'Réglée',
  ]
  const lignes = r.lignes.map((l) => [
    l.client ?? '', l.ville ?? '', l.metier ?? '', l.date_signature ?? '',
    l.assiette ?? '', l.taux != null ? `${Math.round(l.taux * 100)}%` : '',
    l.commission ?? '', l.reglee ? 'oui' : 'non',
  ])
  const csv = [entetes, ...lignes]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\n')
  // BOM : sans lui, Excel casse les accents.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `commissions-celexia-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}

/**
 * Relevé de commissions, ligne par ligne.
 *
 * La commission n'était qu'un total agrégé : ni taux, ni assiette, ni détail,
 * ni justificatif (audit §2). Sur le point le plus sensible de la relation
 * apporteur/artisan, l'artisan ne pouvait pas recouper le calcul.
 */
export function ReleveCommissions({ token }: { token: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['releve-commissions', token],
    queryFn: async (): Promise<Releve | null> => {
      const { data, error } = await supabase.rpc('releve_commissions_by_token', {
        p_token: token,
      })
      if (error) throw error
      return data as Releve | null
    },
  })

  if (isLoading) return <Skeleton className="h-40 w-full rounded-2xl" />
  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="font-medium">Impossible de charger le relevé.</p>
        <button onClick={() => void refetch()} className="mt-1 text-xs underline">
          Réessayer
        </button>
      </div>
    )
  }
  if (data.lignes.length === 0) return null

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-display text-xl tracking-tight sm:text-2xl">
          <span aria-hidden className="inline-block h-5 w-1 rounded-full bg-primary" />
          Vos commissions
        </h2>
        <Button variant="outline" size="sm" className="bg-card" onClick={() => exporterCsv(data)}>
          <Download className="size-4" />
          Exporter (CSV)
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[#F59E0B]/25 bg-[#F59E0B]/5 p-3.5">
          <p className="flex items-center gap-1.5 text-xs text-[#B45309]">
            <Clock className="size-3.5" /> Reste à régler
          </p>
          <p className="montant mt-1 text-xl font-semibold text-[#B45309]">
            {formatEuros(data.total_du)}
          </p>
        </div>
        <div className="rounded-2xl border border-[#22C55E]/25 bg-[#22C55E]/5 p-3.5">
          <p className="flex items-center gap-1.5 text-xs text-[#16A34A]">
            <CheckCircle2 className="size-3.5" /> Déjà réglé
          </p>
          <p className="montant mt-1 text-xl font-semibold text-[#16A34A]">
            {formatEuros(data.total_regle)}
          </p>
        </div>
      </div>

      {/* Détail : l'artisan doit pouvoir refaire le calcul lui-même. */}
      <div className="space-y-2">
        {data.lignes.map((l) => (
          <div
            key={l.projet_id}
            className={cn(
              'rounded-xl border p-3',
              l.reglee ? 'border-border bg-muted/20' : 'border-[#F59E0B]/30 bg-card',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.client ?? 'Client'}</p>
                <p className="text-xs text-muted-foreground">
                  {[l.ville, l.metier].filter(Boolean).join(' · ')}
                  {l.date_signature && ` · signé le ${formatDate(l.date_signature)}`}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                  l.reglee
                    ? 'bg-[#22C55E]/15 text-[#16A34A]'
                    : 'bg-[#F59E0B]/15 text-[#B45309]',
                )}
              >
                {l.reglee ? 'Réglée' : 'À régler'}
              </span>
            </div>

            {/* Le calcul est écrit en toutes lettres : plus de chiffre nu. */}
            <p className="mt-2 flex flex-wrap items-baseline gap-1.5 text-sm">
              <span className="montant tabular-nums">{formatEuros(l.assiette)}</span>
              <span className="text-muted-foreground">
                × {l.taux != null ? `${Math.round(l.taux * 100)} %` : '—'} =
              </span>
              <span className="montant font-semibold tabular-nums">
                {formatEuros(l.commission)}
              </span>
              {l.devis_url && (
                <Button variant="ghost" size="sm" className="ml-auto h-7" asChild>
                  <a href={l.devis_url} target="_blank" rel="noopener">
                    <Eye className="size-3.5" />
                    Justificatif
                  </a>
                </Button>
              )}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Wallet className="mt-0.5 size-3.5 shrink-0" />
        La commission est due à Celexia dès la signature du devis par le client, au taux
        prévu à votre contrat d'engagement
        {data.taux_contractuel != null && (
          <> ({Math.round(data.taux_contractuel * 100)} %)</>
        )}
        .
      </p>
    </section>
  )
}
