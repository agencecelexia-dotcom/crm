import { useQuery } from '@tanstack/react-query'
import { Download, Eye } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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

function formatTaux(taux: number | null): string {
  return taux == null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(taux * 100)} %`
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
    l.assiette ?? '', l.taux != null ? formatTaux(l.taux) : '',
    l.commission ?? '', l.reglee ? 'oui' : 'non',
  ])
  const csv = [entetes, ...lignes]
    .map((r) => r.map((c) => `"${(typeof c === 'string' && /^[\s]*[=+@-]/.test(c) ? "'" + c : String(c)).replace(/"/g, '""')}"`).join(';'))
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

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />
  if (isError || !data) {
    return (
      <div role="alert" className="rounded-xl border border-border bg-card p-5 text-sm">
        <p className="font-medium">Impossible de charger le relevé.</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()} className="mt-3">Réessayer</Button>
      </div>
    )
  }

  return (
    <section aria-label="Relevé détaillé des commissions" className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <dl className="grid grid-cols-2 divide-x divide-border">
          <div className="px-5 py-5 sm:px-6"><dt className="text-[13px] text-muted-foreground">Reste à régler</dt><dd className="montant mt-3 text-2xl font-medium text-primary sm:text-[32px]">{formatEuros(data.total_du)}</dd></div>
          <div className="px-5 py-5 sm:px-6"><dt className="text-[13px] text-muted-foreground">Déjà réglé</dt><dd className="montant mt-3 text-2xl font-medium sm:text-[32px]">{formatEuros(data.total_regle)}</dd></div>
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6">
          <div><h2 className="text-sm font-medium">Détail par chantier</h2><p className="mt-1 text-xs text-muted-foreground">Montant signé × taux = commission due</p></div>
          <Button variant="outline" size="sm" onClick={() => exporterCsv(data)} disabled={data.lignes.length === 0}><Download className="size-3.5" aria-hidden />Exporter en CSV</Button>
        </div>
        {data.lignes.length === 0 ? <p className="border-t border-border px-5 py-10 text-sm text-muted-foreground sm:px-6">Aucun chantier signé à afficher dans le relevé</p> : (
          <>
            <div className="hidden overflow-x-auto md:block" tabIndex={0} role="region" aria-label="Relevé de commissions, tableau défilant">
              <table className="w-full min-w-[720px] text-[13px]">
                <caption className="sr-only">Commissions par chantier : assiette, taux, montant et état du règlement</caption>
                <thead><tr className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground"><th scope="col" className="px-6 py-3 font-normal">Client</th><th scope="col" className="px-3 py-3 font-normal">Signature</th><th scope="col" className="px-3 py-3 text-right font-normal">Montant signé</th><th scope="col" className="px-3 py-3 text-right font-normal">Taux</th><th scope="col" className="px-3 py-3 text-right font-normal">Commission</th><th scope="col" className="px-3 py-3 font-normal">Règlement</th><th scope="col" className="px-4 py-3 font-normal"><span className="sr-only">Justificatif</span></th></tr></thead>
                <tbody>{data.lignes.map((l) => (
                  <tr key={l.projet_id} className="border-b border-border last:border-0">
                    <th scope="row" className="max-w-64 px-6 py-4 text-left font-normal"><span className="block truncate font-medium">{l.client ?? 'Client'}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{[l.ville, l.metier].filter(Boolean).join(' · ')}</span></th>
                    <td className="whitespace-nowrap px-3 py-4 text-xs tabular-nums text-muted-foreground">{formatDate(l.date_signature)}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums">{formatEuros(l.assiette)}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-right text-xs tabular-nums text-muted-foreground">{formatTaux(l.taux)}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-right font-medium tabular-nums">{formatEuros(l.commission)}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-xs"><span className="inline-flex items-center gap-1.5"><span aria-hidden className={`size-1.5 rounded-full ${l.reglee ? 'bg-muted-foreground/60' : 'bg-primary'}`} />{l.reglee ? 'Réglée' : 'À régler'}</span></td>
                    <td className="px-4 py-4">{l.devis_url ? <a href={l.devis_url} target="_blank" rel="noopener noreferrer" className="flex min-h-9 min-w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Justificatif de ${l.client ?? 'ce chantier'}`}><Eye className="size-4" aria-hidden /></a> : <span className="text-xs text-muted-foreground">—</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <ul className="divide-y divide-border border-t border-border md:hidden">{data.lignes.map((l) => (
              <li key={l.projet_id} className="space-y-3 px-5 py-4">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{l.client ?? 'Client'}</p><p className="mt-1 text-xs text-muted-foreground">{[l.ville, l.metier].filter(Boolean).join(' · ')}{l.date_signature && ` · signé le ${formatDate(l.date_signature)}`}</p></div><span className="shrink-0 text-xs text-muted-foreground">{l.reglee ? 'Réglée' : 'À régler'}</span></div>
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[13px] tabular-nums">{formatEuros(l.assiette)} <span className="text-muted-foreground">× {formatTaux(l.taux)} = </span><span className="font-medium">{formatEuros(l.commission)}</span></p>{l.devis_url && <a href={l.devis_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 text-xs text-primary"><Eye className="size-3.5" aria-hidden />Justificatif</a>}</div>
              </li>
            ))}</ul>
          </>
        )}
      </div>
      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">La commission est due à Celexia dès la signature du devis par le client, au taux prévu à votre contrat d’engagement{data.taux_contractuel != null && <> ({formatTaux(data.taux_contractuel)})</>}. Le montant signé constitue l’assiette du calcul ; le statut « Réglée » indique que la commission a été encaissée par Celexia.</p>
    </section>
  )
}
