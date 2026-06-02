import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Users, ChevronRight } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { METIERS } from '@/lib/constants'
import { useArtisans } from '../hooks/use-artisans'

// Liste des artisans : recherche texte + filtre métier.
export function ArtisansListPage() {
  const { data: artisans, isLoading } = useArtisans()
  const [recherche, setRecherche] = useState('')
  const [metier, setMetier] = useState<string>('tous')

  const resultats = useMemo(() => {
    if (!artisans) return []
    const q = recherche.trim().toLowerCase()
    return artisans.filter((a) => {
      const matchMetier = metier === 'tous' || a.metiers.includes(metier)
      const matchTexte =
        !q ||
        [a.nom, a.prenom, a.societe, a.ville]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))
      return matchMetier && matchTexte
    })
  }, [artisans, recherche, metier])

  return (
    <div>
      <PageHeader
        titre="Artisans"
        action={
          <Button asChild size="sm">
            <Link to="/artisans/new">
              <Plus className="size-4" />
              Nouveau
            </Link>
          </Button>
        }
      />

      {/* Filtres */}
      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            placeholder="Rechercher (nom, société, ville)…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <Select value={metier} onValueChange={setMetier}>
          <SelectTrigger className="h-11 w-full">
            <SelectValue placeholder="Métier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tous">Tous les métiers</SelectItem>
            {METIERS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : resultats.length === 0 ? (
        <EmptyState
          icon={Users}
          titre="Aucun artisan"
          description="Ajoute ton premier artisan pour commencer à enrichir la base."
          action={
            <Button asChild>
              <Link to="/artisans/new">
                <Plus className="size-4" />
                Nouvel artisan
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {resultats.map((a) => (
            <li key={a.id}>
              <Link to={`/artisans/${a.id}`}>
                <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {a.nom} {a.prenom}
                      {a.societe && (
                        <span className="text-muted-foreground"> · {a.societe}</span>
                      )}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {a.ville || 'Ville non renseignée'}
                    </p>
                    {a.metiers.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {a.metiers.slice(0, 3).map((m) => (
                          <Badge key={m} variant="secondary" className="text-xs">
                            {m}
                          </Badge>
                        ))}
                        {a.metiers.length > 3 && (
                          <Badge variant="secondary" className="text-xs">
                            +{a.metiers.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
