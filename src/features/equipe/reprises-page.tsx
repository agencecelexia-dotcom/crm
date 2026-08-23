import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, RotateCcw, Users } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'

interface Reprise {
  membre_id: string
  nom: string
  email: string
  actif: boolean
  taux_retrocession: number
  en_cours: number
  signes: number
  perdus: number
  ca_signe: number
  deja_verse: number
  a_verser: number
  jours_plus_ancien: number | null
}

/** Au-delà, un chantier repris est en train d'être perdu une seconde fois. */
const SEUIL_ALERTE_JOURS = 21

/**
 * Suivi des chantiers repris, par commercial.
 *
 * Réservé aux fondateurs : c'est l'écran qui dit si la reprise fonctionne. Un
 * commercial peut afficher de beaux chiffres cumulés tout en laissant dormir
 * des dossiers — d'où la colonne d'ancienneté, qui est souvent l'information la
 * plus utile de la page.
 */
export function ReprisesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['reprises-commerciaux'],
    queryFn: async (): Promise<Reprise[]> => {
      const { data, error } = await supabase.rpc('reprises_par_commercial')
      if (error) throw error
      return (data ?? []) as Reprise[]
    },
  })

  if (isLoading) return <Skeleton className="m-4 h-80 rounded-2xl" />

  const lignes = data ?? []
  const totalEnCours = lignes.reduce((s, l) => s + l.en_cours, 0)
  const totalSignes = lignes.reduce((s, l) => s + l.signes, 0)
  const totalDu = lignes.reduce((s, l) => s + Number(l.a_verser), 0)

  return (
    <div>
      <PageHeader
        titre="Reprises"
        sousTitre="Les chantiers perdus par un artisan, repris par vos commerciaux"
      />

      {lignes.length === 0 ? (
        <EmptyState
          icon={Users}
          titre="Aucun commercial"
          description="Invitez un commercial depuis la page Équipe. Les chantiers qu'il reprendra apparaîtront ici."
        />
      ) : (
        <>
          {/* Vue d'ensemble : ce que la reprise produit, tous commerciaux
              confondus. Le montant dû est mis en avant — c'est un engagement. */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Card className="rounded-2xl border-border/70 p-3.5 shadow-card">
              <p className="text-xs text-muted-foreground">En cours</p>
              <p className="font-display text-2xl tracking-tight tabular-nums">{totalEnCours}</p>
            </Card>
            <Card className="rounded-2xl border-border/70 p-3.5 shadow-card">
              <p className="text-xs text-muted-foreground">Replacés</p>
              <p className="font-display text-2xl tracking-tight tabular-nums">{totalSignes}</p>
            </Card>
            <Card className="rounded-2xl border-border/70 p-3.5 shadow-card">
              <p className="text-xs text-muted-foreground">À verser</p>
              <p className="font-display text-2xl tracking-tight tabular-nums">
                {formatEuros(totalDu)}
              </p>
            </Card>
          </div>

          <div className="space-y-3">
            {lignes.map((l) => {
              const dormant =
                l.jours_plus_ancien !== null && l.jours_plus_ancien > SEUIL_ALERTE_JOURS

              return (
                <Card
                  key={l.membre_id}
                  className={cn(
                    'rounded-2xl p-4 shadow-card',
                    l.actif ? 'border-border/70' : 'border-border bg-muted/30 opacity-70',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-base tracking-tight">
                        {l.nom}
                        {!l.actif && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            désactivé
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">{l.email}</p>
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      Part : {Math.round(l.taux_retrocession * 100)} %
                    </p>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 sm:grid-cols-4">
                    <Chiffre label="En cours" valeur={String(l.en_cours)} />
                    <Chiffre label="Replacés" valeur={String(l.signes)} />
                    <Chiffre label="Sans suite" valeur={String(l.perdus)} />
                    <Chiffre label="CA replacé" valeur={formatEuros(l.ca_signe)} />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="text-muted-foreground">
                      Déjà versé : <strong>{formatEuros(l.deja_verse)}</strong>
                    </span>
                    <span className={cn(Number(l.a_verser) > 0 && 'font-medium text-primary')}>
                      À verser : <strong>{formatEuros(l.a_verser)}</strong>
                    </span>
                  </div>

                  {/* Un dossier repris puis oublié est pire qu'un dossier non
                      repris : le client attend, et personne d'autre ne peut le
                      prendre puisqu'il est déjà assigné. */}
                  {dormant && (
                    <p className="mt-2 flex items-center gap-1.5 rounded-md bg-[#F59E0B]/10 px-2.5 py-1.5 text-xs text-[#B45309]">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      Un chantier attend depuis {l.jours_plus_ancien} jours.
                    </p>
                  )}
                </Card>
              )
            })}
          </div>

          <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
            <RotateCcw className="mt-0.5 size-3.5 shrink-0" />
            Un chantier repris est réservé à son commercial : les autres le voient assigné et ne
            peuvent pas s'en saisir. La commission n'est due qu'à l'encaissement.
          </p>
        </>
      )}
    </div>
  )
}

function Chiffre({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{valeur}</p>
    </div>
  )
}
