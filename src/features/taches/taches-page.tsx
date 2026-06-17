import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Phone, PhoneOff, Trash2, ListChecks, Loader2, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatTel } from '@/lib/format'
import {
  useTaches,
  useAjouterTache,
  useToggleTache,
  useAppelSansReponse,
  useSupprimerTache,
  type Tache,
} from './use-taches'

const CAT: Record<string, { emoji: string; label: string; color: string }> = {
  assignation: { emoji: '👤', label: 'Assignation', color: '#3B82F6' },
  contrat: { emoji: '✍️', label: 'Contrat', color: '#F59E0B' },
  rdv: { emoji: '📅', label: 'RDV', color: '#8B5CF6' },
  devis: { emoji: '📄', label: 'Devis', color: '#0EA5E9' },
  commission: { emoji: '💰', label: 'Commission', color: '#22C55E' },
  appel: { emoji: '📞', label: 'Appel', color: '#6366F1' },
  autre: { emoji: '📝', label: 'Tâche', color: '#64748B' },
}
const PRIO: Record<number, { label: string; color: string }> = {
  1: { label: 'Haute', color: '#EF4444' },
  2: { label: 'Moyenne', color: '#F59E0B' },
  3: { label: 'Basse', color: '#64748B' },
}

export function TachesPage() {
  const { data: taches, isLoading } = useTaches()
  const ajouter = useAjouterTache()
  const [ouvert, setOuvert] = useState(false)
  const [titre, setTitre] = useState('')
  const [tel, setTel] = useState('')
  const [prio, setPrio] = useState('2')

  // Heure de référence figée au montage (suffit pour trier/afficher les reports).
  const [now] = useState(() => Date.now())
  const snoozed = (t: Tache) => !!t.rappel_at && new Date(t.rappel_at).getTime() > now

  const { aFaire, faites } = useMemo(() => {
    const list = taches ?? []
    const aFaire = list
      .filter((t) => t.statut === 'a_faire')
      .sort(
        (a, b) =>
          (snoozed(a) ? 1 : 0) - (snoozed(b) ? 1 : 0) ||
          a.priorite - b.priorite ||
          a.created_at.localeCompare(b.created_at),
      )
    const faites = list
      .filter((t) => t.statut === 'fait')
      .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''))
    return { aFaire, faites }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taches])

  function ajouterTache() {
    if (!titre.trim()) return toast.error('Donnez un titre à la tâche')
    ajouter.mutate(
      { titre: titre.trim(), tel: tel.trim() || undefined, priorite: Number(prio) },
      {
        onSuccess: () => {
          toast.success('Tâche ajoutée')
          setTitre('')
          setTel('')
          setPrio('2')
          setOuvert(false)
        },
        onError: (e) => toast.error('Échec', { description: e instanceof Error ? e.message : undefined }),
      },
    )
  }

  return (
    <div>
      <PageHeader
        titre="À faire"
        sousTitre="Tâches prioritaires (auto + manuelles) — cochées, elles disparaissent après 24 h"
        action={
          <Button size="sm" onClick={() => setOuvert((v) => !v)}>
            <Plus className="size-4" />
            Ajouter
          </Button>
        }
      />

      {/* Formulaire d'ajout manuel */}
      {ouvert && (
        <Card className="mb-4 space-y-2 p-3">
          <Input
            placeholder="Que faut-il faire ? (ex. Rappeler M. Durand pour le devis)"
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            className="h-11"
          />
          <div className="flex gap-2">
            <Input
              placeholder="Téléphone (facultatif)"
              value={tel}
              onChange={(e) => setTel(e.target.value)}
              className="h-11 flex-1"
              inputMode="tel"
            />
            <Select value={prio} onValueChange={setPrio}>
              <SelectTrigger className="h-11 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Haute</SelectItem>
                <SelectItem value="2">Moyenne</SelectItem>
                <SelectItem value="3">Basse</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={ajouterTache} disabled={ajouter.isPending}>
            {ajouter.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Ajouter à ma liste
          </Button>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : aFaire.length === 0 && faites.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          titre="Rien à faire 🎉"
          description="Les tâches (leads, contrats, relances, commissions) apparaîtront ici automatiquement."
        />
      ) : (
        <div className="space-y-5">
          {aFaire.length > 0 && (
            <ul className="space-y-2">
              {aFaire.map((t) => (
                <TacheItem key={t.id} t={t} snoozed={snoozed(t)} />
              ))}
            </ul>
          )}

          {faites.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Terminé · suppression auto 24 h ({faites.length})
              </p>
              <ul className="space-y-2 opacity-60">
                {faites.map((t) => (
                  <TacheItem key={t.id} t={t} snoozed={false} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TacheItem({ t, snoozed }: { t: Tache; snoozed: boolean }) {
  const toggle = useToggleTache()
  const sansReponse = useAppelSansReponse()
  const supprimer = useSupprimerTache()
  const fait = t.statut === 'fait'
  const cat = CAT[t.categorie ?? 'autre'] ?? CAT.autre
  const prio = PRIO[t.priorite] ?? PRIO[2]

  return (
    <li>
      <Card
        className="flex items-start gap-3 border-l-4 p-3"
        style={{ borderLeftColor: fait ? '#cbd5e1' : prio.color }}
      >
        <Checkbox
          checked={fait}
          onCheckedChange={(v) => toggle.mutate({ id: t.id, fait: v === true })}
          className="mt-0.5"
          aria-label={fait ? 'Marquer à faire' : 'Marquer fait'}
        />

        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-medium', fait && 'line-through')}>
            <span className="mr-1" aria-hidden>
              {cat.emoji}
            </span>
            {t.titre}
          </p>
          {t.details && <p className="truncate text-xs text-muted-foreground">{t.details}</p>}

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {!fait && (
              <span className="font-medium" style={{ color: prio.color }}>
                {prio.label}
              </span>
            )}
            {t.nb_appels > 0 && (
              <span>
                📞 appelé {t.nb_appels}×{snoozed ? ' · à rappeler plus tard' : ''}
              </span>
            )}
          </div>

          {/* Actions */}
          {!fait && (
            <div className="mt-2 flex flex-wrap gap-2">
              {t.tel && (
                <>
                  <Button asChild size="sm" variant="outline" className="h-8">
                    <a href={`tel:${t.tel}`}>
                      <Phone className="size-3.5" />
                      {formatTel(t.tel)}
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-muted-foreground"
                    disabled={sansReponse.isPending}
                    onClick={() =>
                      sansReponse.mutate(t, {
                        onSuccess: () => toast.success('Appel noté — tâche reportée de 4 h'),
                      })
                    }
                  >
                    <PhoneOff className="size-3.5" />
                    Pas de réponse
                  </Button>
                </>
              )}
              {t.projet_id && (
                <Button asChild size="sm" variant="ghost" className="h-8">
                  <Link to={`/projets/${t.projet_id}`}>
                    Ouvrir <ChevronRight className="size-3.5" />
                  </Link>
                </Button>
              )}
            </div>
          )}
        </div>

        {t.type === 'manuel' && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label="Supprimer la tâche"
            onClick={() => supprimer.mutate(t.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </Card>
    </li>
  )
}
