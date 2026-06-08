import { useRef, useState } from 'react'
import { FileText, Upload, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useDropzone } from '@/hooks/use-dropzone'

// Zone de dépôt d'un PDF (devis / devis signé) → Edge Function upload-devis.
// `token` = token du PROJET (la fonction valide token → projet).
export function UploadDevis({
  token,
  slot,
  label,
  depose,
  onDone,
}: {
  token: string
  slot: 'devis' | 'devis_signe'
  label: string
  depose: boolean
  onDone: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [envoi, setEnvoi] = useState(false)

  async function traiter(file: File) {
    if (file.type && !file.type.includes('pdf')) {
      toast.error('Format PDF uniquement')
      return
    }
    setEnvoi(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
        fr.onerror = reject
        fr.readAsDataURL(file)
      })
      const { data, error } = await supabase.functions.invoke('upload-devis', {
        body: { token, slot, filename: file.name, base64 },
      })
      if (error || !(data as { ok?: boolean })?.ok) throw new Error('Envoi impossible')
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
    <div
      {...handlers}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-colors',
        dragActive ? 'border-primary border-dashed bg-primary/5' : 'border-border',
      )}
    >
      <FileText className={depose ? 'size-5 text-primary' : 'size-5 text-muted-foreground'} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {dragActive ? (
            'Déposez le PDF ici…'
          ) : depose ? (
            <>
              <CheckCircle2 className="size-3 text-[#22C55E]" /> Reçu par Celexia
            </>
          ) : (
            'Glissez un PDF ici ou cliquez'
          )}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={envoi}>
        {envoi ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {depose ? 'Remplacer' : 'Déposer'}
      </Button>
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
