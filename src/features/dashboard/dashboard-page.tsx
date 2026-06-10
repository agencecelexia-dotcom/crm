import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSameMonth, parseISO, subMonths, format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { FolderKanban, Users, Euro, Wallet, PhoneCall, Trophy } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { StatutBadge } from '@/components/statut-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUTS, STATUTS_ORDRE } from '@/lib/constants'
import { formatEuros, formatDate } from '@/lib/format'
import { useProjets } from '@/features/projets/hooks/use-projets'
import { useArtisans } from '@/features/artisans/hooks/use-artisans'

// Petite carte KPI réutilisable.
function KpiCard({
  icon: Icon,
  label,
  valeur,
  accent,
}: {
  icon: typeof Euro
  label: string
  valeur: string
  accent?: boolean
}) {
  return (
    <Card className={accent ? 'bg-primary text-primary-foreground' : ''}>
      <CardContent className="px-4 py-4">
        <div className="mb-1 flex items-center gap-1.5 text-xs opacity-80">
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <p className="montant text-2xl font-semibold">{valeur}</p>
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const { data: projets, isLoading } = useProjets()
  const { data: artisans } = useArtisans()
  const [periode, setPeriode] = useState<'mois' | 'total'>('mois')

  // Filtre période sur la date de création du projet.
  const projetsPeriode = useMemo(() => {
    if (!projets) return []
    if (periode === 'total') return projets
    const now = new Date()
    return projets.filter((p) => isSameMonth(parseISO(p.created_at), now))
  }, [projets, periode])

  // Agrégats.
  const stats = useMemo(() => {
    const ca = projetsPeriode.reduce((s, p) => s + (p.montant_devis_signe ?? 0), 0)
    const commission = projetsPeriode.reduce((s, p) => s + (p.commission ?? 0), 0)
    const encaissee = projetsPeriode
      .filter((p) => p.commission_encaissee)
      .reduce((s, p) => s + (p.commission ?? 0), 0)

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
      aEncaisser: commission - encaissee,
      parStatut,
    }
  }, [projetsPeriode])

  const derniers = (projets ?? []).slice(0, 5)

  // Leads à traiter (à rappeler / en attente) — actionnable, indépendant de la période.
  const aFaire = useMemo(
    () => (projets ?? []).filter((p) => p.statut === 'a_rappeler' || p.statut === 'en_attente'),
    [projets],
  )

  // CA + commissions par mois (6 derniers mois, basé sur la date de signature).
  const moisData = useMemo(() => {
    const now = new Date()
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const d = subMonths(now, 5 - i)
      return { key: format(d, 'yyyy-MM'), label: format(d, 'MMM', { locale: fr }), ca: 0, commission: 0 }
    })
    const idx = new Map(buckets.map((b, i) => [b.key, i]))
    for (const p of projets ?? []) {
      if (!p.date_signature) continue
      const i = idx.get(p.date_signature.slice(0, 7))
      if (i != null) {
        buckets[i].ca += p.montant_devis_signe ?? 0
        buckets[i].commission += p.commission ?? 0
      }
    }
    return buckets
  }, [projets])

  // Top artisans par commission rapportée (sur la période).
  const topArtisans = useMemo(() => {
    const m = new Map<string, { name: string; total: number }>()
    for (const p of projetsPeriode) {
      if (!p.artisan_id || !p.commission) continue
      const name = p.artisan
        ? p.artisan.societe || `${p.artisan.prenom ?? ''} ${p.artisan.nom}`.trim()
        : 'Inconnu'
      const cur = m.get(p.artisan_id) ?? { name, total: 0 }
      cur.total += p.commission ?? 0
      m.set(p.artisan_id, cur)
    }
    return [...m.values()].sort((a, b) => b.total - a.total).slice(0, 5)
  }, [projetsPeriode])

  // Entonnoir de conversion (sur la période).
  const funnel = useMemo(() => {
    const leads = projetsPeriode.filter((p) => p.statut !== 'perdu').length
    const assignes = projetsPeriode.filter((p) =>
      ['artisan_assigne', 'devis_envoye', 'devis_signe'].includes(p.statut),
    ).length
    const devis = projetsPeriode.filter((p) =>
      ['devis_envoye', 'devis_signe'].includes(p.statut),
    ).length
    const signes = projetsPeriode.filter((p) => p.statut === 'devis_signe').length
    return { leads, assignes, devis, signes }
  }, [projetsPeriode])

  // Potentiel du pipeline (estimation INTERNE, jamais visible des artisans) :
  // somme des estimations des projets encore en cours.
  const pipeline = useMemo(() => {
    const actifs = (projets ?? []).filter(
      (p) => !['perdu', 'termine', 'devis_signe'].includes(p.statut),
    )
    const total = actifs.reduce((s, p) => s + (p.estimation_interne ?? 0), 0)
    const nb = actifs.filter((p) => p.estimation_interne != null).length
    return { total, commission: Math.round(total * 0.1), nb }
  }, [projets])

  return (
    <div>
      <PageHeader titre="Tableau de bord" />

      {/* Filtre période */}
      <Tabs
        value={periode}
        onValueChange={(v) => setPeriode(v as 'mois' | 'total')}
        className="mb-4"
      >
        <TabsList className="w-full">
          <TabsTrigger value="mois" className="flex-1">
            Ce mois
          </TabsTrigger>
          <TabsTrigger value="total" className="flex-1">
            Total
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3">
            <KpiCard
              icon={FolderKanban}
              label="Projets"
              valeur={String(stats.nbProjets)}
            />
            <KpiCard
              icon={Users}
              label="Artisans"
              valeur={String(artisans?.length ?? 0)}
            />
            <KpiCard icon={Euro} label="CA généré" valeur={formatEuros(stats.ca)} />
            <KpiCard
              icon={Wallet}
              label="Commission"
              valeur={formatEuros(stats.commission)}
              accent
            />
          </div>

          {/* Potentiel du pipeline (estimation interne — non visible des artisans) */}
          <Card className="mt-3 border-primary/30 bg-primary/5">
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

          {/* Commission encaissée vs à encaisser */}
          <Card className="mt-3">
            <CardContent className="grid grid-cols-2 gap-3 py-4">
              <div>
                <p className="text-sm text-muted-foreground">Encaissée</p>
                <p className="montant text-lg font-semibold text-[#22C55E]">
                  {formatEuros(stats.encaissee)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">À encaisser</p>
                <p className="montant text-lg font-semibold text-[#F59E0B]">
                  {formatEuros(stats.aEncaisser)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Widgets analytiques (2 colonnes sur ordinateur) */}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {/* À faire : à rappeler / en attente */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PhoneCall className="size-4" />
                  À faire ({aFaire.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {aFaire.length === 0 ? (
                  <p className="py-1 text-sm text-muted-foreground">Rien à rappeler 🎉</p>
                ) : (
                  aFaire.slice(0, 6).map((p) => (
                    <Link
                      key={p.id}
                      to={`/projets/${p.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
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

            {/* Entonnoir de conversion */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Conversion</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {[
                  { label: 'Leads', n: funnel.leads, color: '#64748B' },
                  { label: 'Assignés', n: funnel.assignes, color: '#3B82F6' },
                  { label: 'Devis envoyés', n: funnel.devis, color: '#F59E0B' },
                  { label: 'Devis signés', n: funnel.signes, color: '#22C55E' },
                ].map((row) => (
                  <div key={row.label}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span>{row.label}</span>
                      <span className="text-muted-foreground">{row.n}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${funnel.leads ? Math.max(4, (row.n / funnel.leads) * 100) : 0}%`,
                          background: row.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted-foreground">
                  Taux de conversion (leads → signés) :{' '}
                  <strong className="text-foreground">
                    {funnel.leads ? Math.round((funnel.signes / funnel.leads) * 100) : 0}%
                  </strong>
                </p>
              </CardContent>
            </Card>

            {/* Répartition par statut */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Répartition par statut</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={stats.parStatut} margin={{ left: -20 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10 }}
                      interval={0}
                      angle={-15}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip cursor={{ fill: 'transparent' }} />
                    <Bar dataKey="count" name="Projets" radius={[4, 4, 0, 0]}>
                      {stats.parStatut.map((s) => (
                        <Cell key={s.statut} fill={s.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top artisans */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trophy className="size-4" />
                  Top artisans
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {topArtisans.length === 0 ? (
                  <p className="py-1 text-sm text-muted-foreground">
                    Aucune commission sur la période.
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
          <Card className="mt-3">
            <CardHeader>
              <CardTitle className="text-base">CA & commissions (6 mois)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={moisData} margin={{ left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={44}
                    tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : `${v}`)}
                  />
                  <Tooltip formatter={(value) => formatEuros(Number(value))} />
                  <Line type="monotone" dataKey="ca" name="CA" stroke="#7C3AED" strokeWidth={2} dot={false} />
                  <Line
                    type="monotone"
                    dataKey="commission"
                    name="Commission"
                    stroke="#22C55E"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Derniers projets */}
          <Card className="mt-3">
            <CardHeader>
              <CardTitle className="text-base">Derniers projets</CardTitle>
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
                    className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
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
