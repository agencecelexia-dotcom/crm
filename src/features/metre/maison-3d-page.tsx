import { useEffect, useState } from 'react'
import { Box, Loader2, MapPin, Search } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/page-header'
import { cn } from '@/lib/utils'
import { Maison3D } from './maison-3d'
import { useMaisonAgence, type MaisonChantier } from './use-batiment-chantier'
import { chercherAdresse, type Adresse } from './use-metres'

/** Ce que dit la désignation de la maison, quand elle n'est pas sûre. */
function Avertissement({ m }: { m: MaisonChantier }) {
  if (m.confiance === 'officielle' || m.confiance === 'confirmee') return null
  return (
    <p className="rounded-xl bg-[#F59E0B]/10 px-3 py-2 text-xs text-[#B45309]">
      {m.message ??
        (m.confiance === 'a_confirmer'
          ? 'Maison la plus proche de l’adresse, sans lien officiel : vérifiez que c’est la bonne.'
          : 'Aucune maison trouvée à cette adresse.')}
    </p>
  )
}

/**
 * La maison d'un projet, en 3D, sur la fiche du client : la maison confirmée,
 * sinon celle que le RNB relie à l'adresse du dossier.
 */
export function Maison3DProjet({ projetId, titre, adresse }: { projetId: string; titre: string | null; adresse: string | null }) {
  const { data: m, isLoading, error } = useMaisonAgence({ projetId })
  if (isLoading) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Recherche de la maison du client…
      </Card>
    )
  }
  if (error || !m?.principal) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Box className="size-4" />
        {error ? 'La maison du client n’a pas pu être trouvée.' : 'Pas de maison trouvée à l’adresse du client : la 3D a besoin d’une adresse avec un numéro.'}
      </Card>
    )
  }
  return (
    <div className="space-y-2">
      <Avertissement m={m} />
      <Maison3D cleabs={m.principal.cleabs} point={m.point} titre={titre} adresse={m.adresse_retrouvee ?? adresse} />
    </div>
  )
}

/**
 * Une adresse, et la maison en 3D avec tous ses métrés : pour chiffrer au
 * téléphone, avant même d'avoir un projet.
 */
export function Maison3DPage() {
  const [q, setQ] = useState('')
  const [suggestions, setSuggestions] = useState<Adresse[]>([])
  const [cherche, setCherche] = useState(false)
  const [choisie, setChoisie] = useState<Adresse | null>(null)
  const { data: m, isLoading } = useMaisonAgence(choisie ? { adresse: choisie } : null)

  // Les suggestions de la Base Adresse Nationale, pendant la frappe.
  useEffect(() => {
    if (q.trim().length < 3 || q === choisie?.label) return
    const ctrl = new AbortController()
    const minuterie = setTimeout(() => {
      setCherche(true)
      chercherAdresse(q, ctrl.signal)
        .then(setSuggestions)
        .catch(() => undefined)
        .finally(() => setCherche(false))
    }, 250)
    return () => {
      clearTimeout(minuterie)
      ctrl.abort()
    }
  }, [q, choisie?.label])

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <PageHeader titre="Maison 3D" sousTitre="Une adresse : la maison en 3D, son toit, ses façades et tous ses métrés." />
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          className="h-11 pl-9"
          placeholder="12 rue des Lilas, Lyon"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            if (choisie && e.target.value !== choisie.label) setChoisie(null)
          }}
        />
        {cherche && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        {!choisie && suggestions.length > 0 && q.trim().length >= 3 && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-card">
            {suggestions.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={cn('flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-accent', !a.precise && 'text-muted-foreground')}
                  onClick={() => {
                    setChoisie(a)
                    setQ(a.label)
                    setSuggestions([])
                  }}
                >
                  <MapPin className="size-4 shrink-0" />
                  <span className="truncate">{a.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {choisie && !choisie.precise && (
        <p className="text-sm text-muted-foreground">Choisissez une adresse avec un numéro : la 3D se fait maison par maison.</p>
      )}
      {choisie?.precise &&
        (isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Recherche de la maison…
          </p>
        ) : m?.principal ? (
          <div className="space-y-2">
            <Avertissement m={m} />
            <Maison3D cleabs={m.principal.cleabs} point={m.point} titre={null} adresse={m.adresse_retrouvee ?? choisie.label} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune maison trouvée à cette adresse.</p>
        ))}
    </div>
  )
}
