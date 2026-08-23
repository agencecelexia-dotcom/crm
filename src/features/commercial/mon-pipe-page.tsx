import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, RotateCcw, Wrench } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { StatutBadge } from '@/components/statut-badge'
import { cn } from '@/lib/utils'
import { formatEuros, formatTel } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'
import type { StatutProjet } from '@/types/database'

interface MonChantier {
  projet_id: string
  client_nom: string
  client_telephone: string | null
  client_ville: string | null
  client_code_postal: string | null
  metiers: string[]
  description: string | null
  statut: StatutProjet
  montant_devis: number | null
  commission: number | null
  commission_encaissee: boolean
  artisan_actuel: string | null
  repris_depuis: number
  ma_part: number
}

/** Au-delà, le client a souvent renoncé — et personne d'autre ne peut reprendre
 *  le dossier puisqu'il est déjà attribué. */
const SEUIL_ALERTE_JOURS = 21

/**
 * Les chantiers que ce commercial a repris.
 *
 * Périmètre strictement exclusif : aucun autre commercial ne voit ces dossiers
 * (migration 0116). C'est ce qui évite que deux personnes rappellent le même
 * client et se disputent la même commission.
 *
 * C'est aussi le seul endroit où il gagne de l'argent : le pipe commun sert à
 * suivre l'activité et à saisir des leads, pas à toucher une commission.
 */
export function MonPipePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['mon-pipe'],
    queryFn: async (): Promise<MonChantier[]> => {
      const { data, error } = await supabase.rpc('mon_pipe')
      if (error) throw error
      return (data ?? []) as MonChantier[]
    },
  })

  if (isLoading) return <Skeleton className="m-4 h-80 rounded-2xl" />

  const chantiers = data ?? []
  const aVenir = chantiers.reduce(
    (s, c) => s + (c.commission_encaissee ? 0 : Number(c.ma_part)),
    0,
  )
  const acquis = chantiers.reduce(
    (s, c) => s + (c.commission_encaissee ? Number(c.ma_part) : 0),
    0,
  )

  return (
    <div>
      <PageHeader
        titre="Mon pipe"
        sousTitre="Les chantiers que vous avez repris — vous êtes seul dessus"
      />

      {chantiers.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          titre="Aucun chantier repris"
          description="Ouvrez « À réattribuer » et prenez un chantier : il vous sera réservé et apparaîtra ici."
          action={
            <Link
              to="/projets/a-reattribuer"
              className="text-sm font-medium text-primary underline"
            >
              Voir les chantiers à reprendre
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Card className="rounded-2xl border-border/70 p-3.5 shadow-card">
              <p className="text-xs text-muted-foreground">En cours</p>
              <p className="font-display text-2xl tracking-tight tabular-nums">
                {chantiers.length}
              </p>
            </Card>
            <Card className="rounded-2xl border-border/70 p-3.5 shadow-card">
              <p className="text-xs text-muted-foreground">À percevoir</p>
              <p className="font-display text-2xl tracking-tight tabular-nums">
                {formatEuros(aVenir)}
              </p>
            </Card>
            <Card className="rounded-2xl border-border/70 p-3.5 shadow-card">
              <p className="text-xs text-muted-foreground">Acquis</p>
              <p className="font-display text-2xl tracking-tight tabular-nums text-[#16A34A]">
                {formatEuros(acquis)}
              </p>
            </Card>
          </div>

          <ul className="space-y-3">
            {chantiers.map((c) => {
              const dormant = c.repris_depuis > SEUIL_ALERTE_JOURS
              return (
                <li key={c.projet_id}>
                  <Link to={`/projets/${c.projet_id}`} className="block">
                    <Card
                      className={cn(
                        'rounded-2xl p-4 shadow-card transition-all',
                        'hover:shadow-card-hover active:scale-[0.99]',
                        dormant ? 'border-[#F59E0B]/40' : 'border-border/70',
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

                      {c.client_telephone && (
                        <p className="mt-1.5 text-sm font-medium text-primary">
                          {formatTel(c.client_telephone)}
                        </p>
                      )}

                      {/* Replacé ou non : c'est l'étape qui décide de la suite. */}
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
                        {c.artisan_actuel ? (
                          <span>
                            Replacé chez <strong>{c.artisan_actuel}</strong>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            Pas encore replacé chez un artisan
                          </span>
                        )}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
                        <span className="text-muted-foreground">
                          Repris il y a {c.repris_depuis} j
                        </span>
                        {Number(c.ma_part) > 0 && (
                          <span
                            className={cn(
                              'font-medium tabular-nums',
                              c.commission_encaissee ? 'text-[#16A34A]' : 'text-primary',
                            )}
                          >
                            {formatEuros(c.ma_part)}
                            {c.commission_encaissee ? ' acquis' : ' si signé'}
                          </span>
                        )}
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </div>

                      {dormant && (
                        <p className="mt-2 flex items-center gap-1.5 rounded-md bg-[#F59E0B]/10 px-2.5 py-1.5 text-xs text-[#B45309]">
                          <AlertTriangle className="size-3.5 shrink-0" />
                          Sans mouvement depuis {c.repris_depuis} jours.
                        </p>
                      )}
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>

          <p className="mt-4 text-xs text-muted-foreground">
            Ces chantiers vous sont réservés : aucun autre commercial ne les voit. Votre part
            est versée une fois la commission encaissée par l’agence.
          </p>
        </>
      )}
    </div>
  )
}
