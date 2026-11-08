import { useId, useState, type ReactNode } from 'react'
import {
  Clock, FileText, FilePlus, Loader2, Lock, Mail, MapPin, Pencil, Phone, Ruler, Save, X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase/client'
import { formatTel } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { DocumentsPartages } from './documents-partages'
import { VignettePiece } from '@/components/vignette-piece'
import { SuiviArtisan } from './suivi-artisan'
import { UploadDevis } from './upload-devis'
import { RetraitChantierDialog } from './retrait-chantier-dialog'
import type { ProjetEspace } from '@/types/database'

/**
 * Corps d'une fiche chantier, sans son en-tête.
 *
 * Extrait de l'accordéon pour être réutilisable : la fiche fait 3 à 4 écrans
 * de haut, et la déplier sur place poussait tout le reste vers le bas, faisant
 * perdre le contexte et la position dans la liste (audit §6). Le même contenu
 * alimente désormais l'accordéon et le panneau latéral.
 */
export function CorpsChantier({
  projet,
  signe,
  adresse,
  onChange,
  onCreerDevis,
  onMesurer,
  encadre = true,
}: {
  projet: ProjetEspace
  signe: boolean
  adresse: string
  onChange: () => void
  onCreerDevis?: (p: ProjetEspace) => void
  onMesurer?: (p: ProjetEspace) => void
  /** false dans le drawer, qui gère lui-même ses marges. */
  encadre?: boolean
}) {
  return (
      <div className={cn('min-w-0 space-y-6', encadre && 'border-t border-border p-4 sm:p-5')}>
        {/* Détails non confidentiels (toujours visibles) */}
        {(projet.budget_estime != null || projet.description) && (
          <div className="space-y-2 rounded-[10px] border border-border bg-card p-4 text-sm">
            <h3 className="font-semibold text-foreground">La demande</h3>
            {projet.budget_estime != null && (
              <p className="text-muted-foreground">
                Budget estimé :{' '}
                <span className="montant font-medium text-foreground">
                  {formatEuros(projet.budget_estime)}
                </span>
              </p>
            )}
            {projet.description && (
              <p className="whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
                {projet.description}
              </p>
            )}
          </div>
        )}

        {/* Pièces jointes partagées par l'agence : devis déjà établi, photos,
            vidéos envoyées par le client. Volontairement HORS du mur « contrat
            signé » — c'est précisément ce qui permet de juger si le chantier
            vaut le déplacement, et rien là-dedans n'identifie le client (les
            coordonnées, elles, restent verrouillées ci-dessous). */}
        <DocumentsPartages token={projet.token} />

        {!signe ? (
          <div className="rounded-[10px] border border-border bg-card p-5 text-center">
            <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Lock className="size-5" />
            </span>
            <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
              Signez le contrat pour accéder aux coordonnées du client et déposer votre devis.
            </p>
            <Button asChild className="mt-4 min-h-11">
              <a href="#contrat">Signer le contrat</a>
            </Button>
          </div>
        ) : (
          <div className={cn('grid min-w-0 gap-6', encadre && 'xl:grid-cols-2 xl:items-start')}>
            {/* Colonne gauche : client + suivi */}
            <div className="min-w-0 space-y-6">
              <div className="min-w-0 space-y-3">
                <SousTitre icon={Phone}>Client</SousTitre>
                {/* Coordonnées client (éditables sauf le téléphone) */}
                <ClientBloc projet={projet} adresse={adresse} onChange={onChange} />

                {/* Photos, vidéos et devis PDF déposés par l'agence : de quoi
                    chiffrer sans se déplacer. */}
                {projet.photos?.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {projet.photos.map((url) => (
                      <VignettePiece key={url} url={url} />
                    ))}
                  </div>
                )}
              </div>

              <div className="min-w-0 space-y-3">
                <SousTitre icon={Clock}>Avancement</SousTitre>
                {/* Suivi (statut + notes) */}
                <SuiviArtisan
                  token={projet.token}
                  suivis={projet.suivis ?? []}
                  onChange={onChange}
                  statutActuel={projet.statut}
                  rappelLe={projet.rappel_le}
                  dateRdv={projet.date_rdv}
                  enAttenteDepuis={projet.en_attente_depuis}
                  montantSigne={projet.montant_devis_signe}
                  devisSigneDepose={projet.devis_signe_depose}
                  commissionEncaissee={projet.commission_encaissee}
                  montantDevis={projet.montant_devis}
                  devisDepose={!!projet.devis_url}
                />
              </div>
            </div>

            {/* Colonne droite : documents */}
            <div className="min-w-0 space-y-3">
              <SousTitre icon={FileText}>Documents</SousTitre>
              {/* Avant de chiffrer : les quantités. La photo aérienne s'ouvre
                  sur ce chantier, le bâtiment déjà tracé avec sa hauteur. */}
              {onMesurer && (
                <Button
                  variant="outline"
                  className="min-h-11 w-full"
                  onClick={() => onMesurer(projet)}
                >
                  <Ruler className="size-4" />
                  Mesurer sur la carte
                </Button>
              )}
              {onCreerDevis && (
                <Button
                  className="min-h-11 w-full"
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
                url={projet.devis_url}
                montantInitial={projet.montant_devis}
                onDone={onChange}
              />
              <UploadDevis
                token={projet.token}
                slot="devis_signe"
                label="Devis signé par le client"
                depose={projet.devis_signe_depose}
                url={projet.devis_signe_url}
                montantInitial={projet.montant_devis_signe}
                onDone={onChange}
              />
            </div>
          </div>
        )}

        {/* Retrait volontaire. Disponible même contrat non signé : un artisan
            qui ne veut pas du dossier n'a pas à signer pour le décliner.
            Masqué sur un chantier terminé, où le retrait n'a plus de sens. */}
        {projet.statut !== 'termine' && (
          <div className="flex justify-end border-t border-border pt-3">
            <RetraitChantierDialog token={projet.token} onRetire={onChange} />
          </div>
        )}
      </div>
  )
}

// Mini-en-tête de sous-section dans un chantier déplié.
function SousTitre({ icon: Icon, children }: { icon: typeof Phone; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <Icon className="size-4 text-muted-foreground" />
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
  const champId = useId()
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
      <div className="space-y-3 rounded-[10px] border border-border bg-card p-4 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor={`${champId}-nom`} className="text-xs">Nom du client</Label>
          <Input id={`${champId}-nom`} className="h-11" value={f.nom} onChange={(e) => maj('nom', e.target.value)} />
        </div>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="mr-1 inline size-3" />
          Téléphone (non modifiable) : <strong>{formatTel(projet.client_telephone ?? '')}</strong>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${champId}-email`} className="text-xs">Email</Label>
          <Input id={`${champId}-email`} className="h-11" value={f.email} onChange={(e) => maj('email', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${champId}-adresse`} className="text-xs">Adresse</Label>
          <Input id={`${champId}-adresse`} className="h-11" value={f.adresse} onChange={(e) => maj('adresse', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${champId}-cp`} className="text-xs">Code postal</Label>
            <Input id={`${champId}-cp`} className="h-11" value={f.cp} onChange={(e) => maj('cp', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor={`${champId}-ville`} className="text-xs">Ville</Label>
            <Input id={`${champId}-ville`} className="h-11" value={f.ville} onChange={(e) => maj('ville', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${champId}-budget`} className="text-xs">Budget estimé (€)</Label>
          <Input
            id={`${champId}-budget`}
            type="number"
            className="h-11"
            value={f.budget}
            onChange={(e) => maj('budget', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${champId}-description`} className="text-xs">Description / notes</Label>
          <Textarea
            id={`${champId}-description`}
            rows={3}
            value={f.description}
            onChange={(e) => maj('description', e.target.value)}
          />
        </div>
        <div className="grid gap-2 pt-1 sm:grid-cols-2">
          <Button variant="outline" className="min-h-11" onClick={() => setEdition(false)} disabled={saving}>
            <X className="size-4" />
            Annuler
          </Button>
          <Button className="min-h-11" onClick={enregistrer} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Enregistrer
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-[10px] border border-border bg-card p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words pt-2.5 text-base font-semibold">
          {projet.client_nom}
        </p>
        <Button variant="ghost" size="sm" className="min-h-11 shrink-0" onClick={() => setEdition(true)}>
          <Pencil className="size-4" />
          Modifier
        </Button>
      </div>
      {projet.client_telephone && (
        <Button asChild className="min-h-11 w-full">
          <a href={`tel:${projet.client_telephone}`}>
            <Phone className="size-4" />
            Appeler {formatTel(projet.client_telephone)}
          </a>
        </Button>
      )}
      {projet.client_email && (
        <a
          href={`mailto:${projet.client_email}`}
          className="flex min-h-11 items-center gap-3 rounded-md break-all text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
            <Mail className="size-4" />
          </span>
          {projet.client_email}
        </a>
      )}
      {adresse && (
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
            <MapPin className="size-4" />
          </span>
          <span className="min-w-0 break-words pt-1.5">{adresse}</span>
        </div>
      )}
    </div>
  )
}
