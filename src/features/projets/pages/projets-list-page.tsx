import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, FolderKanban, ChevronRight, Phone, BadgeCheck, Clock } from 'lucide-react'

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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { METIERS, STATUTS, STATUTS_ORDRE } from '@/lib/constants'
import { formatEuros, formatDate, formatTel } from '@/lib/format'
import { useProjets } from '../hooks/use-projets'
import { useArtisansSignes } from '@/features/contrats/use-contrats'
import { QuickProspectDialog } from '../components/quick-prospect-dialog'
import { KanbanProjets } from '../components/kanban-projets'

// Liste des projets : recherche + filtres statut / métier / ville.
export function ProjetsListPage() {
  const { data: projets, isLoading } = useProjets()
  const { data: artisansSignes } = useArtisansSignes()
  const [recherche, setRecherche] = useState('')
  const [statut, setStatut] = useState('tous')
  const [metier, setMetier] = useState('tous')
  const [vue, setVue] = useState<'liste' | 'pipeline'>('liste')

  // Recherche + métier (communs aux 2 vues)
  const base = useMemo(() => {
    if (!projets) return []
    const q = recherche.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '') // pour la recherche par numéro
    return projets.filter((p) => {
      const matchMetier = metier === 'tous' || p.metiers.includes(metier)
      const telDigits = (p.client_telephone ?? '').replace(/\D/g, '')
      const matchTel = qDigits.length >= 2 && telDigits.includes(qDigits)
      const matchTexte =
        !q ||
        matchTel ||
        [p.client_nom, p.client_ville, p.metiers.join(' '), p.artisan?.societe, p.artisan?.nom]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))
      return matchMetier && matchTexte
    })
  }, [projets, recherche, metier])

  // Vue liste : on applique aussi le filtre statut
  const resultats = useMemo(
    () => base.filter((p) => statut === 'tous' || p.statut === statut),
    [base, statut],
  )

  return (
    <div>
      <PageHeader
        titre="Projets"
        action={<QuickProspectDialog />}
      />

      {/* Bascule Liste / Pipeline (Kanban) */}
      <Tabs value={vue} onValueChange={(v) => setVue(v as 'liste' | 'pipeline')} className="mb-3">
        <TabsList>
          <TabsTrigger value="liste">Liste</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 pl-9"
            placeholder="Rechercher (nom, n° de tél, ville, artisan)…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>
        <div className={cn('grid gap-2', vue === 'liste' ? 'grid-cols-2' : 'grid-cols-1')}>
          {/* Le filtre statut n'a de sens qu'en vue liste (en pipeline, ce sont les colonnes) */}
          {vue === 'liste' && (
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
          )}
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
      ) : vue === 'pipeline' ? (
        <KanbanProjets projets={base} />
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
        <ul className="grid gap-3 md:grid-cols-2">
          {resultats.map((p) => (
            <li key={p.id} className="min-w-0">
              <Link to={`/projets/${p.id}`} className="block h-full">
                <Card className="flex h-full flex-row items-center gap-3 overflow-hidden p-3 transition-colors hover:bg-accent/50">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate font-medium">{p.client_nom}</p>
                      <StatutBadge statut={p.statut} />
                    </div>
                    {p.client_telephone && (
                      <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                        <Phone className="size-3.5 shrink-0" />
                        <span className="truncate">{formatTel(p.client_telephone)}</span>
                      </p>
                    )}
                    <p className="truncate text-xs text-muted-foreground">
                      {p.metiers.join(', ') || '—'}
                      {p.client_ville && ` · ${p.client_ville}`}
                    </p>
                    {p.artisan && (
                      <p className="flex items-center gap-1 text-xs">
                        {artisansSignes?.has(p.artisan_id ?? '') ? (
                          <BadgeCheck className="size-3.5 shrink-0 text-[#22C55E]" />
                        ) : (
                          <Clock className="size-3.5 shrink-0 text-[#F59E0B]" />
                        )}
                        <span className="min-w-0 truncate text-muted-foreground">
                          {p.artisan.societe ?? p.artisan.nom}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 font-medium',
                            artisansSignes?.has(p.artisan_id ?? '')
                              ? 'text-[#22C55E]'
                              : 'text-[#F59E0B]',
                          )}
                        >
                          · {artisansSignes?.has(p.artisan_id ?? '') ? 'signé' : 'non signé'}
                        </span>
                      </p>
                    )}
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDate(p.created_at)}
                      {p.montant_devis_signe != null && ` · ${formatEuros(p.montant_devis_signe)}`}
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
