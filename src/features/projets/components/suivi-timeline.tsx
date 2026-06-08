import { Badge } from '@/components/ui/badge'
import { formatDateHeure } from '@/lib/format'
import { SUIVI_STATUTS } from '@/lib/constants'
import type { Suivi } from '@/types/database'

// Fil chronologique des suivis (statuts déclarés + notes), agence & artisan.
export function SuiviTimeline({ suivis }: { suivis: Suivi[] }) {
  if (!suivis.length) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Aucun échange pour le moment.
      </p>
    )
  }
  return (
    <ul className="space-y-3">
      {suivis.map((s, i) => {
        const st = s.statut ? SUIVI_STATUTS[s.statut] : null
        const estArtisan = s.auteur === 'artisan'
        return (
          <li key={i} className="flex gap-3">
            <div
              className="mt-1.5 size-2 shrink-0 rounded-full"
              style={{ backgroundColor: st?.color ?? (estArtisan ? '#7C3AED' : '#64748B') }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">
                  {estArtisan ? '🛠️ Artisan' : '🏢 Agence'}
                </span>
                {st && (
                  <Badge
                    className="border-transparent text-xs"
                    style={{ backgroundColor: st.color, color: '#fff' }}
                  >
                    {st.emoji} {st.label}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatDateHeure(s.created_at)}
                </span>
              </div>
              {s.message && (
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{s.message}</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
