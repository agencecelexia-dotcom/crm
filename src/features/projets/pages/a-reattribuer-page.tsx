import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileText, HandHelping, RotateCcw, UserX } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatDate, formatEuros } from '@/lib/format'
import { MOTIF_LABEL } from '@/lib/motifs-perte'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth/use-auth'

/**
 * Chantiers rendus ou perdus par un artisan, alors que le projet reste vivant.
 *
 * Ces dossiers n'étaient visibles nulle part côté agence : ils sortaient du
 * pipe de l'artisan et disparaissaient. Or le client n'a pas disparu — c'est
 * l'artisan qui a renoncé. 80 chantiers étaient dans ce cas, dont 55 sans
 * aucun artisan actif.
 *
 * Les plus anciens sont affichés en premier : ce sont ceux que personne ne
 * travaille, donc ceux qui se perdent réellement.
 */
interface AReattribuer {
  projet_id: string
  affectation_id: string
  client_nom: string | null
  client_telephone: string | null
  client_ville: string | null
  client_code_postal: string | null
  metier: string | null
  metiers: string[] | null
  description: string | null
  statut_projet: string
  artisan_nom: string | null
  artisan_id: string | null
  etape: string | null
  montant_devis: number | null
  devis_depose: boolean
  motif_perte: string | null
  sorti_le: string
  nature: 'retrait' | 'perdu' | 'masque'
  derniere_raison: string | null
  artisans_actifs: number
  /** Commercial qui a pris le chantier en charge. Null = disponible. */
  assigne_a: string | null
  assigne_nom: string | null
  /** Jours depuis la sortie du pipe. Au-delà d'un mois, le client a souvent
   *  signé ailleurs — c'est le critère de tri le plus utile. */
  jours_dattente: number | null
}

/**
 * Fraîcheur d'un chantier rendu.
 *
 * Un dossier rendu hier vaut presque un lead neuf ; à trois semaines le client
 * a commencé à chercher ailleurs ; au-delà d'un mois il a souvent signé. Le
 * code couleur rend cette dégradation lisible sans avoir à lire les dates.
 */
function fraicheur(jours: number | null) {
  const j = jours ?? 0
  if (j < 7) return { cle: 'chaud', label: 'Récent', classe: 'border-[#16A34A]/40 bg-[#22C55E]/5',
                      pastille: 'bg-[#22C55E]/15 text-[#16A34A]' }
  if (j < 15) return { cle: 'tiede', label: 'À traiter', classe: 'border-border',
                       pastille: 'bg-muted text-muted-foreground' }
  if (j < 30) return { cle: 'refroidit', label: 'Refroidit', classe: 'border-[#F59E0B]/40 bg-[#F59E0B]/5',
                       pastille: 'bg-[#F59E0B]/15 text-[#B45309]' }
  return { cle: 'froid', label: 'Froid', classe: 'border-[#DC2626]/30 bg-[#DC2626]/5',
           pastille: 'bg-[#DC2626]/15 text-[#DC2626]' }
}

const NATURE_LABEL: Record<AReattribuer['nature'], string> = {
  retrait: "Rendu par l'artisan",
  perdu: 'Perdu par l’artisan',
  masque: 'Retiré du pipe',
}

const ETAPE_LABEL: Record<string, string> = {
  contacte: 'client contacté',
  rdv_pris: 'RDV pris',
  devis_envoye: 'devis envoyé',
  devis_signe: 'devis signé',
  termine: 'terminé',
}

type Filtre = 'libres' | 'tous'

export function AReattribuerPage() {
  const [filtre, setFiltre] = useState<Filtre>('libres')
  const qc = useQueryClient()
  const { session } = useAuth()
  const monUserId = session?.user.id ?? null

  const prendre = useMutation({
    mutationFn: async (projetId: string) => {
      const { data, error } = await supabase.rpc('prendre_chantier', { p_projet_id: projetId })
      const r = data as { ok?: boolean; error?: string; par?: string } | null
      if (error) throw error
      // Le refus n'est pas une panne : quelqu'un a été plus rapide.
      if (!r?.ok) {
        throw new Error(
          r?.error === 'deja_pris'
            ? `${r.par ?? 'Un collègue'} s'en occupe déjà.`
            : 'Prise en charge impossible.',
        )
      }
    },
    onSuccess: () => {
      toast.success('Chantier pris en charge', {
        description: 'Il est désormais dans votre pipe, réservé à vous seul.',
      })
      void qc.invalidateQueries({ queryKey: ['a-reattribuer'] })
      // Sans cette invalidation, le chantier n'apparaîtrait dans « Mon pipe »
      // qu'au prochain rechargement complet.
      void qc.invalidateQueries({ queryKey: ['mon-pipe'] })
      void qc.invalidateQueries({ queryKey: ['projets'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Erreur'),
  })

  const rendre = useMutation({
    mutationFn: async (projetId: string) => {
      const { error } = await supabase.rpc('rendre_chantier', { p_projet_id: projetId })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Chantier rendu à l\'équipe')
      void qc.invalidateQueries({ queryKey: ['a-reattribuer'] })
      void qc.invalidateQueries({ queryKey: ['mon-pipe'] })
      void qc.invalidateQueries({ queryKey: ['projets'] })
    },
    onError: () => toast.error('Impossible de rendre ce chantier'),
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['a-reattribuer'],
    queryFn: async (): Promise<AReattribuer[]> => {
      const { data, error } = await supabase.rpc('chantiers_a_reattribuer')
      if (error) throw error
      return (data ?? []) as AReattribuer[]
    },
  })

  const liste = useMemo(() => {
    const tout = data ?? []
    // Orphelins d'abord : ce sont eux qui se perdent vraiment, personne ne
    // s'en occupe. Puis les plus récemment sortis du pipe.
    // Orphelins d'abord — personne ne s'en occupe. Puis les plus anciens :
    // ce sont eux qui refroidissent, donc ceux qu'il faut traiter en premier.
    // Les plus anciens d'abord : depuis 0111, aucun chantier de cette liste
    // n'a d'artisan actif, le tri sur `artisans_actifs` n'a plus d'objet.
    const tries = [...tout].sort(
      (a, b) => (b.jours_dattente ?? 0) - (a.jours_dattente ?? 0),
    )
    return filtre === 'libres' ? tries.filter((p) => !p.assigne_a) : tries
  }, [data, filtre])

  const libres = (data ?? []).filter((p) => !p.assigne_a).length

  if (isLoading) return <Skeleton className="m-4 h-80 rounded-2xl" />
  if (isError) {
    return (
      <div className="p-4">
        <PageHeader titre="À réattribuer" />
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">Impossible de charger la liste.</p>
          <button onClick={() => void refetch()} className="mt-1 text-xs underline">
            Réessayer
          </button>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader titre="À réattribuer" />

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            { cle: 'libres' as const, label: 'Non pris en charge', n: libres },
            { cle: 'tous' as const, label: 'Tous', n: (data ?? []).length },
          ] satisfies { cle: Filtre; label: string; n: number }[]
        ).map((f) => (
          <button
            key={f.cle}
            type="button"
            onClick={() => setFiltre(f.cle)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
              filtre === f.cle
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums opacity-70">{f.n}</span>
          </button>
        ))}
      </div>

      {liste.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          titre="Rien à réattribuer"
          description="Les chantiers rendus ou perdus par un artisan, dont le client reste joignable, apparaîtront ici."
        />
      ) : (
        <div className="space-y-3">
          {liste.map((p) => (
            <Card
              key={p.affectation_id}
              className={cn(
                'rounded-2xl p-4 shadow-card transition-shadow hover:shadow-card-hover',
                fraicheur(p.jours_dattente).classe,
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base tracking-tight">
                    {p.client_nom ?? 'Client non renseigné'}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {(p.metiers?.length ? p.metiers : [p.metier]).filter(Boolean).join(', ')}
                    {p.client_ville && ` · ${p.client_ville}`}
                    {p.client_code_postal && ` ${p.client_code_postal}`}
                  </p>

                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 font-semibold',
                        fraicheur(p.jours_dattente).pastille,
                      )}
                    >
                      {fraicheur(p.jours_dattente).label}
                      {p.jours_dattente != null && ` · ${p.jours_dattente} j`}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                      {NATURE_LABEL[p.nature]}
                    </span>
                    {p.assigne_nom && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        Pris par {p.assigne_nom}
                      </span>
                    )}
                    {p.artisan_nom && (
                      <span className="text-muted-foreground">par {p.artisan_nom}</span>
                    )}
                    <span className="text-muted-foreground">le {formatDate(p.sorti_le)}</span>
                    {p.motif_perte && (
                      <span className="rounded-full bg-[#DC2626]/10 px-2 py-0.5 text-[#DC2626]">
                        {MOTIF_LABEL[p.motif_perte] ?? p.motif_perte}
                      </span>
                    )}
                  </p>

                  {/* Ce qui aide à décider : jusqu'où c'est allé et si un
                      devis existe déjà. Un dossier chiffré se réattribue
                      autrement qu'un lead jamais travaillé. */}
                  {(p.etape || p.devis_depose || p.montant_devis) && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {p.etape && <span>Allé jusqu'à : {ETAPE_LABEL[p.etape] ?? p.etape}</span>}
                      {p.montant_devis != null && p.montant_devis > 0 && (
                        <span className="montant">chiffré {formatEuros(p.montant_devis)}</span>
                      )}
                      {p.devis_depose && (
                        <span className="flex items-center gap-1 text-[#16A34A]">
                          <FileText className="size-3" /> devis déposé
                        </span>
                      )}
                    </p>
                  )}

                  {p.derniere_raison && (
                    <p className="mt-1.5 rounded-lg bg-muted/50 p-2 text-xs italic text-muted-foreground">
                      « {p.derniere_raison} »
                    </p>
                  )}

                  {p.artisans_actifs === 0 && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-[#B45309]">
                      <UserX className="size-3.5" />
                      Aucun artisan ne travaille ce chantier
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  {/* Prendre en charge évite que deux personnes rappellent le
                      même client — et que le client entende deux fois la même
                      agence. */}
                  {p.assigne_a === monUserId ? (
                    <Button size="sm" variant="outline"
                            onClick={() => rendre.mutate(p.projet_id)}
                            disabled={rendre.isPending}>
                      <HandHelping className="size-4" />
                      Rendre à l'équipe
                    </Button>
                  ) : !p.assigne_a ? (
                    <Button size="sm"
                            onClick={() => prendre.mutate(p.projet_id)}
                            disabled={prendre.isPending}>
                      <HandHelping className="size-4" />
                      Je m'en occupe
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/projets/${p.projet_id}`}>
                      <AlertTriangle className="size-4" />
                      Ouvrir la fiche
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
