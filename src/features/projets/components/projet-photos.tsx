import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { Button } from '@/components/ui/button'
import { uploaderPhoto, supprimerPhoto } from '@/lib/storage'
import { usePatchProjet } from '../hooks/use-projets'
import type { ProjetAvecArtisan } from '@/types/database'

// Photos du chantier (agence) — visibles par l'artisan après signature.
export function ProjetPhotos({ projet }: { projet: ProjetAvecArtisan }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const patch = usePatchProjet()
  const [busy, setBusy] = useState(false)
  const photos = projet.photos ?? []

  async function ajouter(files: FileList) {
    setBusy(true)
    try {
      const urls: string[] = []
      for (const f of Array.from(files)) {
        if (!f.type.startsWith('image/')) continue
        urls.push(await uploaderPhoto(projet.id, f))
      }
      if (urls.length) {
        await patch.mutateAsync({ id: projet.id, patch: { photos: [...photos, ...urls] } })
        toast.success(`${urls.length} photo(s) ajoutée(s)`)
      }
    } catch (e) {
      toast.error('Ajout impossible', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function retirer(url: string) {
    try {
      await patch.mutateAsync({ id: projet.id, patch: { photos: photos.filter((p) => p !== url) } })
      void supprimerPhoto(url)
      toast.success('Photo supprimée')
    } catch (e) {
      toast.error('Suppression impossible', { description: e instanceof Error ? e.message : undefined })
    }
  }

  return (
    <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitre>Photos du chantier</CardTitre>
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          Ajouter
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && ajouter(e.target.files)}
        />
      </CardHeader>
      <CardContent>
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune photo. Ajoute des photos du chantier : l'artisan les verra après signature.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((url) => (
              <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                <a href={url} target="_blank" rel="noopener" className="block size-full">
                  <img src={url} alt="Photo chantier" className="size-full object-cover" />
                </a>
                <button
                  type="button"
                  onClick={() => retirer(url)}
                  aria-label="Supprimer"
                  className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
