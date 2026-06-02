import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { isSameMonth, parseISO } from 'date-fns'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { FolderKanban, Users, Euro, Wallet } from 'lucide-react'

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
      <CardContent className="py-4">
        <div className="mb-1 flex items-center gap-1.5 text-sm opacity-80">
          <Icon className="size-4" />
          {label}
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

          {/* Répartition par statut */}
          <Card className="mt-3">
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
                        {p.metier} · {formatDate(p.created_at)}
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
