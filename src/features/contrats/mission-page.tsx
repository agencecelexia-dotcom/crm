import { useRef, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, CheckCircle2, FileText, Download, Phone, Mail, MapPin } from 'lucide-react'
import { toast } from 'sonner'

import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad'
import { supabase } from '@/lib/supabase/client'
import { formatEuros, formatTel } from '@/lib/format'
import { telechargerContratPdf } from './contrat-pdf'
import { finaliserContenu } from './contrat-modele'
import { ContratFormate } from './contrat-format'
import { SuiviArtisan } from './suivi-artisan'
import { UploadDevis } from './upload-devis'
import type { Suivi } from '@/types/database'

// Structure renvoyée par la fonction SQL get_mission_by_token.
interface Mission {
  artisan_token: string | null
  projet: {
    client_nom: string
    client_telephone: string | null
    client_email: string | null
    client_adresse: string | null
    client_code_postal: string | null
    client_ville: string | null
    metier: string
    metiers: string[]
    sous_metier: string | null
    description: string | null
    budget_estime: number | null
    statut: string
    photos: string[]
    devis_depose: boolean
    devis_signe_depose: boolean
  }
  artisan: { nom: string; prenom: string | null; societe: string | null } | null
  engagement: {
    token: string
    statut: 'envoye' | 'signe'
    contenu: string
    signataire_nom: string | null
    signed_at: string | null
    signature_data: string | null
    apporteur_signature: string | null
  } | null
  suivis: Suivi[]
}

export function MissionPage() {
  const { token } = useParams()
  // Chargement de la mission via react-query (rechargé après signature / upload).
  const {
    data: mission,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['mission', token],
    enabled: !!token,
    queryFn: async (): Promise<Mission | null> => {
      const { data, error } = await supabase.rpc('get_mission_by_token', {
        p_token: token,
      })
      if (error) throw error
      return (data as Mission) ?? null
    },
  })
  const charger = () => {
    void refetch()
  }

  if (isLoading)
    return (
      <Centre>
        <Loader2 className="size-6 animate-spin text-primary" />
      </Centre>
    )
  if (!mission)
    return (
      <Centre>
        <FileText className="mb-2 size-8 text-muted-foreground" />
        <p className="font-medium">Lien introuvable</p>
        <p className="text-sm text-muted-foreground">Le lien est invalide ou expiré.</p>
      </Centre>
    )

  // Les anciens liens par projet redirigent vers le portail unique de l'artisan
  // (contrat + tous ses chantiers). Si le projet n'a plus d'artisan, on reste ici.
  if (mission.artisan_token) {
    return <Navigate to={`/artisan/${mission.artisan_token}`} replace />
  }

  const engagement = mission.engagement
  const signe = engagement?.statut === 'signe'

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-secondary px-4 py-6">
      <div className="mb-6 flex justify-center">
        <BrandLogo className="h-9" />
      </div>

      {/* Étape 1 : signature du contrat (si pas déjà signé) */}
      {!signe ? (
        <SignatureContrat
          engagement={engagement}
          aArtisan={!!mission.artisan}
          artisanNomParDefaut={
            mission.artisan
              ? [mission.artisan.prenom, mission.artisan.nom].filter(Boolean).join(' ')
              : ''
          }
          onSigne={charger}
        />
      ) : (
        // Étape 2 : dossier client + dépôt des devis
        <Dossier mission={mission} token={token!} onChange={charger} />
      )}
    </div>
  )
}

// -------------------- Étape 1 : signature --------------------
function SignatureContrat({
  engagement,
  aArtisan,
  artisanNomParDefaut,
  onSigne,
}: {
  engagement: Mission['engagement']
  aArtisan: boolean
  artisanNomParDefaut: string
  onSigne: () => void
}) {
  const padRef = useRef<SignaturePadHandle>(null)
  const [nom, setNom] = useState(artisanNomParDefaut)
  const [accepte, setAccepte] = useState(false)
  const [envoi, setEnvoi] = useState(false)

  // Pas (encore) de contrat à signer : message selon l'état réel du projet.
  if (!engagement)
    return (
      <Card className="shadow-card">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {aArtisan ? (
            <>
              <p className="font-medium text-foreground">Contrat en cours de préparation</p>
              <p className="mt-1">
                Celexia finalise votre contrat. Revenez sur ce lien dans quelques instants :
                vous pourrez le signer ici, puis accéder au dossier de votre client.
              </p>
            </>
          ) : (
            <>Ce projet n'est pas encore attribué. Celexia reviendra vers vous.</>
          )}
        </CardContent>
      </Card>
    )

  async function signer() {
    if (!nom.trim()) return toast.error('Indiquez votre nom')
    if (!accepte) return toast.error('Vous devez cocher « Lu et approuvé »')
    if (padRef.current?.isEmpty()) return toast.error('Signez dans le cadre')
    setEnvoi(true)
    try {
      const { data, error } = await supabase.rpc('signer_contrat', {
        p_token: engagement!.token,
        p_signataire: nom.trim(),
        p_signature: padRef.current!.toDataURL(),
      })
      if (error || !(data as { ok?: boolean })?.ok) throw new Error('Signature impossible')
      toast.success('Contrat signé. Merci !')
      onSigne()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-5 py-6">
        <div>
          <h1 className="text-lg font-semibold">Contrat d'engagement</h1>
          <p className="text-sm text-muted-foreground">
            Signez ce contrat pour recevoir les coordonnées du client.
          </p>
        </div>

        <div className="max-h-[50dvh] overflow-y-auto rounded-lg border border-border">
          <ContratFormate
            contenu={finaliserContenu(engagement.contenu, null)}
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

// -------------------- Étape 2 : dossier client --------------------
function Dossier({
  mission,
  token,
  onChange,
}: {
  mission: Mission
  token: string
  onChange: () => void
}) {
  const { projet, engagement } = mission
  const adresse = [projet.client_adresse, projet.client_code_postal, projet.client_ville]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="space-y-4">
      {/* Marche à suivre — la première chose que voit l'artisan */}
      <Card className="border-primary/30 bg-primary/5 shadow-card">
        <CardContent className="space-y-3 py-5">
          <p className="text-lg font-semibold">🎯 À vous de jouer !</p>
          <p className="text-sm">
            Vous venez de la part d'<strong>Antoine</strong>. Un client vous attend
            pour son projet — contactez-le dès que possible.
          </p>
          {projet.client_telephone && (
            <Button asChild className="h-12 w-full text-base">
              <a href={`tel:${projet.client_telephone}`}>
                <Phone className="size-5" />
                Appeler {formatTel(projet.client_telephone)}
              </a>
            </Button>
          )}
          <p className="rounded-md bg-primary/10 p-2.5 text-sm">
            ⚠️ <strong>Le plus important :</strong> à chaque étape, mettez à jour votre
            avancement avec les boutons «&nbsp;Où en êtes-vous&nbsp;?&nbsp;» plus bas —
            c'est ce qui nous permet de suivre le projet avec vous. Et dès que le devis
            est <strong>signé</strong>, déposez-le.
          </p>
        </CardContent>
      </Card>

      {/* Contrat signé + téléchargement */}
      <Card className="shadow-card">
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="size-5 text-[#22C55E]" />
            Contrat signé
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              engagement &&
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

      {/* Coordonnées du client */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Votre client</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-base font-semibold">{projet.client_nom}</p>
          {projet.client_telephone && (
            <a href={`tel:${projet.client_telephone}`} className="flex items-center gap-3 text-primary">
              <Phone className="size-4" />
              {formatTel(projet.client_telephone)}
            </a>
          )}
          {projet.client_email && (
            <a href={`mailto:${projet.client_email}`} className="flex items-center gap-3 break-all text-primary">
              <Mail className="size-4" />
              {projet.client_email}
            </a>
          )}
          {adresse && (
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{adresse}</span>
            </div>
          )}
          <Separator />
          <p className="text-muted-foreground">
            <strong className="text-foreground">Demande :</strong>{' '}
            {(projet.metiers?.length ? projet.metiers : [projet.metier]).join(', ')}
            {projet.budget_estime != null && ` · budget estimé ${formatEuros(projet.budget_estime)}`}
          </p>
          {projet.description && (
            <p className="whitespace-pre-wrap text-muted-foreground">{projet.description}</p>
          )}
        </CardContent>
      </Card>

      {/* Photos du chantier */}
      {projet.photos?.length > 0 && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Photos du chantier</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      )}

      {/* Suivi : l'artisan déclare où il en est + écrit ce qui s'est dit */}
      <SuiviArtisan token={token} suivis={mission.suivis ?? []} onChange={onChange} />

      {/* Dépôt des devis */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Contactez le client, établissez votre devis puis <strong>déposez-le ici</strong>. Une fois
            le devis <strong>signé par le client</strong>, déposez-le également — tout est transmis
            automatiquement à Celexia.
          </p>
          <UploadDevis
            token={token}
            slot="devis"
            label="Devis"
            depose={projet.devis_depose}
            onDone={onChange}
          />
          <UploadDevis
            token={token}
            slot="devis_signe"
            label="Devis signé par le client"
            depose={projet.devis_signe_depose}
            onDone={onChange}
          />
        </CardContent>
      </Card>
    </div>
  )
}

// SuiviArtisan et UploadDevis vivent désormais dans des fichiers partagés
// (./suivi-artisan, ./upload-devis), réutilisés aussi par l'espace artisan.

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      {children}
    </div>
  )
}
