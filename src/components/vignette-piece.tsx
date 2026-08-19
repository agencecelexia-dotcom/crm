import { FileText, Music, Play } from 'lucide-react'

import { cn } from '@/lib/utils'
import { categorieDe } from '@/lib/fichiers'

/**
 * Vignette d'une pièce de chantier — image, vidéo, PDF ou autre.
 *
 * Partagée entre la fiche agence et l'espace artisan : une balise `<img>`
 * appliquée à un PDF n'affiche qu'une image cassée, et deux rendus séparés
 * auraient fini par diverger.
 *
 * La catégorie se déduit de l'extension : ces pièces sont stockées comme un
 * simple tableau d'URL, sans type MIME associé.
 */
export function VignettePiece({
  url,
  className,
  children,
}: {
  url: string
  className?: string
  /** Superposition optionnelle — bouton de suppression côté agence. */
  children?: React.ReactNode
}) {
  const nom = decodeURIComponent(url.split('/').pop() ?? '')
  const categorie = categorieDe(nom, null)

  return (
    <div
      className={cn(
        'group relative aspect-square overflow-hidden rounded-xl border border-border',
        className,
      )}
    >
      {categorie === 'image' ? (
        <a href={url} target="_blank" rel="noopener" className="block size-full">
          <img src={url} alt={nom} className="size-full object-cover" />
        </a>
      ) : categorie === 'video' ? (
        // Lecteur en place : un aperçu de toiture se regarde sans télécharger.
        <video src={url} controls preload="metadata" className="size-full bg-black object-cover">
          <a href={url}>Télécharger la vidéo</a>
        </video>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener"
          className="flex size-full flex-col items-center justify-center gap-1.5 bg-muted/40 p-2 text-center transition-colors hover:bg-accent"
        >
          {categorie === 'pdf' ? (
            <FileText className="size-7 text-[#DC2626]" />
          ) : categorie === 'audio' ? (
            <Music className="size-7 text-muted-foreground" />
          ) : (
            <Play className="size-7 text-muted-foreground" />
          )}
          <span className="line-clamp-2 break-all text-[11px] leading-tight text-muted-foreground">
            {nom}
          </span>
        </a>
      )}
      {children}
    </div>
  )
}
