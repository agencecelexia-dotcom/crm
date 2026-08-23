import { Link } from 'react-router-dom'
import {
  ArrowRight, CheckCircle2, Clock, Euro, PhoneCall, RotateCcw, Target, Wallet,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatDate, formatEuros } from '@/lib/format'
import { useMesRetrocessions, useStatsCommercial } from './use-commercial'

/**
 * Page d'accueil d'un commercial.
 *
 * Elle répond à trois questions, dans cet ordre : qu'est-ce que je fais
 * maintenant, où j'en suis, combien j'ai gagné. Les gains arrivent en dernier
 * volontairement — c'est le résultat du travail, pas le point de départ de la
 * journée.
 */
export function DashboardCommercial() {
  const { data, isLoading, isError, refetch } = useStatsCommercial()
  const { data: retros } = useMesRetrocessions()

  if (isLoading) return <Skeleton className="m-4 h-96 rounded-2xl" />
  if (isError || !data) {
    return (
      <div className="p-4">
        <PageHeader titre="Mon espace" />
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">Impossible de charger votre tableau de bord.</p>
          <button onClick={() => void refetch()} className="mt-1 text-xs underline">
            Réessayer
          </button>
        </Card>
      </div>
    )
  }

  const aFaire = data.a_attribuer + data.a_reprendre
  const tauxPct = Math.round(data.taux * 100)

  return (
    <div>
      {/* Le prénom peut manquer le temps que la fiche membre arrive, ou si
          elle n'existe pas : « Bonjour null » serait pire qu'un simple bonjour. */}
      <PageHeader titre={data.nom ? `Bonjour ${data.nom}` : 'Bonjour'} />

      {/* ---- Ce qu'il y a à faire maintenant ---- */}
      {aFaire > 0 ? (
        <Card className="mb-4 rounded-2xl border-[#F59E0B]/30 bg-[#F59E0B]/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#B45309]">
            <Target className="size-4" />
            {aFaire} action{aFaire > 1 ? 's' : ''} vous attend{aFaire > 1 ? 'ent' : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.a_attribuer > 0 && (
              <Button asChild size="sm" variant="outline" className="bg-card">
                <Link to="/projets">
                  <PhoneCall className="size-4" />
                  {data.a_attribuer} lead{data.a_attribuer > 1 ? 's' : ''} à attribuer
                </Link>
              </Button>
            )}
            {data.a_reprendre > 0 && (
              <Button asChild size="sm" className="bg-[#B45309] hover:bg-[#92400E]">
                <Link to="/projets/a-reattribuer">
                  <RotateCcw className="size-4" />
                  {data.a_reprendre} chantier{data.a_reprendre > 1 ? 's' : ''} à reprendre
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            )}
          </div>
          {data.a_reprendre > 0 && (
            <p className="mt-2 text-xs text-[#92400E]">
              Ces chantiers ont été rendus par un artisan et ne sont plus suivis. Les replacer,
              c'est {tauxPct} % de la commission pour vous.
            </p>
          )}
        </Card>
      ) : (
        <Card className="mb-4 rounded-2xl border-[#22C55E]/30 bg-[#22C55E]/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#16A34A]">
            <CheckCircle2 className="size-4" />
            Rien en attente — tous vos leads sont placés.
          </p>
        </Card>
      )}

      {/* ---- Où j'en suis ---- */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tuile label="Leads saisis" valeur={String(data.leads_saisis)}
               detail={data.leads_repris > 0 ? `+ ${data.leads_repris} repris` : 'par vous'} />
        <Tuile label="En cours" valeur={String(data.leads_actifs)} detail="chez un artisan" />
        <Tuile label="Signés" valeur={String(data.signes)}
               detail={data.perdus > 0 ? `${data.perdus} perdus` : ''} ton="bon" />
        <Tuile label="CA généré" valeur={formatEuros(data.ca_genere)}
               detail="chantiers signés" ton="bon" />
      </div>

      {/* ---- Mes gains, en trois états ---- */}
      <h2 className="mb-2 flex items-center gap-2 font-display text-lg tracking-tight">
        <Wallet className="size-4 text-primary" />
        Mes gains
      </h2>

      <div className="mb-2 grid gap-3 sm:grid-cols-3">
        <Gain
          icon={Clock}
          label="En attente"
          valeur={data.gains_potentiels}
          aide="Chantiers signés, commission pas encore encaissée par l'agence"
          ton="attente"
        />
        <Gain
          icon={Euro}
          label="À percevoir"
          valeur={data.gains_a_percevoir}
          aide="L'agence a encaissé — votre versement est dû"
          ton="du"
        />
        <Gain
          icon={CheckCircle2}
          label="Déjà versé"
          valeur={data.gains_verses}
          aide="Montant qui vous a été payé"
          ton="verse"
        />
      </div>

      <p className="mb-5 text-xs text-muted-foreground">
        Vous touchez <strong>{tauxPct} %</strong> de la commission encaissée par l'agence. Un
        gain passe « à percevoir » le jour où le client paie — pas à la signature.
      </p>

      {/* ---- Le détail, pour refaire le calcul ---- */}
      {retros && retros.length > 0 && (
        <Card className="rounded-2xl border-border/70 shadow-card">
          <CardContent className="pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Détail
            </p>
            <div className="space-y-2">
              {retros.map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    'flex flex-wrap items-baseline justify-between gap-2 rounded-xl border p-3 text-sm',
                    r.statut === 'verse'
                      ? 'border-border bg-muted/20'
                      : 'border-[#F59E0B]/30 bg-[#F59E0B]/5',
                  )}
                >
                  <span className="flex items-baseline gap-1.5">
                    <span className="montant tabular-nums">{formatEuros(r.commission_agence)}</span>
                    <span className="text-muted-foreground">
                      × {Math.round(r.taux * 100)} % =
                    </span>
                    <span className="montant font-semibold tabular-nums">
                      {formatEuros(r.montant)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      r.statut === 'verse'
                        ? 'bg-[#22C55E]/15 text-[#16A34A]'
                        : 'bg-[#F59E0B]/15 text-[#B45309]',
                    )}
                  >
                    {r.statut === 'verse'
                      ? `Versé le ${r.verse_at ? formatDate(r.verse_at) : ''}`
                      : 'À percevoir'}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Tuile({
  label,
  valeur,
  detail,
  ton = 'defaut',
}: {
  label: string
  valeur: string
  detail?: string
  ton?: 'defaut' | 'bon'
}) {
  return (
    <Card
      className={cn(
        'rounded-2xl border-border/70 p-4 shadow-card',
        ton === 'bon' && 'border-[#22C55E]/25 bg-[#22C55E]/5',
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="montant mt-1 text-xl font-semibold tabular-nums">{valeur}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </Card>
  )
}

function Gain({
  icon: Icon,
  label,
  valeur,
  aide,
  ton,
}: {
  icon: typeof Euro
  label: string
  valeur: number
  aide: string
  ton: 'attente' | 'du' | 'verse'
}) {
  return (
    <Card
      className={cn(
        'rounded-2xl p-4 shadow-card',
        ton === 'attente' && 'border-border/70',
        ton === 'du' && 'border-[#F59E0B]/30 bg-[#F59E0B]/5',
        ton === 'verse' && 'border-[#22C55E]/25 bg-[#22C55E]/5',
      )}
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </p>
      <p
        className={cn(
          'montant mt-1 text-2xl font-semibold tabular-nums',
          ton === 'du' && 'text-[#B45309]',
          ton === 'verse' && 'text-[#16A34A]',
        )}
      >
        {formatEuros(valeur)}
      </p>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{aide}</p>
    </Card>
  )
}
