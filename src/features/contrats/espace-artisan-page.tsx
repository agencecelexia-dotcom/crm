import { useRef, useState } from 'react'
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
} from 'lucide-react'
import { toast } from 'sonner'

import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad'
import { StatutBadge } from '@/components/statut-badge'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import { STATUTS, STATUTS_ORDRE } from '@/lib/constants'
import { formatEuros, formatTel, formatDate } from '@/lib/format'
import { telechargerContratPdf } from './contrat-pdf'
import { finaliserContenu } from './contrat-modele'
import { ContratFormate } from './contrat-format'
import { SuiviArtisan } from './suivi-artisan'
import { UploadDevis } from './upload-devis'
import type { EspaceArtisan, ProjetEspace, StatutProjet } from '@/types/database'

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

  if (isLoading)
    return (
      <Centre>
        <Loader2 className="size-6 animate-spin text-primary" />
      </Centre>
    )
  if (isError || !data)
    return (
      <Centre>
        <FileText className="mb-2 size-8 text-muted-foreground" />
        <p className="font-medium">Espace introuvable</p>
        <p className="text-sm text-muted-foreground">Le lien est invalide ou expiré.</p>
      </Centre>
    )

  const { artisan, engagement, signe, contrat_externe, projets } = data
  const nomArtisan = [artisan.prenom, artisan.nom].filter(Boolean).join(' ') || artisan.societe

  return (
    <div className="mx-auto min-h-dvh max-w-5xl bg-secondary px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-5 flex flex-col items-center gap-1 sm:mb-8">
        <BrandLogo className="h-9 sm:h-10" />
        <p className="text-sm text-muted-foreground">Espace de {nomArtisan}</p>
      </div>

      {/* Contrat + intro gardés dans une colonne lisible (centrée) même sur grand écran */}
      <div className="mx-auto max-w-2xl">
      {/* Contrat (signé une fois pour tous les chantiers).
          Si contrat signé HORS application : on n'affiche aucun bloc contrat. */}
      {contrat_externe ? null : signe ? (
        <Card className="mb-4 shadow-card">
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-5 text-[#22C55E]" />
              Contrat signé
              {engagement.signed_at && (
                <span className="text-muted-foreground">le {formatDate(engagement.signed_at)}</span>
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
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
          </CardContent>
        </Card>
      ) : (
        <SignatureContrat engagement={engagement} onSigne={() => void refetch()} />
      )}

      {/* Intro */}
      {signe && (
        <p className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          Vous venez de la part d'<strong>Antoine</strong>. Voici vos chantiers — contactez vos
          clients dès que possible et tenez-nous informés avec les boutons de suivi.
        </p>
      )}
      </div>

      {/* Liste des chantiers : en cours / terminés */}
      <ListeChantiers projets={projets} signe={signe} onChange={() => void refetch()} />
    </div>
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
}: {
  projets: ProjetEspace[]
  signe: boolean
  onChange: () => void
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
    <>
      <h2 className="mb-2 mt-5 text-sm font-semibold text-muted-foreground">
        Vos chantiers ({projets.length})
      </h2>

      {/* Filtres par statut */}
      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
        {filtres.map((f) => (
          <button
            key={f.cle}
            type="button"
            onClick={() => setFiltre(f.cle)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              filtre === f.cle
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-accent',
            )}
          >
            {f.label} ({f.n})
          </button>
        ))}
      </div>

      {liste.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun chantier dans ce filtre.</p>
      ) : (
        <div className="grid items-start gap-3 sm:grid-cols-2">
          {liste.map((p) => (
            <ProjetItem key={p.id} projet={p} signe={signe} onChange={onChange} />
          ))}
        </div>
      )}
    </>
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
    <Card className="mb-4 shadow-card">
      <CardContent className="space-y-4 py-5">
        <div>
          <h1 className="text-lg font-semibold">Votre contrat d'engagement</h1>
          <p className="text-sm text-muted-foreground">
            Signez-le une seule fois : il couvre tous vos chantiers, présents et à venir.
          </p>
        </div>

        <div className="max-h-[45dvh] overflow-y-auto rounded-lg border border-border sm:max-h-[55dvh]">
          <ContratFormate
            contenu={finaliserContenu(engagement.contenu, engagement.signed_at)}
            apporteurSignature={engagement.apporteur_signature}
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
          <SignaturePad ref={padRef} className="h-40 w-full rounded-lg border border-input bg-white" />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={accepte} onCheckedChange={(v) => setAccepte(v === true)} className="mt-0.5" />
          <span>J'ai lu et j'approuve l'intégralité des conditions du présent contrat.</span>
        </label>

        <Button onClick={signer} disabled={envoi} className="h-12 w-full text-base">
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
}: {
  projet: ProjetEspace
  signe: boolean
  onChange: () => void
}) {
  const [ouvert, setOuvert] = useState(false)
  const metiers = projet.metiers?.length ? projet.metiers : [projet.metier]
  const adresse = [projet.client_adresse, projet.client_code_postal, projet.client_ville]
    .filter(Boolean)
    .join(', ')

  return (
    <Card className="overflow-hidden shadow-card">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatutBadge statut={projet.statut} />
            <span className="min-w-0 truncate text-sm font-medium">{metiers.join(', ')}</span>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {signe && projet.client_nom ? projet.client_nom : 'Client confidentiel'}
            {projet.client_ville && ` · ${projet.client_ville}`}
          </p>
        </div>
        <ChevronDown
          className={cn('size-5 shrink-0 text-muted-foreground transition-transform', ouvert && 'rotate-180')}
        />
      </button>

      {ouvert && (
        <div className="space-y-4 border-t border-border p-4">
          {/* Détails non confidentiels (toujours visibles) */}
          <div className="text-sm">
            {projet.budget_estime != null && (
              <p className="text-muted-foreground">
                Budget estimé : {formatEuros(projet.budget_estime)}
              </p>
            )}
            {projet.description && (
              <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                {projet.description}
              </p>
            )}
          </div>

          {!signe ? (
            <div className="flex items-start gap-2 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-3 text-sm text-[#92400E]">
              <Lock className="mt-0.5 size-4 shrink-0" />
              Signez le contrat en haut pour accéder aux coordonnées du client et déposer votre devis.
            </div>
          ) : (
            <>
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
                      className="aspect-square overflow-hidden rounded-lg border border-border"
                    >
                      <img src={url} alt="Photo chantier" className="size-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              {/* Suivi (statut + notes) */}
              <SuiviArtisan token={projet.token} suivis={projet.suivis ?? []} onChange={onChange} />

              {/* Dépôt devis */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Documents</p>
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
            </>
          )}
        </div>
      )}
    </Card>
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
      <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
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
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words font-semibold">{projet.client_nom}</p>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setEdition(true)}>
          <Pencil className="size-4" />
          Modifier
        </Button>
      </div>
      {projet.client_telephone && (
        <Button asChild className="h-11 w-full">
          <a href={`tel:${projet.client_telephone}`}>
            <Phone className="size-4" />
            Appeler {formatTel(projet.client_telephone)}
          </a>
        </Button>
      )}
      {projet.client_email && (
        <a
          href={`mailto:${projet.client_email}`}
          className="flex items-center gap-2 break-all text-primary"
        >
          <Mail className="size-4" />
          {projet.client_email}
        </a>
      )}
      {adresse && (
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">{adresse}</span>
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
