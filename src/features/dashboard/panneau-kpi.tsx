import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { formatEuros } from '@/lib/format'
import { useKpiAgence, useKpiParArtisan } from './use-kpi'
import { DashboardFeedback } from './dashboard-feedback'

type PeriodeProps = { debutPeriode?: string }

/** Une seule surface, quatre mesures et une période commune pilotée par la page. */
export function PanneauKpi({ debutPeriode }: PeriodeProps) {
  const { data, isLoading, isError, refetch } = useKpiAgence(debutPeriode)
  if (isLoading) return <Skeleton className="h-36 w-full rounded-xl" aria-label="Chargement des indicateurs" />
  if (isError || !data) return <DashboardFeedback message="Les indicateurs de la période sont indisponibles" retry={() => void refetch()} />
  const pctEncaissee = data.commission_acquise > 0 ? Math.min(100, Math.max(0, Math.round(data.commission_encaissee / data.commission_acquise * 100))) : 0

  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4">
      <Chiffre label="CA signé" valeur={formatEuros(data.ca_signe)} detail={`${data.signes} signatures d’artisans`} />
      <Chiffre label="Commission acquise" valeur={formatEuros(data.commission_acquise)} detail="Sur les projets gagnés" />
      <Chiffre label="Commission encaissée" valeur={formatEuros(data.commission_encaissee)} detail={`${pctEncaissee} % de la commission acquise`} />
      <Chiffre label="Reste à encaisser" valeur={formatEuros(data.commission_a_encaisser)} detail="Sur les projets de cette période" accent />
    </dl>
  )
}

/** Le parcours reste consultable sous le graphique, sans repousser l'activité. */
export function ParcoursChantiers({ debutPeriode }: PeriodeProps) {
  const { data, isLoading, isError } = useKpiAgence(debutPeriode)
  if (isLoading) return <Skeleton className="h-24 w-full rounded-xl" />
  // L'erreur et son bouton de réessai sont déjà affichés au-dessus, dans le bandeau.
  if (isError || !data) return null
  return (
    <section aria-labelledby="parcours-titre" className="border-t border-border px-5 py-4 sm:px-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="parcours-titre" className="text-[13px] font-medium">Parcours des chantiers</h3>
        <span className="text-xs text-muted-foreground">Sur la période de transmission</span>
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-6">
        <Etape label="Transmis" valeur={data.leads_transmis} />
        <Etape label="Ouverts" valeur={data.contactes} taux={data.taux_ouverture_sur_transmis} />
        <Etape label="RDV pris" valeur={data.rdv_pris} />
        <Etape label="Devis envoyés" valeur={data.devis_envoyes} taux={data.taux_devis_sur_transmis} />
        <Etape label="Signés" valeur={data.signes} accent />
        <Etape label="Perdus" valeur={data.perdus} />
      </dl>
      {data.jamais_ouverts > 0 && <p className="mt-4 text-xs text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{data.jamais_ouverts}</span> chantier{data.jamais_ouverts > 1 ? 's' : ''} en cours {data.jamais_ouverts > 1 ? 'n’ont pas encore été ouverts' : 'n’a pas encore été ouvert'} par leur artisan</p>}
    </section>
  )
}

export function DetailsKpi({ debutPeriode }: PeriodeProps) {
  const { data, isLoading, isError } = useKpiAgence(debutPeriode)
  const parArtisanQuery = useKpiParArtisan(debutPeriode)
  if (isLoading || isError || !data) return null
  const delaiFiable = data.delai_signature_n >= 5
  const artisansComparables = (parArtisanQuery.data ?? []).filter((a) => a.leads_transmis >= 3).slice(0, 10)
  return (
      <details className="rounded-xl border border-border bg-card">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Conversion, délais et comparaison des artisans</summary>
        <div className="space-y-6 border-t border-border p-5">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Mesure label="Taux de signature" valeur={data.taux_signature_sur_devis == null ? '—' : `${data.taux_signature_sur_devis} %`} detail="Sur les devis avec une issue connue, hors dossiers en cours" />
            <Mesure label="Conversion globale" valeur={data.taux_conversion_global == null ? '—' : `${data.taux_conversion_global} %`} detail="Sur les affectations closes ou rendues, hors dossiers encore en cours" />
            <Mesure label="Panier médian signé" valeur={formatEuros(data.panier_median)} detail={data.panier_moyen == null ? 'Pas de montant signé exploitable' : `Moyenne : ${formatEuros(data.panier_moyen)}`} />
            <Mesure label="Devis moyen envoyé" valeur={formatEuros(data.devis_moyen_envoye)} detail={data.devis_median_envoye == null ? 'Pas de devis chiffré exploitable' : `Médiane : ${formatEuros(data.devis_median_envoye)}`} />
          </div>

          <div className="border-t border-border pt-5">
            <h3 className="mb-4 text-sm font-medium">Délais médians des chantiers gagnés</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Mesure label="Transmission → premier contact" valeur={data.delai_ouverture_j == null ? '—' : `${data.delai_ouverture_j} j`} />
              <Mesure label="Transmission → signature" valeur={delaiFiable && data.delai_signature_j != null ? `${data.delai_signature_j} j` : '—'} />
              <Mesure label="Devis → signature" valeur={data.delai_devis_signe_j == null ? '—' : `${data.delai_devis_signe_j} j`} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{delaiFiable ? `Délai de signature mesuré sur ${data.delai_signature_n} observations` : `Délai de signature masqué : ${data.delai_signature_n} observations, 5 minimum pour une indication fiable`}</p>
          </div>

          <div className="border-t border-border pt-5">
            <h3 className="mb-4 text-sm font-medium">Comparaison des artisans</h3>
            {parArtisanQuery.isLoading ? <Skeleton className="h-40 w-full" /> : parArtisanQuery.isError ? (
              <DashboardFeedback message="La comparaison des artisans est indisponible" retry={() => void parArtisanQuery.refetch()} />
            ) : artisansComparables.length === 0 ? <p className="text-sm text-muted-foreground">Aucun artisan n’a reçu au moins 3 chantiers sur cette période</p> : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Comparaison des artisans, tableau défilant">
                <table className="w-full min-w-[680px] text-sm">
                  <caption className="sr-only">Artisans ayant reçu au moins 3 chantiers sur la période sélectionnée</caption>
                  <thead><tr className="border-b border-border text-xs text-muted-foreground">
                    {['Artisan', 'Reçus', 'Devis', 'Signés', 'Conversion', 'Délai', 'CA signé'].map((label, i) => <th key={label} scope="col" className={`px-2 pb-3 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{label}</th>)}
                  </tr></thead>
                  <tbody>{artisansComparables.map((a) => (
                    <tr key={a.artisan_id} className="border-b border-border last:border-0">
                      <th scope="row" className="px-2 py-3 text-left font-normal"><Link to={`/artisans/${a.artisan_id}`} className="hover:text-primary hover:underline">{a.artisan_nom}</Link></th>
                      <td className="px-2 py-3 text-right tabular-nums">{a.leads_transmis}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{a.devis_envoyes}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{a.signes}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{a.taux_conversion_global == null ? '—' : `${a.taux_conversion_global} %`}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{a.delai_signature_j == null ? '—' : `${a.delai_signature_j} j`}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{formatEuros(a.ca_signe)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Jusqu’à 10 artisans ayant reçu au moins 3 chantiers. La conversion porte sur les affectations closes ou rendues.</p>
          </div>
        </div>
      </details>
  )
}

function Chiffre({ label, valeur, detail, accent = false }: { label: string; valeur: string; detail: string; accent?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-5 even:border-l even:border-border [&:nth-child(n+3)]:border-t [&:nth-child(n+3)]:border-border sm:px-6 lg:[&:nth-child(n+2)]:border-l lg:[&:nth-child(n+2)]:border-border lg:[&:nth-child(n+3)]:border-t-0">
      <dt className="text-xs text-muted-foreground sm:text-[13px]">{label}</dt>
      <dd className={`montant mt-3 break-words text-2xl font-medium leading-none sm:text-[32px] xl:text-[36px] 2xl:text-[40px] ${accent ? 'text-primary' : 'text-foreground'}`}>{valeur}</dd>
      <dd className="mt-3 text-xs leading-relaxed text-muted-foreground">{detail}</dd>
    </div>
  )
}

function Etape({ label, valeur, taux, accent = false }: { label: string; valeur: number; taux?: number | null; accent?: boolean }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`montant mt-2 text-xl font-medium leading-none ${accent ? 'text-primary' : ''}`}>{valeur}</dd>{taux != null && <dd className="mt-2 text-xs tabular-nums text-muted-foreground">{taux} % des transmis</dd>}</div>
}

function Mesure({ label, valeur, detail }: { label: string; valeur: string; detail?: string }) {
  return <div><p className="text-sm text-muted-foreground">{label}</p><p className="montant mt-2 text-xl font-medium">{valeur}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>
}
