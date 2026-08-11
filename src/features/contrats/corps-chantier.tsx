import { useState, type ReactNode } from 'react'
import {
  Clock, FileText, FilePlus, Loader2, Lock, Mail, MapPin, Pencil, Phone, Save, X,
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
  encadre = true,
}: {
  projet: ProjetEspace
  signe: boolean
  adresse: string
  onChange: () => void
  onCreerDevis?: (p: ProjetEspace) => void
  /** false dans le drawer, qui gère lui-même ses marges. */
  encadre?: boolean
}) {
  return (
      <div className={cn('space-y-5', encadre && 'border-t border-border p-4 pl-5 sm:p-5 sm:pl-6')}>
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
          <Label className="text-xs">Nom du client</Label>
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
