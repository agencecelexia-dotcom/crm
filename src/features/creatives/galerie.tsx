import { useEffect, useState } from 'react'
import { AlertTriangle, Download, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { ImageIcon } from './icone'
import { cn } from '@/lib/utils'
import { formatDateHeure } from '@/lib/format'
import { urlFichier, type Creative } from './use-creatives'

/**
 * Les visuels produits.
 *
 * Le bucket est privé : chaque vignette demande une URL signée, valable une
 * heure. Un bucket public exposerait les créatives de l'agence à qui devine
 * l'adresse.
 */
export function Galerie({ creatives }: { creatives: Creative[] }) {
  if (creatives.length === 0) {
    return (
      <EmptyState
        icon={ImageIcon}
        titre="Aucun visuel"
        description="Décrivez ce que vous voulez voir, puis lancez une génération."
      />
    )
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {creatives.map((c) => (
        <li key={c.id}>
          <Vignette creative={c} />
        </li>
      ))}
    </ul>
  )
}

function Vignette({ creative: c }: { creative: Creative }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let annule = false
    if (c.statut !== 'reussi' || c.fichiers.length === 0) return
    void urlFichier(c.fichiers[0]).then((u) => {
      if (!annule) setUrl(u)
    })
    return () => {
      annule = true
    }
  }, [c.statut, c.fichiers])

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        className={cn(
          'flex aspect-square items-center justify-center bg-muted/40',
          c.statut === 'echoue' && 'bg-destructive/5',
        )}
      >
        {c.statut === 'en_cours' && (
          <div className="text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
            <p className="mt-1.5 text-xs text-muted-foreground">Génération…</p>
          </div>
        )}
        {c.statut === 'echoue' && (
          <div className="px-4 text-center">
            <AlertTriangle className="mx-auto size-5 text-destructive" />
            <p className="mt-1.5 text-xs text-destructive">{c.erreur ?? 'Échec'}</p>
          </div>
        )}
        {c.statut === 'reussi' &&
          (url ? (
            <img
              src={url}
              alt={c.prompt ?? 'Visuel généré'}
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ))}
      </div>

      <div className="p-3">
        <p className="line-clamp-2 text-sm">{c.prompt ?? '—'}</p>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {c.modele.split('/').slice(-2).join('/')}
            {c.format && ` · ${c.format}`}
          </span>
          {url && (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
              <a href={url} download target="_blank" rel="noreferrer">
                <Download className="size-3.5" />
              </a>
            </Button>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDateHeure(c.created_at)}
        </p>
      </div>
    </div>
  )
}
