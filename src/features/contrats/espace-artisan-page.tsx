import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Loader2,
  FileText,
  CheckCircle2,
  Download,
  Phone,
  Mail,
  MapPin,
  ChevronDown,
  Lock,
  Pencil,
  Save,
  X,
  FilePlus,
  Clock,
  XCircle,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'

import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad'
import { StatutBadge } from '@/components/statut-badge'
import { StatTile, SplitBar } from './stat-tile'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import { STATUTS, STATUTS_ORDRE } from '@/lib/constants'
import { formatEuros, formatTel, formatDate } from '@/lib/format'
import { telechargerContratPdf } from './contrat-pdf'
import { finaliserContenu } from './contrat-modele'
import { ContratFormate } from './contrat-format'
import { SuiviArtisan } from './suivi-artisan'
import { UploadDevis } from './upload-devis'
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
            {isMetbach && (
              <Button size="sm" variant="outline" className="bg-card" onClick={() => setDevisInitial({})}>
                <FilePlus className="size-4" />
                Nouveau devis
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Contrat + intro gardés dans une colonne lisible (centrée) même sur grand écran */}
      <div className="mx-auto max-w-2xl">
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
            Vous venez de la part d'<strong>Antoine</strong>. Voici vos chantiers — contactez vos
            clients dès que possible et tenez-nous informés avec les boutons de suivi.
          </p>
        </div>
      )}

      {/* Résumé de son activité (statuts + commission due) */}
      {signe && projets.length > 0 && <ResumeArtisan projets={projets} />}
      </div>

      {/* Devis (Metbach uniquement) */}
      {isMetbach && token && <MesDevis token={token} />}

      {/* Liste des chantiers : en cours / terminés */}
      <ListeChantiers
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
    </div>
  )
}

// Résumé global de l'activité de l'artisan (tous ses chantiers confondus) :
// en attente, perdus, devis envoyés + montant, vendu, taux de conversion, et
// la commission qu'il doit à Celexia (due dès la signature du devis client,
// cf. contrat d'engagement) — à régler vs déjà réglée.
function ResumeArtisan({ projets }: { projets: ProjetEspace[] }) {
  const stats = useMemo(() => {
    const enAttente = projets.filter((p) => p.statut === 'en_attente').length
    const perdus = projets.filter((p) => p.statut === 'perdu').length

    const devisEnvoyes = projets.filter((p) => p.statut === 'devis_envoye')
    const montantDevisEnvoyes = devisEnvoyes.reduce((s, p) => s + (p.montant_devis ?? 0), 0)

    const signes = projets.filter((p) => p.statut === 'devis_signe' || p.statut === 'termine')
    const vendu = signes.reduce((s, p) => s + (p.montant_devis_signe ?? 0), 0)

    // Taux de conversion : parmi les chantiers où un devis a été envoyé (envoyé, signé ou terminé),
    // combien ont fini signés.
    const denomDevis = projets.filter((p) =>
      ['devis_envoye', 'devis_signe', 'termine'].includes(p.statut),
    ).length
    const tauxConversion = denomDevis > 0 ? Math.round((signes.length / denomDevis) * 100) : null

    const commissionARegler = projets
      .filter((p) => p.commission != null && !p.commission_encaissee)
      .reduce((s, p) => s + (p.commission ?? 0), 0)
    const commissionReglee = projets
      .filter((p) => p.commission_encaissee)
      .reduce((s, p) => s + (p.commission ?? 0), 0)

    return {
      enAttente,
      perdus,
      devisEnvoyesCount: devisEnvoyes.length,
      montantDevisEnvoyes,
      vendu,
      tauxConversion,
      commissionARegler,
      commissionReglee,
    }
  }, [projets])

  return (
    <section className="mt-8">
      <SectionTitre>Votre activité</SectionTitre>

      {/* Stat héro : total vendu + taux de conversion intégré */}
      <div className="rounded-2xl bg-primary p-5 text-primary-foreground shadow-violet">
        <p className="flex items-center gap-1.5 text-xs font-medium opacity-80">
          <CheckCircle2 className="size-4" /> Vendu (devis signés)
        </p>
        <p className="montant mt-1 text-3xl font-semibold sm:text-4xl">{formatEuros(stats.vendu)}</p>
        {stats.tauxConversion != null && (
          <div className="mt-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-all duration-500"
                style={{ width: `${stats.tauxConversion}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs opacity-80">
              <strong className="font-semibold opacity-100">{stats.tauxConversion}%</strong> de vos
              devis envoyés signés
            </p>
          </div>
        )}
      </div>

      {/* Tuiles secondaires */}
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        <StatTile icon={Clock} label="En attente" valeur={String(stats.enAttente)} tone="warning" />
        <StatTile
          icon={FileText}
          label="Devis envoyés"
          sousLabel={stats.devisEnvoyesCount ? formatEuros(stats.montantDevisEnvoyes) : undefined}
          valeur={String(stats.devisEnvoyesCount)}
          tone="warning"
        />
        <StatTile icon={XCircle} label="Perdus" valeur={String(stats.perdus)} tone="danger" />
      </div>

      {/* Commission Celexia : à régler / réglée */}
      <div className="mt-3 rounded-2xl border border-border/70 bg-card p-4 shadow-card">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Wallet className="size-4" />
          </span>
          Commission Celexia
        </p>
        <SplitBar
          gauche={stats.commissionARegler}
          droite={stats.commissionReglee}
          couleurGauche="#F59E0B"
          couleurDroite="#22C55E"
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-[#F59E0B]" /> À régler
            </p>
            <p className="montant text-lg font-semibold text-[#B45309]">
              {formatEuros(stats.commissionARegler)}
            </p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-[#22C55E]" /> Réglée
            </p>
            <p className="montant text-lg font-semibold text-[#16A34A]">
              {formatEuros(stats.commissionReglee)}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Due à la signature du devis par le client (cf. contrat d'engagement).
        </p>
      </div>
    </section>
  )
}

// Titre de section du portail : tiret violet + Clash Display + compteur optionnel.
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

// Liste des devis générés par l'artisan (Metbach).
function MesDevis({ token }: { token: string }) {
  const { data: devis } = useListeDevis(token)
  if (!devis || devis.length === 0) return null
  return (
    <section className="mt-10">
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
}: {
  projets: ProjetEspace[]
  signe: boolean
  onChange: () => void
  onCreerDevis?: (p: ProjetEspace) => void
}) {
  const [filtre, setFiltre] = useState<'tous' | 'en_cours' | StatutProjet>('tous')

  // Compteurs par statut (uniquement les statuts réellement présents)
  const compte = (s: StatutProjet) => projets.filter((p) => p.statut === s).length
  const nbEnCours = projets.filter((p) => EN_COURS.includes(p.statut)).length
  const statutsPresents = STATUTS_ORDRE.filter((s) => compte(s) > 0)

  const filtres: { cle: 'tous' | 'en_cours' | StatutProjet; label: string; n: number }[] = [
    { cle: 'tous', label: 'Tous', n: projets.length },
    { cle: 'en_cours', label: 'En cours', n: nbEnCours },
    ...statutsPresents.map((s) => ({ cle: s, label: STATUTS[s].label, n: compte(s) })),
  ]

  const liste = projets.filter((p) =>
    filtre === 'tous' ? true : filtre === 'en_cours' ? EN_COURS.includes(p.statut) : p.statut === filtre,
  )

  return (
    <section className="mt-10">
      <SectionTitre compte={projets.length}>Vos chantiers</SectionTitre>

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

      {liste.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
          <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <FileText className="size-5" />
          </span>
          <p className="text-sm text-muted-foreground">Aucun chantier dans ce filtre.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {liste.map((p) => (
            <ProjetItem key={p.id} projet={p} signe={signe} onChange={onChange} onCreerDevis={onCreerDevis} />
          ))}
        </div>
      )}
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
  const metiers = projet.metiers?.length ? projet.metiers : [projet.metier]
  const adresse = [projet.client_adresse, projet.client_code_postal, projet.client_ville]
    .filter(Boolean)
    .join(', ')
  const montantAffiche = projet.montant_devis_signe ?? projet.montant_devis

  return (
    <Card className="relative overflow-hidden py-0 shadow-card transition-shadow hover:shadow-card-hover">
      {/* Liseré de statut (piloté par la couleur du statut) */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: STATUTS[projet.statut].color }}
      />
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-3 p-4 pl-5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5 sm:pl-6"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate font-display text-base tracking-tight">
              {metiers.join(', ')}
            </span>
            <StatutBadge statut={projet.statut} />
          </div>
          <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            {signe && projet.client_nom ? (
              <span className="truncate">{projet.client_nom}</span>
            ) : (
              <span className="flex items-center gap-1 italic">
                <Lock className="size-3.5 shrink-0" /> Client confidentiel
              </span>
            )}
            {projet.client_ville && (
              <span className="flex min-w-0 items-center gap-0.5">
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">{projet.client_ville}</span>
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {montantAffiche != null && (
            <span className="montant hidden text-sm font-semibold sm:block">
              {formatEuros(montantAffiche)}
            </span>
          )}
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-full transition-all duration-200',
              ouvert ? 'rotate-180 bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            <ChevronDown className="size-5" />
          </span>
        </div>
      </button>

      {ouvert && (
        <div className="space-y-5 border-t border-border p-4 pl-5 animate-in fade-in slide-in-from-top-1 duration-200 sm:p-5 sm:pl-6">
          {/* Détails non confidentiels (toujours visibles) */}
          {(projet.budget_estime != null || projet.description) && (
            <div className="rounded-xl bg-muted/40 p-3.5 text-sm">
              {projet.budget_estime != null && (
                <p className="text-muted-foreground">
                  Budget estimé :{' '}
                  <span className="montant font-medium text-foreground">
                    {formatEuros(projet.budget_estime)}
                  </span>
                </p>
              )}
              {projet.description && (
                <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                  {projet.description}
                </p>
              )}
            </div>
          )}

          {!signe ? (
            <div className="rounded-xl border border-dashed border-[#F59E0B]/40 bg-[#F59E0B]/5 p-5 text-center">
              <span className="mx-auto mb-2.5 flex size-10 items-center justify-center rounded-full bg-[#F59E0B]/15 text-[#B45309]">
                <Lock className="size-5" />
              </span>
              <p className="text-sm text-[#92400E]">
                Signez le contrat pour accéder aux coordonnées du client et déposer votre devis.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3 bg-card">
                <a href="#contrat">Signer le contrat</a>
              </Button>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
              {/* Colonne gauche : client + suivi */}
              <div className="space-y-5">
                <div className="space-y-2">
                  <SousTitre icon={Phone}>Client</SousTitre>
                  {/* Coordonnées client (éditables sauf le téléphone) */}
                  <ClientBloc projet={projet} adresse={adresse} onChange={onChange} />

                  {/* Photos */}
                  {projet.photos?.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {projet.photos.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener"
                          className="aspect-square overflow-hidden rounded-xl border border-border transition-opacity hover:opacity-90"
                        >
                          <img src={url} alt="Photo chantier" className="size-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <SousTitre icon={Clock}>Avancement</SousTitre>
                  {/* Suivi (statut + notes) */}
                  <SuiviArtisan
                    token={projet.token}
                    suivis={projet.suivis ?? []}
                    onChange={onChange}
                    statutActuel={projet.statut}
                  />
                </div>
              </div>

              {/* Colonne droite : documents */}
              <div className="space-y-2">
                <SousTitre icon={FileText}>Documents</SousTitre>
                {onCreerDevis && (
                  <Button
                    className="w-full shadow-violet transition-transform active:scale-[0.99]"
                    onClick={() => onCreerDevis(projet)}
                  >
                    <FilePlus className="size-4" />
                    Créer un devis
                  </Button>
                )}
                <UploadDevis
                  token={projet.token}
                  slot="devis"
                  label="Devis"
                  depose={projet.devis_depose}
                  montantInitial={projet.montant_devis}
                  onDone={onChange}
                />
                <UploadDevis
                  token={projet.token}
                  slot="devis_signe"
                  label="Devis signé par le client"
                  depose={projet.devis_signe_depose}
                  montantInitial={projet.montant_devis_signe}
                  onDone={onChange}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// Mini-en-tête de sous-section dans un chantier déplié.
function SousTitre({ icon: Icon, children }: { icon: typeof Phone; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="size-3.5" />
      {children}
    </p>
  )
}

// Coordonnées client : consultation + édition (tout sauf le téléphone).
function ClientBloc({
  projet,
  adresse,
  onChange,
}: {
  projet: ProjetEspace
  adresse: string
  onChange: () => void
}) {
  const [edition, setEdition] = useState(false)
  const [saving, setSaving] = useState(false)
  const [f, setF] = useState({
    nom: projet.client_nom ?? '',
    email: projet.client_email ?? '',
    adresse: projet.client_adresse ?? '',
    cp: projet.client_code_postal ?? '',
    ville: projet.client_ville ?? '',
    description: projet.description ?? '',
    budget: projet.budget_estime != null ? String(projet.budget_estime) : '',
  })
  const maj = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  async function enregistrer() {
    setSaving(true)
    try {
      const budget = f.budget.trim() ? parseFloat(f.budget.replace(',', '.')) : null
      const { data, error } = await supabase.rpc('update_projet_by_token', {
        p_token: projet.token,
        p_client_nom: f.nom,
        p_client_email: f.email,
        p_client_adresse: f.adresse,
        p_client_code_postal: f.cp,
        p_client_ville: f.ville,
        p_description: f.description,
        p_budget: budget,
      })
      if (error || !(data as { ok?: boolean })?.ok) throw new Error('Échec')
      toast.success('Infos mises à jour')
      setEdition(false)
      onChange()
    } catch {
      toast.error("Impossible d'enregistrer")
    } finally {
      setSaving(false)
    }
  }

  if (edition) {
    return (
      <div className="space-y-2 rounded-xl border border-border/70 bg-card p-3.5 text-sm shadow-card">
        <div className="space-y-1.5">
          <Label className="text-xs">Nom du prospect</Label>
          <Input className="h-10" value={f.nom} onChange={(e) => maj('nom', e.target.value)} />
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="mr-1 inline size-3" />
          Téléphone (non modifiable) : <strong>{formatTel(projet.client_telephone ?? '')}</strong>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Email</Label>
          <Input className="h-10" value={f.email} onChange={(e) => maj('email', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Adresse</Label>
          <Input className="h-10" value={f.adresse} onChange={(e) => maj('adresse', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Code postal</Label>
            <Input className="h-10" value={f.cp} onChange={(e) => maj('cp', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Ville</Label>
            <Input className="h-10" value={f.ville} onChange={(e) => maj('ville', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Budget estimé (€)</Label>
          <Input
            type="number"
            className="h-10"
            value={f.budget}
            onChange={(e) => maj('budget', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Description / notes</Label>
          <Textarea
            rows={3}
            value={f.description}
            onChange={(e) => maj('description', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button variant="outline" onClick={() => setEdition(false)} disabled={saving}>
            <X className="size-4" />
            Annuler
          </Button>
          <Button onClick={enregistrer} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Enregistrer
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-card p-3.5 text-sm shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words font-display text-base tracking-tight">
          {projet.client_nom}
        </p>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setEdition(true)}>
          <Pencil className="size-4" />
          Modifier
        </Button>
      </div>
      {projet.client_telephone && (
        <Button asChild className="h-11 w-full shadow-violet transition-transform active:scale-[0.98]">
          <a href={`tel:${projet.client_telephone}`}>
            <Phone className="size-4" />
            Appeler {formatTel(projet.client_telephone)}
          </a>
        </Button>
      )}
      {projet.client_email && (
        <a
          href={`mailto:${projet.client_email}`}
          className="flex items-center gap-2.5 break-all text-primary transition-opacity hover:opacity-80"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Mail className="size-4" />
          </span>
          {projet.client_email}
        </a>
      )}
      {adresse && (
        <div className="flex items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <MapPin className="size-4" />
          </span>
          <span className="min-w-0 break-words pt-1.5">{adresse}</span>
        </div>
      )}
    </div>
  )
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      {children}
    </div>
  )
}
