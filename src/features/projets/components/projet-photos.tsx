import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { Button } from '@/components/ui/button'
import { formatAutorise } from '@/lib/fichiers'
import { VignettePiece } from '@/components/vignette-piece'
import { uploaderPhoto, supprimerPhoto } from '@/lib/storage'
import { usePatchProjet } from '../hooks/use-projets'
import type { ProjetAvecArtisan } from '@/types/database'

/**
 * Pièces du chantier déposées par l'agence — visibles par l'artisan après
 * signature.
 *
 * Historiquement limité aux images. Or ce qui aide vraiment l'artisan à
 * chiffrer avant de se déplacer, c'est aussi la vidéo d'une pièce à rénover
 * ou le devis PDF qu'un confrère a déjà produit. Les deux filtres qui
 * bloquaient — l'attribut `accept` et le test `type.startsWith('image/')` —
 * sont levés ; seuls les exécutables restent refusés.
 *
 * Le stockage ne change pas : `projets.photos` reste un tableau d'URL
 * publiques, qui n'a jamais rien eu de spécifique aux images.
 */
export function ProjetPhotos({ projet }: { projet: ProjetAvecArtisan }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const patch = usePatchProjet()
  const [busy, setBusy] = useState(false)
  const pieces = projet.photos ?? []

  async function ajouter(files: FileList) {
    setBusy(true)
    try {
      const liste = Array.from(files)
      const refuses = liste.filter((f) => !formatAutorise(f))
      if (refuses.length) {
        toast.error(refuses.length > 1 ? `${refuses.length} fichiers ignorés` : 'Fichier ignoré', {
          description: 'Les programmes et scripts ne peuvent pas être joints.',
        })
      }

      const urls: string[] = []
      for (const f of liste.filter(formatAutorise)) {
        urls.push(await uploaderPhoto(projet.id, f))
      }
      if (urls.length) {
        await patch.mutateAsync({ id: projet.id, patch: { photos: [...pieces, ...urls] } })
        toast.success(urls.length > 1 ? `${urls.length} pièces ajoutées` : 'Pièce ajoutée')
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
      await patch.mutateAsync({ id: projet.id, patch: { photos: pieces.filter((p) => p !== url) } })
      void supprimerPhoto(url)
      toast.success('Pièce supprimée')
    } catch (e) {
      toast.error('Suppression impossible', { description: e instanceof Error ? e.message : undefined })
    }
  }

  return (
    <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitre>Photos et documents du chantier</CardTitre>
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          Ajouter
        </Button>
        <input
          ref={inputRef}
          type="file"
          // Pas d'attribut `accept` : photos, vidéos et PDF sont tous
          // acceptés. `formatAutorise` écarte les exécutables au dépôt.
          multiple
          className="hidden"
          onChange={(e) => e.target.files && ajouter(e.target.files)}
        />
      </CardHeader>
      <CardContent>
        {pieces.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune pièce. Ajoutez photos, vidéos ou devis PDF : l'artisan les verra après
            signature, et pourra chiffrer sans se déplacer.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {pieces.map((url) => (
              <VignettePiece key={url} url={url}>
                <button
                  type="button"
                  onClick={() => retirer(url)}
                  aria-label="Supprimer"
                  className="absolute right-1 top-1 z-10 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </VignettePiece>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
