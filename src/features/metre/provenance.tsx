import { useState } from 'react'
import { Info } from 'lucide-react'

/**
 * « D'où vient ce chiffre ? » : un appui déplie la provenance, un autre la
 * replie. Chaque ligne est un fait qu'on peut vérifier — la source, la date du
 * vol, le nombre de points, ce qui a été recalé, la précision.
 */
export function Provenance({ lignes, libelle = 'D’où vient ce chiffre ?' }: { lignes: string[]; libelle?: string }) {
  const [ouvert, setOuvert] = useState(false)
  if (!lignes.length) return null
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex min-h-9 items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Info className="size-3.5" />
        {libelle}
      </button>
      {ouvert && (
        <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-2.5 leading-snug text-muted-foreground">
          {lignes.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
