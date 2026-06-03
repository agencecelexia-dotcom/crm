import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Users, ChevronRight, Phone } from 'lucide-react'

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
import { formatTel } from '@/lib/format'
import { useArtisans } from '../hooks/use-artisans'

// Liste des artisans : recherche texte + filtre métier.
export function ArtisansListPage() {
  const { data: artisans, isLoading } = useArtisans()
  const [recherche, setRecherche] = useState('')
  const [metier, setMetier] = useState<string>('tous')

  const resultats = useMemo(() => {
    if (!artisans) return []
    const q = recherche.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '') // pour la recherche par numéro
    return artisans.filter((a) => {
      const matchMetier = metier === 'tous' || a.metiers.includes(metier)
      const telDigits = (a.telephone ?? '').replace(/\D/g, '')
      const matchTel = qDigits.length >= 2 && telDigits.includes(qDigits)
      const matchTexte =
        !q ||
        matchTel ||
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
        <ul className="grid gap-3 md:grid-cols-2">
          {resultats.map((a) => (
            <li key={a.id} className="min-w-0">
              <Link to={`/artisans/${a.id}`} className="block h-full">
                <Card className="flex h-full flex-row items-center gap-3 overflow-hidden p-3 transition-colors hover:bg-accent/50">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-medium">
                      {[a.prenom, a.nom].filter(Boolean).join(' ')}
                      {a.societe && (
                        <span className="text-muted-foreground"> · {a.societe}</span>
                      )}
                    </p>
                    {a.telephone && (
                      <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                        <Phone className="size-3.5 shrink-0" />
                        <span className="truncate">{formatTel(a.telephone)}</span>
                      </p>
                    )}
                    <p className="truncate text-xs text-muted-foreground">
                      {a.ville || 'Ville non renseignée'}
                    </p>
                    {a.metiers.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
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
