import { useRef, useState } from 'react'
import { FileText, Upload, Eye, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { uploaderDocument, urlSignee, type TypeDocument } from '@/lib/storage'
import { usePatchProjet } from '../hooks/use-projets'
import type { ProjetInput } from '@/types/database'

// Une ligne de document : upload (PDF) vers le bucket privé + consultation signée.
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

  async function onFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
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
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <FileText
        className={cheminActuel ? 'size-5 text-primary' : 'size-5 text-muted-foreground'}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {cheminActuel ? (
            <>
              <CheckCircle2 className="size-3 text-[#22C55E]" />
              Document présent
            </>
          ) : (
            'Aucun fichier'
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
        onChange={onFichier}
      />
    </div>
  )
}
