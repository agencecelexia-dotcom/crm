import { useState } from 'react'
import { LogOut, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MOTIFS_PERTE, motifDef, type MotifPerte } from '@/lib/motifs-perte'
import { supabase } from '@/lib/supabase/client'

/** Longueur minimale de la justification — doit rester alignée sur la garde
 *  serveur de `retirer_chantier_by_token` (migration 0061). */
const RAISON_MIN = 5

/**
 * Retrait volontaire d'un artisan d'un chantier, depuis son espace.
 *
 * Double garde-fou contre le mauvais clic :
 *   1. l'action ouvre une fenêtre de confirmation dédiée ;
 *   2. la confirmation reste désactivée tant qu'une raison n'est pas écrite.
 * Un simple « êtes-vous sûr ? » se valide d'un second clic réflexe ; devoir
 * taper un texte rend la validation accidentelle quasi impossible — et donne
 * à l'agence l'information dont elle a besoin pour réattribuer le dossier.
 *
 * Ne supprime jamais le projet : seule l'affectation de cet artisan est retirée.
 */
export function RetraitChantierDialog({
  token,
  onRetire,
}: {
  /** Token de l'AFFECTATION (pas du projet, pas de l'artisan). */
  token: string
  /** Appelé après un retrait réussi, pour rafraîchir l'espace. */
  onRetire: () => void
}) {
  const [ouvert, setOuvert] = useState(false)
  const [raison, setRaison] = useState('')
  const [motif, setMotif] = useState<MotifPerte | ''>('')
  const [recontacterLe, setRecontacterLe] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const def = motifDef(motif)
  const raisonValide = raison.trim().length >= RAISON_MIN && motif !== ''

  async function confirmer() {
    if (!raisonValide || envoi) return
    setEnvoi(true)
    try {
      const { data, error } = await supabase.rpc('retirer_chantier_by_token', {
        p_token: token,
        p_raison: raison.trim(),
        p_motif: motif,
        p_recontacter_le: recontacterLe || null,
      })
      const r = data as { ok?: boolean; error?: string } | null
      if (error || !r?.ok) {
        // Les garde-fous métier (0077) doivent être compréhensibles : un
        // message générique laisserait croire à une panne alors que le refus
        // est volontaire.
        const messages: Record<string, string> = {
          justification_requise: 'Merci de préciser la raison en quelques mots.',
          motif_requis: 'Choisissez un motif dans la liste.',
          devis_signe_depose:
            'Impossible : le devis signé est déjà déposé sur ce chantier. Contactez Celexia.',
          commission_encaissee:
            'Impossible : la commission de ce chantier est déjà réglée. Contactez Celexia.',
          affaire_signee:
            'Impossible : ce chantier est signé. Contactez Celexia pour l’annuler.',
          introuvable: 'Chantier introuvable.',
        }
        throw new Error(
          (r?.error && messages[r.error]) || "Le retrait n'a pas pu être enregistré.",
        )
      }
      toast.success('Chantier retiré', {
        description: 'Celexia a été prévenu et va réattribuer le dossier.',
      })
      setOuvert(false)
      setRaison('')
      setMotif('')
      setRecontacterLe('')
      onRetire()
    } catch (e) {
      toast.error('Retrait impossible', {
        description: e instanceof Error ? e.message : 'Réessayez ou contactez Celexia.',
      })
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOuvert(true)}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut className="size-4" />
        Me retirer de ce chantier
      </Button>

      <AlertDialog
        open={ouvert}
        onOpenChange={(o) => {
          // Ne jamais fermer pendant l'envoi : évite un état ambigu.
          if (envoi) return
          setOuvert(o)
          if (!o) { setRaison(''); setMotif(''); setRecontacterLe('') }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="size-5" />
              </span>
              Vous retirer de ce chantier ?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Ce chantier disparaîtra de votre espace et vous n'aurez plus accès aux
                  coordonnées du client. Celexia sera prévenu et le réattribuera.
                </p>
                <p className="font-medium text-foreground">Cette action est définitive.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="motif-retrait">
              Pourquoi ce chantier est-il perdu ? <span className="text-destructive">*</span>
            </Label>
            <Select value={motif} onValueChange={(v) => setMotif(v as MotifPerte)}>
              <SelectTrigger id="motif-retrait" className="h-11">
                <SelectValue placeholder="Choisir un motif" />
              </SelectTrigger>
              <SelectContent>
                {MOTIFS_PERTE.map((m) => (
                  <SelectItem key={m.cle} value={m.cle}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {def?.origine === 'artisan' && (
              <p className="text-xs text-muted-foreground">
                Ce motif nous aide à mieux cibler les chantiers que nous vous envoyons.
              </p>
            )}
          </div>

          {/* Relance différée : sans ce champ, les « rappeler dans 6 mois »
              se perdaient en note libre et le chantier ne revenait jamais. */}
          {def?.relancable && (
            <div className="space-y-2">
              <Label htmlFor="recontacter-le">À recontacter le (facultatif)</Label>
              <Input
                id="recontacter-le"
                type="date"
                className="h-11"
                value={recontacterLe}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setRecontacterLe(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Le chantier vous sera resignalé à cette date.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="raison-retrait">
              Pourquoi vous retirez-vous ? <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="raison-retrait"
              value={raison}
              onChange={(e) => setRaison(e.target.value)}
              placeholder="Ex. : trop loin de mon secteur, planning complet, chantier hors de ma spécialité…"
              rows={3}
              autoFocus
              disabled={envoi}
            />
            <p className="text-xs text-muted-foreground">
              {motif === ''
                ? 'Choisissez d’abord un motif.'
                : raisonValide
                  ? 'Merci, cette précision aide Celexia à mieux vous orienter.'
                  : `Écrivez au moins ${RAISON_MIN} caractères pour confirmer.`}
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={envoi}>Annuler</AlertDialogCancel>
            {/* Bouton simple (pas AlertDialogAction) : celui-ci ferme la fenêtre
                automatiquement au clic, ce qui masquerait une erreur serveur. */}
            <Button
              type="button"
              variant="destructive"
              disabled={!raisonValide || envoi}
              onClick={() => void confirmer()}
            >
              {envoi ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Retrait en cours…
                </>
              ) : (
                'Confirmer le retrait'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
