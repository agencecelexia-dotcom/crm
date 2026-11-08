import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO, startOfMonth, subDays } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ArrowUpRight, Plus } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { StatutBadge } from '@/components/statut-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { dansLePipeline, STATUTS, STATUTS_ORDRE, STATUTS_PERTE } from '@/lib/constants'
import { formatEuros, formatDate, formatTel } from '@/lib/format'
import { useDroits } from '@/lib/auth/use-droits'
import { useProjets } from '@/features/projets/hooks/use-projets'
import { useArtisans } from '@/features/artisans/hooks/use-artisans'
import { useCaParMois, useKpiParArtisan } from './use-kpi'
import { ActionDuJour } from './action-du-jour'
import { ATraiter } from './a-traiter'
import { DetailsKpi, PanneauKpi, ParcoursChantiers } from './panneau-kpi'
import { QualiteLeads } from './qualite-leads'
import { DashboardFeedback } from './dashboard-feedback'

const GraphiqueCa = lazy(() => import('./graphiques').then((m) => ({ default: m.GraphiqueCa })))
const PERIODES = [
  { cle: 'mois', label: 'Ce mois-ci' },
  { cle: '90', label: '90 jours' },
  { cle: 'tout', label: 'Tout l’historique' },
] as const

type Periode = (typeof PERIODES)[number]['cle']

export function DashboardPage() {
  const projetsQuery = useProjets()
  const artisansQuery = useArtisans()
  const { peutCreerLead } = useDroits()
  const [periode, setPeriode] = useState<Periode>('mois')
  const [vueProjets, setVueProjets] = useState<'recents' | 'rappels'>('recents')
  const debutPeriode = periode === 'tout'
    ? undefined
    : format(periode === 'mois' ? startOfMonth(new Date()) : subDays(new Date(), 89), 'yyyy-MM-dd')
  const kpiArtisansQuery = useKpiParArtisan(debutPeriode)
  const caQuery = useCaParMois(6)
  const projets = projetsQuery.data ?? []

  const topArtisans = useMemo(() => (kpiArtisansQuery.data ?? [])
    .filter((a) => a.ca_signe > 0)
    .sort((a, b) => b.ca_signe - a.ca_signe)
    .slice(0, 5), [kpiArtisansQuery.data])

  const moisData = (caQuery.data ?? []).map((m) => ({
    label: format(parseISO(`${m.mois}-01`), 'MMM yy', { locale: fr }),
    ca: Number(m.ca),
    commission: Number(m.commission),
  }))

  // Ces listes décrivent le portefeuille actuel, indépendamment de la période
  // de transmission choisie pour les indicateurs d'activité.
  const aRappeler = projets.filter((p) => p.statut === 'a_rappeler' || p.statut === 'en_attente')
  const actifs = projets.filter((p) => dansLePipeline(p.statut) && !['perdu', 'mort', 'termine', 'devis_signe'].includes(p.statut))
  const estimes = actifs.filter((p) => p.estimation_interne != null)
  const potentiel = estimes.reduce((s, p) => s + (p.estimation_interne ?? 0), 0)
  const commissionPotentielle = estimes.reduce((s, p) => s + (p.estimation_interne ?? 0) * (p.taux_commission ?? 0.1), 0)
  const perdus = projets.filter((p) => STATUTS_PERTE.includes(p.statut))
  const valeurPerdue = perdus.reduce((s, p) => s + (p.montant_devis ?? p.estimation_interne ?? 0), 0)
  const devisEnAttente = projets.filter((p) => p.statut === 'devis_envoye')
  const parStatut = STATUTS_ORDRE.map((statut) => ({ statut, count: projets.filter((p) => p.statut === statut).length }))
    .filter((s) => s.count > 0)

  const projetsAffiches = (vueProjets === 'rappels' ? aRappeler : projets).slice(0, 5)

  return (
    <div className="space-y-6">
      <PageHeader
        titre="Tableau de bord"
        sousTitre={format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })}
        action={peutCreerLead && <Button asChild><Link to="/projets/new"><Plus className="size-4" aria-hidden />Nouveau projet</Link></Button>}
      />

      <section aria-labelledby="resultats-titre" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="resultats-titre" className="text-sm font-medium">Performance de l’agence</h2>
            <p className="mt-1 text-xs text-muted-foreground">{debutPeriode ? `Chantiers transmis depuis le ${formatDate(debutPeriode)}` : 'Toutes les transmissions aux artisans'} · résultats connus à ce jour</p>
          </div>
          <div role="group" aria-label="Période des chantiers transmis" className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
            {PERIODES.map((p) => (
              <button key={p.cle} type="button" aria-pressed={periode === p.cle} onClick={() => setPeriode(p.cle)}
                className={cn('min-h-11 rounded-md px-3 text-xs transition-colors md:min-h-8', periode === p.cle ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <PanneauKpi debutPeriode={debutPeriode} />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <aside aria-labelledby="priorites-titre" className="min-w-0 overflow-hidden xl:order-2 rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-5">
            <h2 id="priorites-titre" className="text-base font-medium">À traiter</h2>
            <p className="mt-1 text-xs text-muted-foreground">Situation actuelle · toutes périodes</p>
          </div>
          <ATraiter />
          <ActionDuJour />
        </aside>

        <section aria-labelledby="signatures-titre" className="min-w-0 overflow-hidden xl:order-1 rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-2 px-5 pb-2 pt-5 sm:px-6 sm:pt-6">
            <div>
              <h2 id="signatures-titre" className="text-base font-medium">Évolution des signatures</h2>
              <p className="mt-1 text-xs text-muted-foreground">CA signé et commissions · 6 derniers mois</p>
            </div>
            <span className="text-xs text-muted-foreground">Par date de signature</span>
          </div>
          <div className="px-3 pb-4 pt-4 sm:px-5">
            {caQuery.isLoading ? <Skeleton className="h-80 w-full" /> : caQuery.isError ? (
              <DashboardFeedback message="L’historique des signatures est indisponible" retry={() => void caQuery.refetch()} />
            ) : moisData.length === 0 ? <p className="py-24 text-center text-sm text-muted-foreground">Aucun historique de signature disponible</p> : (
              <Suspense fallback={<Skeleton className="h-80 w-full" />}><GraphiqueCa data={moisData} /></Suspense>
            )}
            <p className="mt-3 px-1 text-xs text-muted-foreground">Historique indépendant du filtre de transmission</p>
          </div>
          <ParcoursChantiers debutPeriode={debutPeriode} />
        </section>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="portefeuille-titre" className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
            <h2 id="portefeuille-titre" className="text-base font-medium">Portefeuille</h2>
            <Link to="/projets" className="flex min-h-8 items-center gap-1 text-xs text-muted-foreground hover:text-primary">Tous les projets<ArrowUpRight className="size-3.5" aria-hidden /></Link>
          </div>
          <div role="group" aria-label="Projets affichés dans le portefeuille" className="flex gap-5 border-b border-border px-5 sm:px-6">
            <button type="button" aria-pressed={vueProjets === 'recents'} onClick={() => setVueProjets('recents')} className={cn('min-h-11 border-b-2 text-xs transition-colors', vueProjets === 'recents' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>Derniers projets</button>
            <button type="button" aria-pressed={vueProjets === 'rappels'} onClick={() => setVueProjets('rappels')} className={cn('min-h-11 border-b-2 text-xs transition-colors', vueProjets === 'rappels' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>À rappeler <span className="ml-1 tabular-nums text-muted-foreground">{projetsQuery.isLoading || projetsQuery.isError ? '—' : aRappeler.length}</span></button>
          </div>
          {projetsQuery.isLoading ? <div className="p-5"><Skeleton className="h-64 w-full" /></div> : projetsQuery.isError ? (
            <div className="p-5"><DashboardFeedback message="Le portefeuille n’a pas pu être chargé" retry={() => void projetsQuery.refetch()} /></div>
          ) : projetsAffiches.length === 0 ? <p className="px-6 py-10 text-sm text-muted-foreground">{vueProjets === 'rappels' ? 'Aucun client en attente de rappel' : 'Aucun projet pour le moment'}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left text-[13px]">
                <caption className="sr-only">{vueProjets === 'rappels' ? 'Clients à rappeler' : 'Les cinq derniers projets créés'}</caption>
                <thead><tr className="bg-muted/40 text-xs text-muted-foreground"><th scope="col" className="w-1/2 px-5 py-3 font-normal sm:w-[32%] sm:px-6">Client</th><th scope="col" className="hidden px-3 py-3 font-normal sm:table-cell">Travaux</th><th scope="col" className="px-3 py-3 font-normal">Statut</th><th scope="col" className="hidden px-5 py-3 text-right font-normal lg:table-cell">Créé le</th></tr></thead>
                <tbody>{projetsAffiches.map((p) => (
                  <tr key={p.id} className="border-t border-border transition-colors hover:bg-muted/40">
                    <th scope="row" className="max-w-48 px-5 py-3 text-left font-normal sm:px-6"><Link to={`/projets/${p.id}`} className="block min-w-0 hover:text-primary"><span className="block truncate font-medium">{p.client_nom}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{vueProjets === 'rappels' ? formatTel(p.client_telephone) || 'Téléphone non renseigné' : p.client_ville || 'Ville à préciser'}</span></Link></th>
                    <td className="hidden max-w-40 truncate px-3 py-3 text-xs text-muted-foreground sm:table-cell">{p.metiers.join(', ') || 'À préciser'}</td>
                    <td className="px-3 py-3"><StatutBadge statut={p.statut} /></td>
                    <td className="hidden whitespace-nowrap px-5 py-3 text-right text-xs tabular-nums text-muted-foreground lg:table-cell">{formatDate(p.created_at)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {vueProjets === 'rappels' && aRappeler.length > 5 && <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{aRappeler.length - 5} autres clients à retrouver dans les projets</p>}
        </section>

        <section aria-labelledby="artisans-titre" className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-5">
            <h2 id="artisans-titre" className="text-base font-medium">Artisans en tête</h2>
            <p className="mt-1 text-xs text-muted-foreground">CA des chantiers transmis sur la période</p>
          </div>
          {kpiArtisansQuery.isLoading ? <div className="p-5"><Skeleton className="h-56 w-full" /></div> : kpiArtisansQuery.isError ? (
            <div className="p-5"><DashboardFeedback message="Le classement est indisponible" retry={() => void kpiArtisansQuery.refetch()} /></div>
          ) : topArtisans.length === 0 ? <p className="px-5 py-8 text-[13px] leading-relaxed text-muted-foreground">Aucune signature pour les chantiers transmis sur cette période</p> : (
            <ol className="divide-y divide-border">{topArtisans.map((a, i) => (
              <li key={a.artisan_id}><Link to={`/artisans/${a.artisan_id}`} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/50"><span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span><span className="min-w-0 flex-1 truncate text-[13px]">{a.artisan_nom}</span><span className="shrink-0 text-[13px] font-medium tabular-nums">{formatEuros(a.ca_signe)}</span></Link></li>
            ))}</ol>
          )}
        </section>
      </div>

      <div className="space-y-3">
        <DetailsKpi debutPeriode={debutPeriode} />
        {!projetsQuery.isLoading && !projetsQuery.isError && (
            <details className="rounded-xl border border-border bg-card">
              <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Répartition, potentiel et pertes · toutes périodes</summary>
              <div className="grid gap-6 border-t border-border p-5 lg:grid-cols-2">
                <div>
                  <dl className="space-y-3 text-sm">
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Projets enregistrés</dt><dd className="tabular-nums">{projets.length}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Artisans du réseau</dt><dd className="tabular-nums">{artisansQuery.isLoading ? 'Chargement…' : artisansQuery.isError ? 'Indisponible' : artisansQuery.data?.length ?? 0}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Devis en attente de réponse</dt><dd className="tabular-nums">{devisEnAttente.length} · {formatEuros(devisEnAttente.reduce((s, p) => s + (p.montant_devis ?? 0), 0))}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Potentiel estimé des projets en cours</dt><dd className="tabular-nums">{formatEuros(potentiel)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Commission potentielle estimée</dt><dd className="tabular-nums">{formatEuros(commissionPotentielle)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Projets perdus ou abandonnés</dt><dd className="tabular-nums">{perdus.length} · {formatEuros(valeurPerdue)}</dd></div>
                  </dl>
                  <p className="mt-4 text-xs text-muted-foreground">Le potentiel repose sur {estimes.length} projets estimés, au taux de commission de chaque projet (10 % si non renseigné). Estimations internes, sans engagement de chiffre d’affaires ni de commission. Les pertes incluent les projets réattribuables.</p>
                </div>
                <div>
                  <p className="mb-3 text-sm font-medium">Statut actuel des projets</p>
                  {parStatut.length === 0 ? <p className="text-sm text-muted-foreground">Aucun projet à répartir</p> : (
                    <ul className="space-y-2">{parStatut.map(({ statut, count }) => (
                      <li key={statut}><Link to={`/projets?statut=${statut}`} className="flex items-center justify-between gap-3 rounded-md py-1 text-sm hover:text-primary"><span>{STATUTS[statut].label}</span><span className="tabular-nums">{count}</span></Link></li>
                    ))}</ul>
                  )}
                </div>
              </div>
            </details>
        )}

        <details className="rounded-xl border border-border bg-card">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Qualité des demandes · métiers et territoires · tout l’historique</summary>
          <div className="border-t border-border p-4"><QualiteLeads /></div>
        </details>
      </div>
    </div>
  )
}
