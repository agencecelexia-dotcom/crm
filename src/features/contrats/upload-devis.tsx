import { useRef, useState } from 'react'
import { FileText, Upload, Loader2, CheckCircle2, Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase/client'
import { uploaderDevis } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { useDropzone } from '@/hooks/use-dropzone'

// Dépôt d'un PDF (devis / devis signé) + saisie du MONTANT (TTC).
// `token` = token du PROJET. Le montant du devis signé alimente la commission.
export function UploadDevis({
  token,
  slot,
  label,
  depose,
  montantInitial,
  onDone,
}: {
  token: string
  slot: 'devis' | 'devis_signe'
  label: string
  depose: boolean
  montantInitial?: number | null
  onDone: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [envoi, setEnvoi] = useState(false)
  const [montant, setMontant] = useState(montantInitial != null ? String(montantInitial) : '')
  const [majMontant, setMajMontant] = useState(false)

  async function enregistrerMontant(silencieux = false) {
    const n = parseFloat(montant.replace(',', '.'))
    if (isNaN(n)) {
      if (!silencieux) toast.error('Montant invalide')
      return
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
    } catch {
      if (!silencieux) toast.error("Impossible d'enregistrer le montant")
    } finally {
      setMajMontant(false)
    }
  }

  async function traiter(file: File) {
    if (file.type && !file.type.includes('pdf')) {
      toast.error('Format PDF uniquement')
      return
    }
    setEnvoi(true)
    try {
      // Upload dans le bucket dédié (lien imprévisible) puis enregistrement sur l'affectation.
      const url = await uploaderDevis(token, slot, file)
      const { data, error } = await supabase.rpc('set_devis_by_token', {
        p_token: token,
        p_slot: slot,
        p_url: url,
      })
      if (error || !(data as { ok?: boolean })?.ok) throw new Error('Envoi impossible')
      // Enregistre aussi le montant saisi, le cas échéant (mécaniquement).
      if (montant.trim()) await enregistrerMontant(true)
      toast.success(`${label} envoyé`)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setEnvoi(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const { dragActive, handlers } = useDropzone(traiter)

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {depose && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-xs font-medium text-[#16A34A]">
            <CheckCircle2 className="size-3" /> Reçu
          </span>
        )}
      </div>

      {/* Montant TTC */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Montant TTC"
            value={montant}
            onChange={(e) => setMontant(e.target.value)}
            className="h-10 pr-7"
            aria-label={`Montant TTC — ${label}`}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-10"
          onClick={() => void enregistrerMontant()}
          disabled={majMontant || !montant.trim()}
          aria-label="Enregistrer le montant"
        >
          {majMontant ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </Button>
      </div>

      {/* Dépôt du PDF — zone drag & drop */}
      <div
        {...handlers}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors',
          dragActive
            ? 'border-primary bg-primary/5'
            : depose
              ? 'border-[#22C55E]/40 bg-[#22C55E]/5'
              : 'border-input bg-muted/30 hover:border-primary/40 hover:bg-muted/50',
        )}
      >
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-full',
            depose ? 'bg-[#22C55E]/15 text-[#16A34A]' : 'bg-primary/10 text-primary',
          )}
        >
          <FileText className="size-5" />
        </span>
        <p className="text-xs text-muted-foreground">
          {dragActive
            ? 'Déposez le PDF ici…'
            : depose
              ? 'Document reçu par Celexia'
              : 'Glissez votre PDF ici, ou'}
        </p>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={envoi}>
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
