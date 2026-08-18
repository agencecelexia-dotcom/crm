import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Loader2,
  FileText,
  CheckCircle2,
  Download,
  Lock,
  FilePlus,
  RotateCcw,
  Search,
  Rows3,
  Columns3,
} from 'lucide-react'
import { toast } from 'sonner'

import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import { STATUTS_ORDRE, statutInfo } from '@/lib/constants'
import { formatDate } from '@/lib/format'
import { telechargerContratPdf } from './contrat-pdf'
import { finaliserContenu } from './contrat-modele'
import { ContratFormate } from './contrat-format'
import { ChantiersPerdus } from './chantiers-perdus'
import { PiedDePageArtisan } from './pied-de-page-artisan'
import { EnteteChantier, LisereStatut } from './entete-chantier'
import { CorpsChantier } from './corps-chantier'
import { KanbanChantiers } from './kanban-chantiers'
import { DrawerChantier } from './drawer-chantier'
import { ReleveCommissions } from './releve-commissions'
import { correspond, dateReception, estClos, urgenceChantier } from './urgence-chantier'
import { ApercuDernierSuivi } from './apercu-dernier-suivi'
import { TableauDeBordArtisan } from './tableau-de-bord-artisan'
import { DevisBuilder, type DevisInitial } from '@/features/devis/devis-builder'
import { useListeDevis } from '@/features/devis/use-devis'
import type { EspaceArtisan, ProjetEspace, StatutProjet } from '@/types/database'

// Le générateur de devis n'est activé QUE pour cet artisan (Metbach) pour l'instant.
const METBACH_ID = '98a39398-2b7f-4a44-b9bc-aa6f893e9d32'

// Espace artisan UNIQUE (/artisan/:token) : il signe son contrat une fois,
// puis retrouve TOUS ses chantiers. Identité client masquée tant que non signé.
export function EspaceArtisanPage() {
  const { token } = useParams()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['espace', token],
    enabled: !!token,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<EspaceArtisan | null> => {
      const { data, error } = await supabase.rpc('get_espace_artisan', { p_token: token })
      if (error) throw error
      return (data as EspaceArtisan) ?? null
    },
  })
  const [devisInitial, setDevisInitial] = useState<DevisInitial | null>(null)
  // Bascule pipe actif / espace « Perdus » (migration 0070).
  const [vuePerdus, setVuePerdus] = useState(false)
  // Filtre demandé depuis le tableau de bord.
  const [filtreDemande, setFiltreDemande] = useState<'urgents' | null>(null)

  if (isLoading)
    return (
      <div className="min-h-dvh bg-background">
        <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6 sm:py-12">
          <div className="mb-8 flex flex-col items-center gap-4">
            <BrandLogo className="h-10 mix-blend-multiply sm:h-11" />
            <div className="flex w-full max-w-2xl items-center gap-3">
              <Skeleton className="size-12 rounded-2xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-2/5" />
                <Skeleton className="h-4 w-1/4" />
              </div>
            </div>
          </div>
          <div className="mx-auto max-w-2xl space-y-4">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-52 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    )
  if (isError || !data)
    return (
      <Centre>
        <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-card p-8 shadow-card">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <FileText className="size-6" />
          </span>
          <p className="font-display text-lg font-medium">Espace introuvable</p>
          <p className="mt-1 text-sm text-muted-foreground">Le lien est invalide ou expiré.</p>
        </div>
      </Centre>
    )

  const { artisan, engagement, signe, contrat_externe, projets } = data
  const projetsPerdus = data.projets_perdus ?? []
  const nomArtisan = [artisan.prenom, artisan.nom].filter(Boolean).join(' ') || artisan.societe
  const isMetbach = artisan.id === METBACH_ID

  function ouvrirDevisProjet(p: ProjetEspace) {
    setDevisInitial({
      affectation_token: p.token,
      client_nom: p.client_nom,
      client_adresse: p.client_adresse,
      client_cp: p.client_code_postal,
      client_ville: p.client_ville,
      client_email: p.client_email,
      client_tel: p.client_telephone,
      objet: p.metiers?.length ? p.metiers.join(', ') : p.metier,
    })
  }

  const initiale = (nomArtisan || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background">
      {/* Bande décorative du hero (purement visuelle) */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72">
        <div className="absolute inset-0 bg-gradient-to-b from-violet-100 via-violet-50/60 to-transparent" />
        <div className="absolute -left-20 -top-24 size-72 rounded-full bg-violet-300/20 blur-3xl" />
        <div className="absolute -right-16 top-4 size-56 rounded-full bg-violet-400/10 blur-3xl" />
      </div>

      <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6 sm:py-12">
      <header className="mb-8 sm:mb-12">
        <div className="mb-6 flex justify-center">
          <BrandLogo className="h-10 mix-blend-multiply sm:h-11" />
        </div>
        <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary font-display text-xl font-semibold text-primary-foreground shadow-violet sm:size-14 sm:text-2xl">
            {initiale}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl tracking-tight sm:text-3xl">
              {nomArtisan}
            </h1>
            {artisan.societe && artisan.societe !== nomArtisan && (
              <p className="truncate text-sm text-muted-foreground">{artisan.societe}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {contrat_externe || signe ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22C55E]/25 bg-[#22C55E]/10 px-3 py-1.5 text-xs font-medium text-[#16A34A]">
                <CheckCircle2 className="size-3.5" /> Contrat signé
              </span>
            ) : (
              <a
                href="#contrat"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-3 py-1.5 text-xs font-medium text-[#B45309] transition-colors hover:bg-[#F59E0B]/20"
              >
                <Lock className="size-3.5" /> Contrat à signer
              </a>
            )}
            {projetsPerdus.length > 0 && !vuePerdus && (
              <Button
                size="sm"
                variant="outline"
                className="bg-card"
                onClick={() => setVuePerdus(true)}
              >
                <RotateCcw className="size-4" />
                Perdus
                <span className="ml-0.5 rounded-full bg-muted px-1.5 text-xs font-semibold">
                  {projetsPerdus.length}
                </span>
              </Button>
            )}
            {isMetbach && (
              <Button size="sm" variant="outline" className="bg-card" onClick={() => setDevisInitial({})}>
                <FilePlus className="size-4" />
                Nouveau devis
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Espace « Perdus » : remplace le pipe le temps de la consultation.
          L'artisan y récupère un chantier si le client le recontacte. */}
      {vuePerdus && (
        <div className="mx-auto max-w-2xl">
          <ChantiersPerdus
            projets={projetsPerdus}
            signe={signe}
            onRetour={() => setVuePerdus(false)}
            onChange={() => void refetch()}
          />
        </div>
      )}

      {/* Contrat + intro gardés dans une colonne lisible (centrée) même sur grand écran */}
      <div className={cn('mx-auto max-w-2xl', vuePerdus && 'hidden')}>
      {/* Contrat (signé une fois pour tous les chantiers).
          Si contrat signé HORS application : on n'affiche aucun bloc contrat. */}
      {contrat_externe ? null : signe ? (
        <div className="mb-4 rounded-2xl border border-[#22C55E]/25 bg-[#22C55E]/5 shadow-card">
          <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
            <p className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#22C55E]/15 text-[#16A34A]">
                <CheckCircle2 className="size-5" />
              </span>
              <span className="min-w-0">
                Contrat signé
                {engagement.signed_at && (
                  <span className="block truncate text-xs font-normal text-muted-foreground sm:inline sm:before:content-['_']">
                    le {formatDate(engagement.signed_at)}
                  </span>
                )}
              </span>
            </p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 bg-card"
              onClick={() =>
                telechargerContratPdf({
                  contenu: finaliserContenu(engagement.contenu, engagement.signed_at),
                  signataire: engagement.signataire_nom,
                  signedAt: engagement.signed_at,
                  signatureDataUrl: engagement.signature_data,
                  apporteurSignatureUrl: engagement.apporteur_signature,
                })
              }
            >
              <Download className="size-4" />
              Télécharger
            </Button>
          </div>
        </div>
      ) : (
        <SignatureContrat engagement={engagement} onSigne={() => void refetch()} />
      )}

      {/* Intro */}
      {signe && (
        <div className="mb-3 flex items-start gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 font-display text-sm font-semibold text-primary">
            A
          </span>
          <p className="text-sm leading-relaxed text-foreground/90">
            <strong>Antoine</strong> vous transmet ces chantiers. Contactez vos
            clients dès que possible et tenez-nous informés avec les boutons de suivi.
          </p>
        </div>
      )}

      {/* Résumé de son activité (statuts + commission due) */}
      {signe && data.stats && (
        <TableauDeBordArtisan
          stats={data.stats}
          onFiltrer={(f) => {
            setFiltreDemande(f)
            document.getElementById('mes-chantiers')?.scrollIntoView({ behavior: 'smooth' })
          }}
        />
      )}
      </div>

      {/* Devis (Metbach uniquement) */}
      {isMetbach && token && <MesDevis token={token} />}

      {/* Liste des chantiers : en cours / terminés */}
      <ListeChantiers
        filtreDemande={filtreDemande}
        onFiltreApplique={() => setFiltreDemande(null)}
        projets={projets}
        signe={signe}
        onChange={() => void refetch()}
        onCreerDevis={isMetbach ? ouvrirDevisProjet : undefined}
      />
      </div>

      {/* Générateur de devis (Metbach) */}
      {isMetbach && token && devisInitial && (
        <DevisBuilder
          key={devisInitial.affectation_token ?? 'standalone'}
          token={token}
          vendeur={artisan}
          initial={devisInitial}
          onClose={() => setDevisInitial(null)}
          onDone={() => void refetch()}
        />
      )}

      {/* Relevé détaillé : la commission n'était qu'un total agrégé. */}
      {!vuePerdus && signe && token && (
        <div className="mx-auto max-w-2xl">
          <ReleveCommissions token={token} />
        </div>
      )}

      {/* Contact, aide et mentions : totalement absents auparavant (audit §9). */}
      {!vuePerdus && <PiedDePageArtisan />}
    </div>
  )
}

// Titre de section du portail artisan.
function SectionTitre({ children, compte }: { children: ReactNode; compte?: number }) {
  return (
    <h2 className="mb-4 flex items-center gap-2.5 font-display text-xl tracking-tight sm:text-2xl">
      <span aria-hidden className="inline-block h-5 w-1 rounded-full bg-primary" />
      <span>{children}</span>
      {compte != null && (
        <span className="font-sans text-base font-normal text-muted-foreground">({compte})</span>
      )}
    </h2>
  )
}

function MesDevis({ token }: { token: string }) {
  const { data: devis } = useListeDevis(token)
  if (!devis || devis.length === 0) return null
  return (
    <section id="mes-chantiers" className="mt-10">
      <SectionTitre compte={devis.length}>Mes devis</SectionTitre>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {devis.map((d) => (
          <li key={d.id}>
            <Card className="flex items-center gap-3 p-3.5 shadow-card transition-shadow hover:shadow-card-hover">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {d.numero} · {d.client_nom ?? '—'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(d.total || 0).replace(/[\u202f\u00a0]/g, ' ')} € ·{' '}
                  <span
                    className={cn(
                      'mx-1 inline-block rounded-full px-2 py-px align-middle text-[10px] font-medium',
                      d.statut === 'envoye'
                        ? 'bg-[#22C55E]/10 text-[#16A34A]'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {d.statut === 'envoye' ? 'Envoyé' : 'Brouillon'}
                  </span>
                  {d.objet ? ` · ${d.objet}` : ''}
                </p>
              </div>
              {d.pdf_url && (
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <a href={d.pdf_url} target="_blank" rel="noopener">
                    <Download className="size-4" />
                    PDF
                  </a>
                </Button>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Liste filtrable par statut (chips « Tous » + statuts présents avec compteur).
const EN_COURS: StatutProjet[] = [
  'artisan_assigne',
  'contacte',
  'rdv_pris',
  'devis_envoye',
  'devis_signe',
]

function ListeChantiers({
  projets,
  signe,
  onChange,
  onCreerDevis,
  filtreDemande,
  onFiltreApplique,
}: {
  projets: ProjetEspace[]
  signe: boolean
  onChange: () => void
  onCreerDevis?: (p: ProjetEspace) => void
  filtreDemande?: 'urgents' | null
  onFiltreApplique?: () => void
}) {
  const [filtreLocal, setFiltreLocal] = useState<'tous' | 'en_cours' | 'urgents' | StatutProjet>('tous')
  const [recherche, setRecherche] = useState('')
  const [vue, setVue] = useState<'liste' | 'kanban'>('liste')
  const [ouvertDrawer, setOuvertDrawer] = useState<ProjetEspace | null>(null)

  // Filtre poussé par le tableau de bord : valeur DÉRIVÉE plutôt qu'un
  // setState dans un effet, qui déclencherait un rendu en cascade.
  const filtre = filtreDemande ?? filtreLocal
  const setFiltre = (f: typeof filtreLocal) => {
    setFiltreLocal(f)
    onFiltreApplique?.()
  }

  const compte = (s: StatutProjet) => projets.filter((p) => p.statut === s).length
  const nbEnCours = projets.filter((p) => EN_COURS.includes(p.statut)).length
  const statutsPresents = STATUTS_ORDRE.filter((s) => compte(s) > 0)

  // Urgence calculée une fois par chantier : sert au filtre, au tri et au badge.
  const urgences = useMemo(
    () => new Map(projets.map((p) => [p.id, urgenceChantier(p)])),
    [projets],
  )
  // « À traiter » se fonde sur le NIVEAU, pas sur un seuil de score : le score
  // sert au classement interne d'un groupe et bouge quand une règle change.
  // Un seuil numérique laissait entrer « Reçu récemment » (900), qui n'est
  // pas une action en retard.
  const estUrgent = (id: string) => {
    const n = urgences.get(id)?.niveau
    return n === 'critique' || n === 'haute'
  }
  const nbUrgents = projets.filter((p) => estUrgent(p.id)).length

  const filtres: { cle: 'tous' | 'en_cours' | 'urgents' | StatutProjet; label: string; n: number }[] = [
    { cle: 'tous', label: 'Tous', n: projets.length },
    ...(nbUrgents > 0 ? [{ cle: 'urgents' as const, label: 'À traiter', n: nbUrgents }] : []),
    { cle: 'en_cours', label: 'En cours', n: nbEnCours },
    ...statutsPresents.map((s) => ({ cle: s, label: statutInfo(s).label, n: compte(s) })),
  ]

  // ORDRE CHRONOLOGIQUE, du plus récent au plus ancien : l'ordre de dépôt dans
  // le pipe. Le tri par urgence testé avant déplaçait les dossiers d'un jour à
  // l'autre selon des scores invisibles pour l'artisan, qui ne retrouvait plus
  // ses chantiers là où il les avait laissés. Une liste qui bouge toute seule
  // se relit entièrement à chaque fois.
  //
  // Seule exception : un chantier tranché (gagné ou perdu) n'a plus rien à
  // faire en haut de pile, il descend.
  const liste = useMemo(
    () =>
      projets
        .filter((p) =>
          filtre === 'tous'
            ? true
            : filtre === 'urgents'
              ? estUrgent(p.id)
              : filtre === 'en_cours'
                ? EN_COURS.includes(p.statut)
                : p.statut === filtre,
        )
        .filter((p) => correspond(p, recherche))
        .sort((a, b) => {
          const ecart = Number(estClos(a)) - Number(estClos(b))
          if (ecart !== 0) return ecart
          return dateReception(b) - dateReception(a)
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- estUrgent dérive de `urgences`
    [projets, filtre, recherche, urgences],
  )

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionTitre compte={projets.length}>Vos chantiers</SectionTitre>
        {/* Une liste plate ne montre pas où le flux se bloque (audit §6). */}
        <div role="tablist" aria-label="Affichage" className="flex gap-1 rounded-full bg-muted p-1">
          {(['liste', 'kanban'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={vue === v}
              onClick={() => setVue(v)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                vue === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {v === 'liste' ? <Rows3 className="size-3.5" /> : <Columns3 className="size-3.5" />}
              {v === 'liste' ? 'Liste' : 'Kanban'}
            </button>
          ))}
        </div>
      </div>

      {/* Recherche : 65 cartes sans moyen de retrouver un client (audit §6). */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un client, une ville, un métier…"
          className="h-11 pl-9"
          aria-label="Rechercher un chantier"
        />
      </div>

      {/* Filtres par statut */}
      <div className="scrollbar-hide -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
        {filtres.map((f) => (
          <button
            key={f.cle}
            type="button"
            onClick={() => setFiltre(f.cle)}
            aria-pressed={filtre === f.cle}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-all duration-200 active:scale-[0.98]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              filtre === f.cle
                ? 'border-transparent bg-primary text-primary-foreground shadow-violet'
                : 'border-border/70 bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {f.label}
            <span
              className={cn(
                'rounded-full px-1.5 py-px text-[10px] tabular-nums',
                filtre === f.cle ? 'bg-white/20' : 'bg-muted',
              )}
            >
              {f.n}
            </span>
          </button>
        ))}
      </div>

      {vue === 'kanban' ? (
        <KanbanChantiers projets={liste} signe={signe} onOuvrir={setOuvertDrawer} />
      ) : liste.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
          <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <FileText className="size-5" />
          </span>
          <p className="text-sm text-muted-foreground">
            {recherche ? 'Aucun chantier ne correspond à cette recherche.' : 'Aucun chantier dans ce filtre.'}
          </p>
        </div>
      ) : (
        // Liste simple, dans l'ordre où les chantiers ont été déposés. Le
        // regroupement par nature d'action testé avant réordonnait tout : un
        // chantier changeait de section selon son urgence calculée, et
        // l'artisan ne le retrouvait plus où il l'avait laissé.
        <div className="space-y-3">
          {liste.map((p, i) => {
            // Trait de séparation au premier chantier tranché. Le tri place
            // déjà les dossiers clos en bas ; la barre rend la frontière
            // visible, entre ce qui demande du travail et ce qui est acquis.
            // La bascule se fonde sur `issue`, pas sur le libellé « devis
            // signé » : un chantier signé mais pas encore terminé est déjà
            // gagné, et un chantier perdu appartient au même bloc.
            const clos = estClos(p)
            const premierClos = clos && (i === 0 || !estClos(liste[i - 1]))
            return (
              <div key={p.id} className={premierClos ? 'space-y-3 pt-3' : undefined}>
                {premierClos && (
                  <div className="flex items-center gap-3 pb-1">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Chantiers terminés
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                <ProjetItem
                  projet={p}
                  signe={signe}
                  onChange={onChange}
                  onCreerDevis={onCreerDevis}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Détail en panneau latéral : la liste reste visible derrière. */}
      <DrawerChantier
        projet={ouvertDrawer}
        signe={signe}
        onClose={() => setOuvertDrawer(null)}
        onChange={onChange}
        onCreerDevis={onCreerDevis}
      />
    </section>
  )
}

// -------------------- Bloc signature du contrat --------------------
function SignatureContrat({
  engagement,
  onSigne,
}: {
  engagement: EspaceArtisan['engagement']
  onSigne: () => void
}) {
  const padRef = useRef<SignaturePadHandle>(null)
  const [nom, setNom] = useState('')
  const [accepte, setAccepte] = useState(false)
  const [envoi, setEnvoi] = useState(false)

  async function signer() {
    if (!nom.trim()) return toast.error('Indiquez votre nom')
    if (!accepte) return toast.error('Vous devez cocher « Lu et approuvé »')
    if (padRef.current?.isEmpty()) return toast.error('Signez dans le cadre')
    setEnvoi(true)
    try {
      const signature = padRef.current!.toDataURL()
      const { data, error } = await supabase.rpc('signer_contrat', {
        p_token: engagement.token,
        p_signataire: nom.trim(),
        p_signature: signature,
      })
      const ok = (data as { ok?: boolean } | null)?.ok
      if (error || !ok) throw new Error('Signature impossible (contrat déjà signé ?)')
      toast.success('Contrat signé. Merci !')
      onSigne()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Card id="contrat" className="mb-4 scroll-mt-4 overflow-hidden py-0 shadow-card">
      {/* Barre d'accent cérémonielle */}
      <div aria-hidden className="h-1 w-full bg-gradient-to-r from-primary to-violet-400" />
      <CardContent className="space-y-4 pb-6 pt-5">
        <div>
          <h1 className="font-display text-xl tracking-tight">Votre contrat d'engagement</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Signez-le une seule fois : il couvre tous vos chantiers, présents et à venir.
          </p>
          {/* Rail d'étapes (purement visuel) */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {['Lire', 'Signer', 'Valider'].map((etape, i) => (
              <span
                key={etape}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1"
              >
                <span className="grid size-4 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                  {i + 1}
                </span>
                {etape}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          <div className="max-h-[45dvh] overflow-y-auto rounded-xl border border-border bg-white shadow-inner sm:max-h-[55dvh]">
            <ContratFormate
              contenu={finaliserContenu(engagement.contenu, engagement.signed_at)}
              apporteurSignature={engagement.apporteur_signature}
            />
          </div>
          {/* Fondu bas : indique qu'il reste du contenu à faire défiler */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-px bottom-px h-10 rounded-b-xl bg-gradient-to-t from-white to-transparent"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nom">Nom du signataire</Label>
          <Input id="nom" className="h-11" value={nom} onChange={(e) => setNom(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Signature</Label>
            <Button type="button" variant="ghost" size="sm" onClick={() => padRef.current?.clear()}>
              Effacer
            </Button>
          </div>
          <SignaturePad
            ref={padRef}
            className="h-40 w-full rounded-xl border-2 border-dashed border-input bg-white"
          />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={accepte} onCheckedChange={(v) => setAccepte(v === true)} className="mt-0.5" />
          <span>J'ai lu et j'approuve l'intégralité des conditions du présent contrat.</span>
        </label>

        <Button
          onClick={signer}
          disabled={envoi}
          className="h-12 w-full text-base shadow-violet transition-transform active:scale-[0.99]"
        >
          {envoi && <Loader2 className="size-4 animate-spin" />}
          Signer le contrat
        </Button>
      </CardContent>
    </Card>
  )
}

// -------------------- Un chantier (accordéon) --------------------
function ProjetItem({
  projet,
  signe,
  onChange,
  onCreerDevis,
}: {
  projet: ProjetEspace
  signe: boolean
  onChange: () => void
  onCreerDevis?: (p: ProjetEspace) => void
}) {
  const [ouvert, setOuvert] = useState(false)
  const adresse = [projet.client_adresse, projet.client_code_postal, projet.client_ville]
    .filter(Boolean)
    .join(', ')

  return (
    <Card className="group relative overflow-hidden py-0 shadow-card transition-shadow hover:shadow-card-hover">
      <LisereStatut statut={projet.statut} />
      <EnteteChantier
        projet={projet}
        signe={signe}
        ouvert={ouvert}
        onToggle={() => setOuvert((v) => !v)}
      />

      {/* Dernier échange : répond à « où en étais-je avec celui-là ? » sans
          avoir à ouvrir la fiche. Masqué quand la carte est dépliée, où le
          fil complet est déjà visible. */}
      {!ouvert && <ApercuDernierSuivi projet={projet} variante="inline" />}

      {ouvert && (
        <CorpsChantier
          projet={projet}
          signe={signe}
          adresse={adresse}
          onChange={onChange}
          onCreerDevis={onCreerDevis}
        />
      )}
    </Card>
  )
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      {children}
    </div>
  )
}
