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
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">{label}</p>

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
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void enregistrerMontant()}
          disabled={majMontant || !montant.trim()}
          aria-label="Enregistrer le montant"
        >
          {majMontant ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </Button>
      </div>

      {/* Dépôt du PDF */}
      <div
        {...handlers}
        className={cn(
          'flex items-center gap-3 rounded-lg border p-3 transition-colors',
          dragActive ? 'border-primary border-dashed bg-primary/5' : 'border-border',
        )}
      >
        <FileText className={depose ? 'size-5 text-primary' : 'size-5 text-muted-foreground'} />
        <p className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
          {dragActive ? (
            'Déposez le PDF ici…'
          ) : depose ? (
            <>
              <CheckCircle2 className="size-3 text-[#22C55E]" /> Reçu par Celexia
            </>
          ) : (
            'Glissez le PDF ou cliquez'
          )}
        </p>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={envoi}>
          {envoi ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {depose ? 'Remplacer' : 'Déposer'}
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
