import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, FolderKanban, ChevronRight } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { StatutBadge } from '@/components/statut-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { METIERS, STATUTS, STATUTS_ORDRE } from '@/lib/constants'
import { formatEuros, formatDate } from '@/lib/format'
import { useProjets } from '../hooks/use-projets'

// Liste des projets : recherche + filtres statut / métier / ville.
export function ProjetsListPage() {
  const { data: projets, isLoading } = useProjets()
  const [recherche, setRecherche] = useState('')
  const [statut, setStatut] = useState('tous')
  const [metier, setMetier] = useState('tous')

  const resultats = useMemo(() => {
    if (!projets) return []
    const q = recherche.trim().toLowerCase()
    return projets.filter((p) => {
      const matchStatut = statut === 'tous' || p.statut === statut
      const matchMetier = metier === 'tous' || p.metier === metier
      const matchTexte =
        !q ||
        [p.client_nom, p.client_ville, p.metier, p.artisan?.societe, p.artisan?.nom]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))
      return matchStatut && matchMetier && matchTexte
    })
  }, [projets, recherche, statut, metier])

  return (
    <div>
      <PageHeader
        titre="Projets"
        action={
          <Button asChild size="sm">
            <Link to="/projets/new">
              <Plus className="size-4" />
              Nouveau
            </Link>
          </Button>
        }
      />

      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            placeholder="Rechercher (client, ville, artisan)…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={statut} onValueChange={setStatut}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">Tous statuts</SelectItem>
              {STATUTS_ORDRE.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUTS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={metier} onValueChange={setMetier}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Métier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">Tous métiers</SelectItem>
              {METIERS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : resultats.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          titre="Aucun projet"
          description="Crée un projet pendant l'appel pour démarrer le suivi."
          action={
            <Button asChild>
              <Link to="/projets/new">
                <Plus className="size-4" />
                Nouveau projet
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {resultats.map((p) => (
            <li key={p.id}>
              <Link to={`/projets/${p.id}`}>
                <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{p.client_nom}</p>
                      <StatutBadge statut={p.statut} />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {p.metier}
                      {p.client_ville && ` · ${p.client_ville}`}
                      {p.artisan && ` · ${p.artisan.societe ?? p.artisan.nom}`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(p.created_at)}
                      {p.montant_devis_signe != null &&
                        ` · signé ${formatEuros(p.montant_devis_signe)}`}
                    </p>
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
