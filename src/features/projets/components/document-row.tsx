import { useRef, useState } from 'react'
import { FileText, Upload, Eye, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDropzone } from '@/hooks/use-dropzone'
import { uploaderDocument, urlSignee, type TypeDocument } from '@/lib/storage'
import { usePatchProjet } from '../hooks/use-projets'
import type { ProjetInput } from '@/types/database'

// Une ligne de document : upload (PDF) par clic OU glisser-déposer + consultation signée.
export function DocumentRow({
  projetId,
  type,
  label,
  champ,
  cheminActuel,
}: {
  projetId: string
  type: TypeDocument
  label: string
  champ: keyof Pick<ProjetInput, 'contrat_url' | 'devis_url' | 'devis_signe_url'>
  cheminActuel: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const patch = usePatchProjet()
  const [uploading, setUploading] = useState(false)
  const [ouverture, setOuverture] = useState(false)

  // Logique d'upload partagée (clic + drop)
  async function traiter(file: File) {
    if (file.type && !file.type.includes('pdf')) {
      toast.error('Format PDF uniquement')
      return
    }
    setUploading(true)
    try {
      const chemin = await uploaderDocument(projetId, type, file)
      await patch.mutateAsync({ id: projetId, patch: { [champ]: chemin } })
      toast.success(`${label} ajouté`)
    } catch (err) {
      toast.error('Upload impossible', {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const { dragActive, handlers } = useDropzone(traiter)

  async function consulter() {
    setOuverture(true)
    try {
      const url = await urlSignee(cheminActuel)
      if (url) window.open(url, '_blank', 'noopener')
      else toast.error('Document introuvable')
    } finally {
      setOuverture(false)
    }
  }

  return (
    <div
      {...handlers}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-colors',
        dragActive ? 'border-primary border-dashed bg-primary/5' : 'border-border',
      )}
    >
      <FileText
        className={cheminActuel ? 'size-5 text-primary' : 'size-5 text-muted-foreground'}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {dragActive ? (
            'Déposez le PDF ici…'
          ) : cheminActuel ? (
            <>
              <CheckCircle2 className="size-3 text-[#22C55E]" />
              Document présent
            </>
          ) : (
            'Aucun fichier — glissez un PDF ou cliquez'
          )}
        </p>
      </div>

      {cheminActuel && (
        <Button variant="ghost" size="icon" onClick={consulter} disabled={ouverture} aria-label="Voir">
          {ouverture ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {cheminActuel ? 'Remplacer' : 'Ajouter'}
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
