import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, FileText, HandHelping, PhoneCall, PhoneMissed, RotateCcw,
  Search, Trash2, UserX,
} from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  APPELS_MAX, MONTANT_ON_INSISTE, PastillesAppels, type ResultatAppel,
} from '../components/pastilles-appels'

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
  /** Tentatives d'appel, dans l'ordre. Cinq échecs disent d'arrêter d'insister. */
  appels: ResultatAppel[]
  nb_appels: number
  nb_sans_reponse: number
  dernier_appel: string | null
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

type Filtre = 'libres' | 'tous' | 'jamais_appeles' | 'sans_reponse' | 'epuises'
type Tri = 'anciennete' | 'montant' | 'appels'

/** Rend une chaîne comparable : sans accent, sans casse, sans ponctuation. */
function normaliser(v: string) {
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function AReattribuerPage() {
  const [filtre, setFiltre] = useState<Filtre>('libres')
  const [tri, setTri] = useState<Tri>('anciennete')
  const [recherche, setRecherche] = useState('')
  const qc = useQueryClient()
  const { session, estFondateur } = useAuth()
  const monUserId = session?.user.id ?? null

  // Journaliser un appel. Le décompte des tentatives sert à décider quand
  // cesser d'insister — encore faut-il qu'il soit tenu.
  const logAppel = useMutation({
    mutationFn: async ({ projetId, resultat }: { projetId: string; resultat: ResultatAppel }) => {
      const { data, error } = await supabase.rpc('log_appel', {
        p_projet_id: projetId,
        p_resultat: resultat,
      })
      if (error) throw error
      const r = data as { ok?: boolean; error?: string } | null
      if (!r?.ok) throw new Error(r?.error ?? 'echec')
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['a-reattribuer'] })
      void qc.invalidateQueries({ queryKey: ['projets'] })
    },
    onError: (e) =>
      toast.error('Appel non enregistré', {
        description: e instanceof Error ? e.message : undefined,
      }),
  })

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

  // Nettoyer la pile : un client injoignable depuis des mois ou un dossier
  // traité hors CRM n'a rien à y faire — il noie ceux qui méritent un appel.
  const retirer = useMutation({
    mutationFn: async ({ projetId, motif }: { projetId: string; motif: string }) => {
      const { data, error } = await supabase.rpc('retirer_de_la_pile', {
        p_projet_id: projetId,
        p_motif: motif,
      })
      if (error) throw error
      const r = data as { ok?: boolean; error?: string } | null
      if (!r?.ok) {
        const messages: Record<string, string> = {
          reserve_fondateur: 'Seul un fondateur peut retirer un chantier de la pile.',
          chantier_signe: 'Ce chantier est signé : passez par la fiche pour le clore.',
          introuvable: 'Ce chantier n’existe plus.',
        }
        throw new Error(messages[r?.error ?? ''] ?? 'Retrait impossible.')
      }
    },
    onSuccess: () => {
      toast.success('Chantier retiré de la pile', {
        description: 'Rien n’est supprimé : il reste consultable et peut être remis en jeu.',
      })
      void qc.invalidateQueries({ queryKey: ['a-reattribuer'] })
      void qc.invalidateQueries({ queryKey: ['projets'] })
    },
    onError: (e) =>
      toast.error('Retrait impossible', {
        description: e instanceof Error ? e.message : undefined,
      }),
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
    let tout = data ?? []

    // Recherche : un seul champ qui cherche partout. Devoir choisir « nom » ou
    // « téléphone » avant de taper fait perdre plus de temps que ça n'en gagne.
    // Les chiffres saisis sont comparés au numéro dépouillé de son formatage —
    // « 0612 » doit trouver « 06 12 34 56 78 ».
    const q = normaliser(recherche)
    if (q) {
      const chiffres = q.replace(/\D/g, '')
      tout = tout.filter((p) => {
        const tel = (p.client_telephone ?? '').replace(/\D/g, '')
        if (chiffres.length >= 2 && tel.includes(chiffres)) return true
        return [
          p.client_nom, p.client_ville, p.client_code_postal,
          p.metiers?.join(' '), p.metier, p.artisan_nom, p.assigne_nom,
        ]
          .filter(Boolean)
          .some((v) => normaliser(v as string).includes(q))
      })
    }

    const filtres = tout.filter((p) => {
      switch (filtre) {
        case 'libres':         return !p.assigne_a
        // Jamais tenté : le gisement le plus rentable, personne ne les a
        // encore appelés.
        case 'jamais_appeles': return p.nb_appels === 0
        // Tenté, jamais joint : à relancer, mais pas encore épuisé.
        case 'sans_reponse':   return p.nb_appels > 0 && !p.appels.includes('repondu')
        // Cinq échecs : continuer d'appeler ne sert plus à rien.
        case 'epuises':        return p.nb_sans_reponse >= APPELS_MAX
        default:               return true
      }
    })

    const parAnciennete = (a: AReattribuer, b: AReattribuer) =>
      (b.jours_dattente ?? 0) - (a.jours_dattente ?? 0)

    return [...filtres].sort((a, b) => {
      switch (tri) {
        // Les plus gros devis d'abord : à effort d'appel égal, ce sont eux qui
        // rapportent le plus. Un chantier sans montant passe en dernier.
        case 'montant':
          return (b.montant_devis ?? -1) - (a.montant_devis ?? -1) || parAnciennete(a, b)
        // Les moins appelés d'abord : évite de s'acharner sur les mêmes.
        case 'appels':
          return a.nb_appels - b.nb_appels || parAnciennete(a, b)
        default:
          return parAnciennete(a, b)
      }
    })
  }, [data, filtre, tri, recherche])

  const libres = (data ?? []).filter((p) => !p.assigne_a).length
  const jamaisAppeles = (data ?? []).filter((p) => p.nb_appels === 0).length
  const sansReponse = (data ?? []).filter(
    (p) => p.nb_appels > 0 && !p.appels.includes('repondu'),
  ).length
  const epuises = (data ?? []).filter((p) => p.nb_sans_reponse >= APPELS_MAX).length

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

      {/* Recherche et tri. Un seul champ cherche partout : nom, téléphone,
          ville, code postal, métier, artisan. */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            placeholder="Rechercher (nom, téléphone, ville, métier…)"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <Select value={tri} onValueChange={(v) => setTri(v as Tri)}>
          <SelectTrigger className="h-11 sm:w-56">
            <SelectValue placeholder="Trier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anciennete">Les plus anciens d'abord</SelectItem>
            <SelectItem value="montant">Devis le plus élevé</SelectItem>
            <SelectItem value="appels">Les moins appelés d'abord</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            { cle: 'libres' as const, label: 'Non pris en charge', n: libres },
            { cle: 'jamais_appeles' as const, label: 'Jamais appelés', n: jamaisAppeles },
            { cle: 'sans_reponse' as const, label: 'Jamais joints', n: sansReponse },
            { cle: 'epuises' as const, label: `${APPELS_MAX} échecs et plus`, n: epuises },
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
          {liste.map((p) => {
            // Cinq sonneries dans le vide : le dossier encombre la pile. Sauf
            // si le devis est important — à 10-15 % de commission, un gros
            // chantier vaut largement un sixième appel. Pousser à l'abandon
            // ferait perdre bien plus que le temps gagné.
            const epuise =
              p.nb_sans_reponse >= APPELS_MAX &&
              !p.appels.includes('repondu') &&
              (p.montant_devis ?? 0) < MONTANT_ON_INSISTE
            const insister =
              p.nb_sans_reponse >= APPELS_MAX &&
              !p.appels.includes('repondu') &&
              (p.montant_devis ?? 0) >= MONTANT_ON_INSISTE

            return (
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
                    {/* Les tentatives d'appel, juste après le nom : c'est là
                        qu'on décide s'il faut rappeler ce client ou passer au
                        suivant. */}
                    <PastillesAppels appels={p.appels} className="ml-2 align-middle" />
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
                  {/* Journal d'appel, à portée immédiate : noter la tentative
                      juste après avoir raccroché est la seule façon que le
                      décompte reste juste. */}
                  {p.client_telephone && (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-[#B91C1C] hover:bg-[#EF4444]/10"
                        title="Personne n'a décroché"
                        disabled={logAppel.isPending}
                        onClick={() =>
                          logAppel.mutate({
                            projetId: p.projet_id,
                            resultat: 'pas_de_reponse',
                          })
                        }
                      >
                        <PhoneMissed className="size-4" />
                        Sans réponse
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-[#15803D] hover:bg-[#16A34A]/10"
                        title="Le client a répondu"
                        disabled={logAppel.isPending}
                        onClick={() =>
                          logAppel.mutate({ projetId: p.projet_id, resultat: 'repondu' })
                        }
                      >
                        <PhoneCall className="size-4" />
                        Joint
                      </Button>
                    </div>
                  )}

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
                  {/* Nettoyage de la pile, réservé à l'agence : décider qu'un
                      chantier n'a plus d'avenir engage le chiffre d'affaires. */}
                  {estFondateur && (
                    <Button
                      size={epuise ? 'default' : 'sm'}
                      variant={epuise ? 'destructive' : 'ghost'}
                      className={cn(
                        !epuise && 'text-muted-foreground hover:text-destructive',
                      )}
                      disabled={retirer.isPending}
                      onClick={() => {
                        const motif = window.prompt(
                          `Retirer « ${p.client_nom} » de la pile ?\n\n` +
                            'Le chantier sort de la liste mais reste consultable. ' +
                            'Précisez la raison (facultatif) :',
                        )
                        // `null` = annulation ; une chaîne vide reste un accord.
                        if (motif === null) return
                        retirer.mutate({ projetId: p.projet_id, motif })
                      }}
                    >
                      <Trash2 className="size-4" />
                      {epuise ? `Retirer — ${p.nb_sans_reponse} échecs` : 'Retirer'}
                    </Button>
                  )}

                  {/* Beaucoup d'échecs mais un gros devis : on le dit, plutôt
                      que de laisser croire que le dossier est à jeter. */}
                  {insister && (
                    <p className="max-w-[13rem] text-xs text-[#B45309]">
                      {p.nb_sans_reponse} appels sans réponse, mais{' '}
                      {formatEuros(p.montant_devis)} en jeu — ça vaut un essai de plus.
                    </p>
                  )}
                </div>
              </div>
            </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
