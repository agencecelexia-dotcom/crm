import { Link } from 'react-router-dom'
import { BarChart3, Trophy, Clock, ChevronRight } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatEuros } from '@/lib/format'
import { useStatsArtisans } from '../hooks/use-stats-artisans'

// Classement des artisans par performance (CA signé), pour confier les gros leads
// aux plus efficaces.
export function ArtisansStatsPage() {
  const { data: stats, isLoading } = useStatsArtisans()

  return (
    <div>
      <PageHeader
        titre="Performance artisans"
        sousTitre="Qui signe, qui répond vite — pour confier les meilleurs leads"
        action={
          <Button asChild variant="outline">
            <Link to="/artisans">← Artisans</Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : !stats || stats.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          titre="Pas encore de données"
          description="Les stats apparaissent dès que des artisans ont des chantiers."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {stats.map((s, i) => (
            <li key={s.id}>
              <Link to={`/artisans/${s.id}`}>
                <Card className="flex flex-col gap-3 rounded-2xl border-border/70 p-4 shadow-card transition-all duration-200 hover:shadow-card-hover active:scale-[0.99]">
                  <div className="flex items-start gap-2">
                    <span className="montant text-sm font-semibold text-muted-foreground">#{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-medium">
                        {i === 0 && <Trophy className="size-4 shrink-0 text-[#F59E0B]" />}
                        {s.nom ?? 'Artisan'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.gagnes} signé{s.gagnes > 1 ? 's' : ''} · {s.en_cours} en cours · {s.perdus} perdu
                        {s.perdus > 1 ? 's' : ''}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                    <Stat label="CA signé" value={formatEuros(s.ca_signe)} accent />
                    <Stat label="Commission" value={formatEuros(s.commission)} />
                    <Stat
                      label="Taux signature"
                      value={s.taux != null ? `${s.taux}%` : '—'}
                    />
                  </div>

                  {s.delai_h != null && (
                    <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      Répond en ~{s.delai_h < 1 ? '< 1' : Math.round(s.delai_h)} h en moyenne
                    </p>
                  )}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className={`montant text-sm font-semibold ${accent ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
