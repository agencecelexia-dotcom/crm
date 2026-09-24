import { useCaParMois, useKpiAgence, useKpiParArtisan } from './use-kpi'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSameMonth, parseISO, format, startOfMonth } from 'date-fns'
import { fr } from 'date-fns/locale'
import { FolderKanban, Users, Euro, Wallet, PhoneCall, Trophy, Clock, FileText, XCircle } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { SectionTitre } from '@/components/section-titre'
import { StatutBadge } from '@/components/statut-badge'
import { KpiTile } from '@/components/kpi-tile'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUTS, STATUTS_ORDRE, STATUTS_PERTE } from '@/lib/constants'
import { formatEuros, formatDate } from '@/lib/format'
import { useProjets } from '@/features/projets/hooks/use-projets'
import { useArtisans } from '@/features/artisans/hooks/use-artisans'
import { ActionDuJour } from './action-du-jour'
import { ATraiter } from './a-traiter'

// recharts pèse 361 kB : chargé à la demande, il ne ralentit plus l'ouverture
// du CRM pour ceux qui ne consultent jamais ces graphiques.
const GraphiqueStatuts = lazy(() =>
  import('./graphiques').then((m) => ({ default: m.GraphiqueStatuts })),
)
const GraphiqueCa = lazy(() =>
  import('./graphiques').then((m) => ({ default: m.GraphiqueCa })),
)

/** Réserve la hauteur du graphique pendant son chargement, pour éviter que la
 *  page ne saute au moment où il apparaît. */
function GraphiqueEnAttente({ h }: { h: number }) {
  return <Skeleton className="w-full rounded-xl" style={{ height: h }} />
}
import { PanneauKpi } from './panneau-kpi'
import { QualiteLeads } from './qualite-leads'

export function DashboardPage() {
  const { data: projets, isLoading } = useProjets()
  const { data: artisans } = useArtisans()
  const [periode, setPeriode] = useState<'mois' | 'total'>('mois')

  // L'ARGENT NE SE CALCULE PLUS DANS LE NAVIGATEUR.
  //
  // Ces tuiles additionnaient `projets.montant_devis_signe` sans vérifier
  // qu'une signature existe : un dossier « en attente » saisi à 60 000 € y
  // comptait pour 60 000 € de ventes et 6 000 € de commission. Le même écran
  // affichait ainsi jusqu'à trois valeurs pour un même indicateur (CA signé
  // 78 858 € ici, 138 858 € là). Tout ce qui est argent vient désormais de
  // `kpi_agence()`, qui ne compte que les affectations réellement gagnées —
  // bornée au mois en cours ou à tout l'historique, selon l'onglet.
  const debutPeriode = periode === 'mois' ? format(startOfMonth(new Date()), 'yyyy-MM-dd') : undefined
  const { data: kpi } = useKpiAgence(debutPeriode)
  const { data: kpiArtisans } = useKpiParArtisan(debutPeriode)

  // Filtre période sur la date de création du projet.
  const projetsPeriode = useMemo(() => {
    if (!projets) return []
    if (periode === 'total') return projets
    const now = new Date()
    return projets.filter((p) => isSameMonth(parseISO(p.created_at), now))
  }, [projets, periode])

  // Agrégats.
  const stats = useMemo(() => {
    const ca = kpi?.ca_signe ?? 0
    const commission = kpi?.commission_acquise ?? 0
    const encaissee = kpi?.commission_encaissee ?? 0

    const enAttente = projetsPeriode.filter((p) => p.statut === 'en_attente')
    const devisEnvoyes = projetsPeriode.filter((p) => p.statut === 'devis_envoye')
    const devisEnvoyesMontant = devisEnvoyes.reduce((s, p) => s + (p.montant_devis ?? 0), 0)

    const parStatut = STATUTS_ORDRE.map((s) => ({
      statut: s,
      label: STATUTS[s].label,
      color: STATUTS[s].color,
      count: projetsPeriode.filter((p) => p.statut === s).length,
    }))

    return {
      nbProjets: projetsPeriode.length,
      ca,
      commission,
      encaissee,
      aEncaisser: kpi?.commission_a_encaisser ?? 0,
      enAttenteCount: enAttente.length,
      devisEnvoyesCount: devisEnvoyes.length,
      devisEnvoyesMontant,
      parStatut,
    }
  }, [projetsPeriode, kpi])

  // Pertes, indépendant de la période : « perdu » (lâché par un artisan, le
  // chantier reste réattribuable) + « mort » (client parti ailleurs, agence).
  const perdus = useMemo(() => {
    const items = (projets ?? []).filter((p) => STATUTS_PERTE.includes(p.statut))
    const valeur = items.reduce((s, p) => s + (p.montant_devis ?? p.estimation_interne ?? 0), 0)
    return { count: items.length, valeur }
  }, [projets])

  const derniers = (projets ?? []).slice(0, 5)

  // Leads à traiter (à rappeler / en attente) — actionnable, indépendant de la période.
  const aFaire = useMemo(
    () => (projets ?? []).filter((p) => p.statut === 'a_rappeler' || p.statut === 'en_attente'),
    [projets],
  )

  // CA + commissions par mois de SIGNATURE, sur les 6 derniers mois.
  const { data: parMois } = useCaParMois(6)
  const moisData = (parMois ?? []).map((m) => ({
    key: m.mois,
    label: format(parseISO(`${m.mois}-01`), 'MMM', { locale: fr }),
    ca: Number(m.ca) || 0,
    commission: Number(m.commission) || 0,
  }))

  // Top artisans : chiffre d'affaires RÉELLEMENT signé sur la période. Le
  // classement par commission lisait les projets, dossier fantôme compris.
  const topArtisans = useMemo(
    () =>
      (kpiArtisans ?? [])
        .filter((a) => (a.ca_signe ?? 0) > 0)
        .sort((a, b) => b.ca_signe - a.ca_signe)
        .slice(0, 5)
        .map((a) => ({ name: a.artisan_nom, total: a.ca_signe })),
    [kpiArtisans],
  )

  // Potentiel du pipeline (estimation INTERNE, jamais visible des artisans) :
  // somme des estimations des projets encore en cours.
  const pipeline = useMemo(() => {
    const actifs = (projets ?? []).filter(
      (p) => !['perdu', 'mort', 'termine', 'devis_signe'].includes(p.statut),
    )
    const total = actifs.reduce((s, p) => s + (p.estimation_interne ?? 0), 0)
    const nb = actifs.filter((p) => p.estimation_interne != null).length
    return { total, commission: Math.round(total * 0.1), nb }
  }, [projets])

  // Répartition de la commission encaissée / à encaisser (barre proportionnelle).
  const pctEncaissee = stats.commission > 0 ? Math.round((stats.encaissee / stats.commission) * 100) : 0

  return (
    <div>
      <PageHeader titre="Tableau de bord" />

      {/* Ce qui appelle une action, en tête : le reste de la page est du bilan,
          utile mais qui ne dit pas quoi faire ce matin. */}
      <ATraiter />

      <ActionDuJour />

      {/* Indicateurs, source unique `kpi_agence()` (migration 0103).
          Tout part de `affectations` : c'est le seul niveau qui sait quel
          artisan a signé. L'ancienne vue mélangeait deux sources, d'où deux
          chiffres différents sur le même écran. */}
      <PanneauKpi />


      <QualiteLeads />

      {/* Filtre période */}
      <Tabs
        value={periode}
        onValueChange={(v) => setPeriode(v as 'mois' | 'total')}
        className="mb-4"
      >
        <TabsList className="w-full">
          {/* Les indicateurs rangent par date d'arrivée du LEAD (cohorte) : ce
              que sont devenus les chantiers reçus ce mois-ci. Le graphique, lui,
              range par date de signature. */}
          <TabsTrigger value="mois" className="flex-1">
            Leads du mois
          </TabsTrigger>
          <TabsTrigger value="total" className="flex-1">
            Total
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Vue d'ensemble */}
          <SectionTitre className="mt-8 first:mt-0">Vue d'ensemble</SectionTitre>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile icon={FolderKanban} label="Projets" valeur={String(stats.nbProjets)} />
            <KpiTile icon={Users} label="Artisans" valeur={String(artisans?.length ?? 0)} />
            <KpiTile icon={Euro} label="Ventes" sousLabel="CA généré" valeur={formatEuros(stats.ca)} />
            <KpiTile icon={Wallet} label="Commission totale" valeur={formatEuros(stats.commission)} tone="brand" />
          </div>

          {/* Pipeline & argent en attente */}
          <SectionTitre className="mt-8 first:mt-0">Pipeline &amp; argent en attente</SectionTitre>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile icon={Clock} label="En attente" valeur={String(stats.enAttenteCount)} tone="warning" />
            <KpiTile
              icon={FileText}
              label="Devis envoyés"
              sousLabel="en attente de réponse"
              valeur={String(stats.devisEnvoyesCount)}
              tone="warning"
            />
            <div className="col-span-2">
              <KpiTile
                icon={Euro}
                label="Montant en devis envoyés"
                sousLabel={`sur ${stats.devisEnvoyesCount} devis en attente de signature`}
                valeur={formatEuros(stats.devisEnvoyesMontant)}
                tone="warning"
              />
            </div>
          </div>

          <Card className="mt-3 rounded-2xl border-primary/25 bg-primary/5 shadow-card">
            <CardContent className="py-4">
              <p className="text-sm font-medium">
                Potentiel du pipeline{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  (estimation interne · invisible artisans)
                </span>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">CA potentiel</p>
                  <p className="montant text-xl font-semibold">{formatEuros(pipeline.total)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Commission potentielle</p>
                  <p className="montant text-xl font-semibold text-primary">
                    {formatEuros(pipeline.commission)}
                  </p>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {pipeline.nb} projet(s) en cours estimés
              </p>
            </CardContent>
          </Card>

          {/* Perdu */}
          <SectionTitre className="mt-8 first:mt-0">Perdu</SectionTitre>
          <div className="grid grid-cols-2 gap-3">
            <KpiTile icon={XCircle} label="Projets perdus" valeur={String(perdus.count)} tone="danger" />
            <KpiTile icon={Euro} label="Valeur perdue" valeur={formatEuros(perdus.valeur)} tone="danger" />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Cumul depuis le début : projets perdus par un artisan ou abandonnés par le client. Ils ne
            sont plus supprimés automatiquement.
          </p>

          {/* Commissions */}
          <SectionTitre className="mt-8 first:mt-0">Commissions</SectionTitre>
          <Card className="rounded-2xl border-border/70 shadow-card">
            <CardContent className="space-y-3 py-4">
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-[#22C55E]" style={{ width: `${pctEncaissee}%` }} />
                <div className="h-full bg-[#F59E0B]" style={{ width: `${100 - pctEncaissee}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span className="size-2 rounded-full bg-[#22C55E]" /> Encaissée
                  </p>
                  <p className="montant text-lg font-semibold text-[#16A34A]">
                    {formatEuros(stats.encaissee)}
                  </p>
                </div>
                <div>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <span className="size-2 rounded-full bg-[#F59E0B]" /> À encaisser
                  </p>
                  <p className="montant text-lg font-semibold text-[#B45309]">
                    {formatEuros(stats.aEncaisser)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Analyse & activité */}
          <SectionTitre className="mt-8 first:mt-0">Analyse &amp; activité</SectionTitre>
          <div className="grid gap-3 md:grid-cols-2">
            {/* À faire : à rappeler / en attente */}
            <Card className="rounded-2xl border-border/70 shadow-card">
              <CardHeader>
                <CardTitre>
                  <PhoneCall className="size-4" />
                  À faire ({aFaire.length})
                </CardTitre>
              </CardHeader>
              <CardContent className="space-y-2">
                {aFaire.length === 0 ? (
                  <p className="py-1 text-sm text-muted-foreground">Rien à rappeler 🎉</p>
                ) : (
                  aFaire.slice(0, 6).map((p) => (
                    <Link
                      key={p.id}
                      to={`/projets/${p.id}`}
                      className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 p-3 transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.client_nom}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {p.client_telephone || '—'}
                          {p.client_ville ? ` · ${p.client_ville}` : ''}
                        </p>
                      </div>
                      <StatutBadge statut={p.statut} />
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Répartition par statut */}
            <Card className="rounded-2xl border-border/70 shadow-card">
              <CardHeader>
                <CardTitre>Répartition par statut</CardTitre>
              </CardHeader>
              <CardContent>
                <Suspense fallback={<GraphiqueEnAttente h={200} />}>
                  <GraphiqueStatuts data={stats.parStatut} />
                </Suspense>
              </CardContent>
            </Card>

            {/* Top artisans */}
            <Card className="rounded-2xl border-border/70 shadow-card">
              <CardHeader>
                <CardTitre>
                  <Trophy className="size-4" />
                  Top artisans
                </CardTitre>
              </CardHeader>
              <CardContent className="space-y-2">
                {topArtisans.length === 0 ? (
                  <p className="py-1 text-sm text-muted-foreground">
                    Aucun chantier signé sur la période.
                  </p>
                ) : (
                  topArtisans.map((a, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm">
                        {i + 1}. {a.name}
                      </span>
                      <span className="montant shrink-0 text-sm font-semibold text-primary">
                        {formatEuros(a.total)}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* CA & commissions par mois */}
          <Card className="mt-3 rounded-2xl border-border/70 shadow-card">
            <CardHeader>
              <CardTitre>CA & commissions (6 mois)</CardTitre>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<GraphiqueEnAttente h={220} />}>
                <GraphiqueCa data={moisData} />
              </Suspense>
            </CardContent>
          </Card>

          {/* Derniers projets */}
          <Card className="mt-3 rounded-2xl border-border/70 shadow-card">
            <CardHeader>
              <CardTitre>Derniers projets</CardTitre>
            </CardHeader>
            <CardContent className="space-y-2">
              {derniers.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  Aucun projet pour le moment.
                </p>
              ) : (
                derniers.map((p) => (
                  <Link
                    key={p.id}
                    to={`/projets/${p.id}`}
                    className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 p-3 transition-colors hover:bg-muted/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.client_nom}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.metiers.join(', ')} · {formatDate(p.created_at)}
                      </p>
                    </div>
                    <StatutBadge statut={p.statut} />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
