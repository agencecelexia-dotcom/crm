import { useId, useRef, useState } from 'react'
import { FileText, Upload, Loader2, CheckCircle2, Check, Eye } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase/client'
import { uploaderDevis } from '@/lib/storage'
import { extraireMontantDevis } from '@/lib/pdf-extract'
import { cn } from '@/lib/utils'
import { useDropzone } from '@/hooks/use-dropzone'

// Dépôt d'un PDF (devis / devis signé) + saisie du MONTANT (TTC).
// `token` = token du PROJET. Le montant du devis signé alimente la commission.
export function UploadDevis({
  token,
  slot,
  label,
  depose,
  url,
  montantInitial,
  onDone,
}: {
  token: string
  slot: 'devis' | 'devis_signe'
  label: string
  depose: boolean
  /** URL du PDF déjà déposé, pour que l'artisan puisse le relire. */
  url?: string | null
  montantInitial?: number | null
  onDone: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const depotEnCours = useRef(false)
  const montantId = useId()
  const [envoi, setEnvoi] = useState(false)
  const [montant, setMontant] = useState(montantInitial != null ? String(montantInitial) : '')
  const [majMontant, setMajMontant] = useState(false)

  async function enregistrerMontant(silencieux = false, valeurOverride?: string) {
    const n = parseFloat((valeurOverride ?? montant).replace(',', '.'))
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
      if (!silencieux) toast.error('Montant invalide', { description: 'Indiquez un montant entre 0 et 10 000 000 €.' })
      return false
    }
    setMajMontant(true)
    try {
      const { data, error } = await supabase.rpc('set_montant_by_token', {
        p_token: token,
        p_slot: slot,
        p_montant: n,
      })
      if (error || !(data as { ok?: boolean })?.ok) throw new Error('Échec')
      if (!silencieux) toast.success('Montant enregistré')
      onDone()
      return true
    } catch {
      if (!silencieux) toast.error("Impossible d'enregistrer le montant")
      return false
    } finally {
      setMajMontant(false)
    }
  }

  async function traiter(file: File) {
    if (depotEnCours.current) return
    if ((file.type && file.type !== 'application/pdf') || !/\.pdf$/i.test(file.name)) {
      toast.error('Format PDF uniquement')
      return
    }
    if (file.size > 10_000_000) { toast.error('PDF trop volumineux', { description: '10 Mo maximum.' }); return }
    depotEnCours.current = true
    setEnvoi(true)
    // Si aucun montant n'est déjà saisi, on tente de le lire dans le PDF en
    // parallèle de l'upload (échec silencieux — jamais bloquant, jamais d'erreur affichée).
    const extraction = montant.trim() ? Promise.resolve(null) : extraireMontantDevis(file)
    try {
      // Upload dans le bucket dédié (lien imprévisible) puis enregistrement sur l'affectation.
      const url = await uploaderDevis(token, slot, file)
      const { data, error } = await supabase.rpc('set_devis_by_token', {
        p_token: token,
        p_slot: slot,
        p_url: url,
      })
      if (error || !(data as { ok?: boolean })?.ok) throw new Error('Envoi impossible')

      const montantDetecte = await extraction
      let montantEnregistre = true
      if (montantDetecte != null && !montant.trim()) {
        // Montant lu automatiquement dans le PDF : pré-rempli et enregistré, comme une saisie manuelle.
        setMontant(String(montantDetecte).replace('.', ','))
        montantEnregistre = await enregistrerMontant(true, String(montantDetecte))
      } else if (montant.trim()) {
        // Enregistre aussi le montant saisi, le cas échéant (mécaniquement).
        montantEnregistre = await enregistrerMontant(true)
      }
      if (montantEnregistre) toast.success(`${label} reçu`)
      else toast.warning('PDF reçu, montant non enregistré', { description: 'Vérifiez le montant et réessayez son enregistrement. Le PDF est conservé.' })
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      depotEnCours.current = false
      setEnvoi(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const { dragActive, handlers } = useDropzone(traiter)

  return (
    <div className="min-w-0 space-y-4 rounded-[10px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex min-w-0 flex-1 basis-40 items-start gap-2 text-sm font-semibold">
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="break-words">{label}</span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Relire le PDF déposé. Sans ce bouton, l'artisan ne pouvait que le
              remplacer à l'aveugle, sans vérifier ce qu'il avait envoyé. */}
          {depose && url && (
            <Button size="sm" variant="outline" className="min-h-11 bg-card" asChild>
              <a href={url} target="_blank" rel="noopener">
                <Eye className="size-3.5" />
                Voir
              </a>
            </Button>
          )}
          {depose && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="size-3.5" /> Reçu
            </span>
          )}
        </div>
      </div>

      {/* Montant TTC */}
      <div className="space-y-2">
        <Label htmlFor={montantId} className="text-xs text-muted-foreground">Montant TTC</Label>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Input
              id={montantId}
              type="number"
              min={0}
              max={10_000_000}
              disabled={envoi || majMontant}
              inputMode="decimal"
              placeholder="Montant TTC"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              className="h-11 pr-7"
              aria-label={`Montant TTC — ${label}`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="size-11 shrink-0"
            onClick={() => void enregistrerMontant()}
            disabled={envoi || majMontant || !montant.trim()}
            aria-label="Enregistrer le montant"
          >
            {majMontant ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
        Détecté automatiquement à partir du PDF si possible — modifiable à tout moment. Le PDF n'est
        pas obligatoire si vous connaissez déjà le montant.
      </p>

      {/* Dépôt du PDF — zone drag & drop */}
      <div
        {...handlers}
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 transition-colors',
          dragActive
            ? 'border-primary bg-primary/5'
            : 'border-input bg-muted/20 hover:border-muted-foreground/50',
        )}
      >
        <Upload className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          {dragActive
            ? 'Déposez le PDF ici…'
            : depose
              ? 'Document reçu par Celexia'
              : 'PDF, 10 Mo maximum. Glissez le fichier ici, ou'}
        </p>
        <Button variant="outline" className="min-h-11 w-full bg-card" onClick={() => inputRef.current?.click()} disabled={envoi}>
          {envoi ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {depose ? 'Remplacer le document' : 'Choisir un PDF'}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void traiter(f)
        }}
      />
    </div>
  )
}
