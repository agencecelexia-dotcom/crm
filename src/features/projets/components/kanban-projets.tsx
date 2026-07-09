import { useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUTS, STATUTS_ORDRE } from '@/lib/constants'
import { usePatchProjet } from '../hooks/use-projets'
import { useArtisansSignes } from '@/features/contrats/use-contrats'
import { ConfirmStatutDialog } from './confirm-statut-dialog'
import type { ProjetAvecArtisan, StatutProjet } from '@/types/database'

// Vue pipeline (Kanban) : une colonne par statut. On glisse une carte dans une
// autre colonne pour changer son statut (sur ordinateur, avec confirmation).
// Sur mobile, on ouvre la fiche pour changer le statut.
export function KanbanProjets({ projets }: { projets: ProjetAvecArtisan[] }) {
  const patch = usePatchProjet()
  const { data: artisansSignes } = useArtisansSignes()
  const [over, setOver] = useState<StatutProjet | null>(null)
  const [enAttente, setEnAttente] = useState<{ id: string; statut: StatutProjet } | null>(null)

  function onDrop(statut: StatutProjet, e: DragEvent) {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('text/plain')
    const p = projets.find((x) => x.id === id)
    if (p && p.statut !== statut) setEnAttente({ id, statut })
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {STATUTS_ORDRE.map((s) => {
        const items = projets.filter((p) => p.statut === s)
        return (
          <div
            key={s}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(s)
            }}
            onDragLeave={() => setOver((o) => (o === s ? null : o))}
            onDrop={(e) => onDrop(s, e)}
            className={cn(
              'flex w-64 shrink-0 flex-col rounded-xl border bg-secondary/30 p-2',
              over === s ? 'border-dashed border-primary bg-primary/5' : 'border-border',
            )}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="size-2.5 rounded-full" style={{ background: STATUTS[s].color }} />
                {STATUTS[s].label}
              </span>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </div>

            <div className="space-y-2">
              {items.map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)}
                  className="cursor-grab rounded-lg border border-border bg-card p-2.5 shadow-sm active:cursor-grabbing"
                >
                  <Link to={`/projets/${p.id}`} draggable={false} className="block">
                    <p className="truncate text-sm font-medium">{p.client_nom}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.metiers.join(', ') || '—'}
                      {p.client_ville ? ` · ${p.client_ville}` : ''}
                    </p>
                    {p.artisan && (
                      <p className="flex items-center gap-1 text-xs">
                        {artisansSignes?.has(p.artisan_id ?? '') ? (
                          <BadgeCheck className="size-3 shrink-0 text-[#22C55E]" />
                        ) : (
                          <Clock className="size-3 shrink-0 text-[#F59E0B]" />
                        )}
                        <span className="min-w-0 truncate text-muted-foreground">
                          {p.artisan.societe || p.artisan.nom}
                        </span>
                      </p>
                    )}
                  </Link>
                </div>
              ))}
              {items.length === 0 && (
                <p className="px-1 py-3 text-center text-xs text-muted-foreground">—</p>
              )}
            </div>
          </div>
        )
      })}

      <ConfirmStatutDialog
        open={enAttente != null}
        statut={enAttente?.statut ?? null}
        onOpenChange={(open) => !open && setEnAttente(null)}
        onConfirm={() => {
          if (enAttente) patch.mutate({ id: enAttente.id, patch: { statut: enAttente.statut } })
          setEnAttente(null)
        }}
      />
    </div>
  )
}
