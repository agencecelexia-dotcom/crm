import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, Eye, Wrench } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { StatutBadge } from '@/components/statut-badge'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'
import type { StatutProjet } from '@/types/database'

interface VueCommercial {
  ok: boolean
  error?: string
  membre: { nom: string; email: string; actif: boolean; taux: number; depuis: string | null }
  chantiers: {
    projet_id: string
    client_nom: string
    client_ville: string | null
    metiers: string[]
    statut: StatutProjet
    montant_devis: number | null
    commission: number | null
    commission_encaissee: boolean
    artisan_actuel: string | null
    repris_depuis: number
    sa_part: number
  }[]
  stats: {
    en_cours: number
    replaces: number
    sans_suite: number
    ca_replace: number
    plus_ancien_j: number
  }
  gains: { a_verser: number; verse: number }
}

const SEUIL_ALERTE_JOURS = 21

/**
 * Le CRM d'un commercial, vu par un fondateur.
 *
 * Volontairement en LECTURE SEULE plutôt qu'une connexion à sa place : agir
 * dans sa session attribuerait les actions au commercial et rendrait
 * l'historique ininterprétable. Pour intervenir sur un chantier, le fondateur
 * l'ouvre depuis sa propre session — il y a déjà tous les droits.
 */
export function VueCommercialPage() {
  const { id } = useParams<{ id: string }>()

  const { data, isLoading } = useQuery({
    queryKey: ['vue-commercial', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<VueCommercial> => {
      const { data, error } = await supabase.rpc('vue_commercial', { p_membre_id: id! })
      if (error) throw error
      return data as VueCommercial
    },
  })

  if (isLoading) return <Skeleton className="m-4 h-96 rounded-2xl" />

  if (!data?.ok) {
    return (
      <div className="p-4">
        <PageHeader titre="Commercial" back />
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm">
          {data?.error === 'introuvable' ? 'Ce membre n’existe plus.' : 'Accès refusé.'}
        </Card>
      </div>
    )
  }

  const { membre, chantiers, stats, gains } = data

  return (
    <div>
      <PageHeader
        titre={membre.nom}
        sousTitre={`${membre.email} · ${Math.round(membre.taux * 100)} % de la commission`}
        back
      />

      {/* Dit clairement ce que cet écran est, et ce qu'il n'est pas. */}
      <Card className="mb-4 flex items-start gap-2.5 rounded-2xl border-border/70 bg-muted/40 p-3 shadow-card">
        <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Vous consultez son espace en lecture. Pour intervenir sur un chantier, ouvrez-le
          depuis votre propre session — vous y avez tous les droits.
          {!membre.actif && (
            <strong className="ml-1 text-foreground">Ce compte est désactivé.</strong>
          )}
        </p>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Chiffre label="En cours" valeur={String(stats.en_cours)} />
        <Chiffre label="Replacés" valeur={String(stats.replaces)} />
        <Chiffre label="CA replacé" valeur={formatEuros(stats.ca_replace)} />
        <Chiffre
          label="À lui verser"
          valeur={formatEuros(gains.a_verser)}
          accent={Number(gains.a_verser) > 0}
        />
      </div>

      {stats.plus_ancien_j > SEUIL_ALERTE_JOURS && (
        <Card className="mb-4 flex items-center gap-2 rounded-2xl border-[#F59E0B]/40 bg-[#F59E0B]/5 p-3 text-xs text-[#B45309] shadow-card">
          <AlertTriangle className="size-4 shrink-0" />
          Son plus vieux dossier attend depuis {stats.plus_ancien_j} jours.
        </Card>
      )}

      <h2 className="mb-2 font-display text-lg tracking-tight">Ses chantiers</h2>

      {chantiers.length === 0 ? (
        <EmptyState
          icon={Wrench}
          titre="Aucun chantier repris"
          description="Il n’a encore pris aucun chantier dans la pile à réattribuer."
        />
      ) : (
        <ul className="space-y-3">
          {chantiers.map((c) => (
            <li key={c.projet_id}>
              <Link to={`/projets/${c.projet_id}`} className="block">
                <Card
                  className={cn(
                    'rounded-2xl p-4 shadow-card transition-all hover:shadow-card-hover',
                    c.repris_depuis > SEUIL_ALERTE_JOURS
                      ? 'border-[#F59E0B]/40'
                      : 'border-border/70',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.client_nom}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.metiers.join(', ') || '—'}
                        {c.client_ville && ` · ${c.client_ville}`}
                      </p>
                    </div>
                    <StatutBadge statut={c.statut} />
                  </div>

                  <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                    <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
                    {c.artisan_actuel ? (
                      <span>
                        Replacé chez <strong>{c.artisan_actuel}</strong>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Pas encore replacé</span>
                    )}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
                    <span className="text-muted-foreground">
                      Repris il y a {c.repris_depuis} j
                    </span>
                    {Number(c.sa_part) > 0 && (
                      <span
                        className={cn(
                          'font-medium tabular-nums',
                          c.commission_encaissee ? 'text-[#16A34A]' : 'text-primary',
                        )}
                      >
                        {formatEuros(c.sa_part)}
                        {c.commission_encaissee ? ' acquis' : ' si signé'}
                      </span>
                    )}
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Chiffre({
  label,
  valeur,
  accent,
}: {
  label: string
  valeur: string
  accent?: boolean
}) {
  return (
    <Card className="rounded-2xl border-border/70 p-3.5 shadow-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'font-display text-xl tracking-tight tabular-nums',
          accent && 'text-primary',
        )}
      >
        {valeur}
      </p>
    </Card>
  )
}
