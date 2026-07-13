import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Phone, PhoneOff, Trash2, ListChecks, Loader2, ChevronRight, Check, Clock } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
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
import { cn } from '@/lib/utils'
import { formatTel } from '@/lib/format'
import {
  useTaches,
  useAjouterTache,
  useAjouterRappel,
  useToggleTache,
  useAppelSansReponse,
  useEncaisserCommission,
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
  rappel: { emoji: '⏰', label: 'Rappel', color: '#7C3AED' },
  autre: { emoji: '📝', label: 'Tâche', color: '#64748B' },
}
const PRIO: Record<number, { label: string; color: string }> = {
  1: { label: 'Priorité haute', color: '#EF4444' },
  2: { label: 'Priorité moyenne', color: '#F59E0B' },
  3: { label: 'Priorité basse', color: '#64748B' },
}

export function TachesPage() {
  const { data: taches, isLoading } = useTaches()
  const ajouter = useAjouterTache()
  const rappeler = useAjouterRappel()
  const [ouvert, setOuvert] = useState(false)
  const [titre, setTitre] = useState('')
  const [tel, setTel] = useState('')
  const [prio, setPrio] = useState('2')
  const [quand, setQuand] = useState('') // datetime-local → si rempli = rappel daté + email
  const [pour, setPour] = useState('') // nom dans l'objet du mail (« Thomas »)

  const [now] = useState(() => Date.now())
  const snoozed = (t: Tache) => !!t.rappel_at && new Date(t.rappel_at).getTime() > now

  const { groupes, faites, nbAFaire } = useMemo(() => {
    const list = taches ?? []
    const aFaire = list
      .filter((t) => t.statut === 'a_faire')
      .sort(
        (a, b) =>
          (snoozed(a) ? 1 : 0) - (snoozed(b) ? 1 : 0) ||
          (b.valeur ?? 0) - (a.valeur ?? 0) ||
          a.created_at.localeCompare(b.created_at),
      )
    const groupes: Record<number, Tache[]> = { 1: [], 2: [], 3: [] }
    for (const t of aFaire) (groupes[t.priorite] ?? groupes[2]).push(t)
    const faites = list
      .filter((t) => t.statut === 'fait')
      .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''))
    return { groupes, faites, nbAFaire: aFaire.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taches])

  function reset() {
    setTitre('')
    setTel('')
    setPrio('2')
    setQuand('')
    setPour('')
    setOuvert(false)
  }

  function ajouterTache() {
    if (!titre.trim()) return toast.error('Donnez un titre à la tâche')
    const onError = (e: unknown) =>
      toast.error('Échec', { description: e instanceof Error ? e.message : undefined })

    // Une date renseignée → RAPPEL daté (email à l'échéance + tâche dans la liste).
    if (quand) {
      rappeler.mutate(
        {
          titre: titre.trim(),
          priorite: Number(prio),
          rappel_at: new Date(quand).toISOString(),
          pour: pour.trim() || undefined,
        },
        {
          onSuccess: () => {
            toast.success('Rappel programmé — tu recevras un email à l\'heure dite')
            reset()
          },
          onError,
        },
      )
      return
    }

    ajouter.mutate(
      { titre: titre.trim(), tel: tel.trim() || undefined, priorite: Number(prio) },
      {
        onSuccess: () => {
          toast.success('Tâche ajoutée')
          reset()
        },
        onError,
      },
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        titre="À faire"
        sousTitre={nbAFaire > 0 ? `${nbAFaire} tâche${nbAFaire > 1 ? 's' : ''} en attente` : 'Tout est à jour'}
        action={
          <Button size="sm" onClick={() => setOuvert((v) => !v)}>
            <Plus className="size-4" />
            Ajouter
          </Button>
        }
      />

      {/* Ajout manuel */}
      {ouvert && (
        <Card className="mb-4 space-y-2 rounded-2xl border-border/70 p-4 shadow-card animate-in fade-in slide-in-from-top-1 duration-200">
          <Input
            placeholder="Que faut-il faire ? (ex. Rappeler M. Durand pour le devis)"
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ajouterTache()}
            className="h-11"
            autoFocus
          />
          <div className="flex gap-2">
            {!quand && (
              <Input
                placeholder="Téléphone (facultatif)"
                value={tel}
                onChange={(e) => setTel(e.target.value)}
                className="h-11 flex-1"
                inputMode="tel"
              />
            )}
            <Select value={prio} onValueChange={setPrio}>
              <SelectTrigger className="h-11 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Haute</SelectItem>
                <SelectItem value="2">Moyenne</SelectItem>
                <SelectItem value="3">Basse</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Rappel daté : si une date est mise, ça devient un rappel (email à l'échéance). */}
          <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
              <Clock className="size-3.5" />
              Me le rappeler le… (optionnel → email + tâche à la date)
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="datetime-local"
                value={quand}
                onChange={(e) => setQuand(e.target.value)}
                className="h-11 flex-1"
              />
              {quand && (
                <Input
                  placeholder="Pour qui ? (objet du mail, ex. Thomas)"
                  value={pour}
                  onChange={(e) => setPour(e.target.value)}
                  className="h-11 flex-1"
                />
              )}
            </div>
          </div>

          <Button
            className="w-full"
            onClick={ajouterTache}
            disabled={ajouter.isPending || rappeler.isPending}
          >
            {ajouter.isPending || rappeler.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {quand ? 'Programmer le rappel' : 'Ajouter à ma liste'}
          </Button>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : nbAFaire === 0 && faites.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          titre="Rien à faire 🎉"
          description="Les tâches (leads, contrats, relances, commissions) apparaîtront ici automatiquement."
        />
      ) : (
        <div className="space-y-6">
          {[1, 2, 3].map((p) =>
            groupes[p].length === 0 ? null : (
              <section key={p}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: PRIO[p].color }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {PRIO[p].label}
                  </h3>
                  <span className="text-xs text-muted-foreground">· {groupes[p].length}</span>
                </div>
                <ul className="space-y-2">
                  {groupes[p].map((t) => (
                    <TacheItem key={t.id} t={t} snoozed={snoozed(t)} />
                  ))}
                </ul>
              </section>
            ),
          )}

          {faites.length > 0 && (
            <section>
              <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Terminé · suppression auto 24 h ({faites.length})
              </div>
              <ul className="space-y-2">
                {faites.map((t) => (
                  <TacheItem key={t.id} t={t} snoozed={false} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function TacheItem({ t, snoozed }: { t: Tache; snoozed: boolean }) {
  const toggle = useToggleTache()
  const sansReponse = useAppelSansReponse()
  const encaisser = useEncaisserCommission()
  const supprimer = useSupprimerTache()
  const fait = t.statut === 'fait'
  const cat = CAT[t.categorie ?? 'autre'] ?? CAT.autre

  return (
    <li>
      <Card
        className={cn(
          'flex items-start gap-3 rounded-2xl border-border/70 p-3.5 shadow-card transition-all duration-200',
          fait ? 'opacity-55' : 'hover:shadow-card-hover',
        )}
      >
        {/* Case ronde */}
        <button
          type="button"
          onClick={() => toggle.mutate({ id: t.id, fait: !fait })}
          aria-label={fait ? 'Marquer à faire' : 'Marquer fait'}
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
            fait
              ? 'border-transparent bg-[#22C55E] text-white'
              : 'border-muted-foreground/30 hover:border-primary',
          )}
        >
          {fait && <Check className="size-3.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-lg text-sm"
              style={{ backgroundColor: `${cat.color}1a` }}
              aria-hidden
            >
              {cat.emoji}
            </span>
            <p className={cn('min-w-0 flex-1 truncate text-sm font-medium', fait && 'line-through')}>
              {t.titre}
            </p>
          </div>

          {t.details && <p className="mt-0.5 truncate pl-8 text-xs text-muted-foreground">{t.details}</p>}

          {(t.nb_appels > 0 || snoozed || (t.categorie === 'rappel' && t.rappel_at)) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-8 text-[11px] text-muted-foreground">
              {t.nb_appels > 0 && <span>📞 appelé {t.nb_appels}×</span>}
              {t.categorie === 'rappel' && t.rappel_at ? (
                <span className="flex items-center gap-0.5">
                  <Clock className="size-3" /> rappel le{' '}
                  {new Date(t.rappel_at).toLocaleString('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {t.notifie_at ? ' · email envoyé ✓' : ''}
                </span>
              ) : (
                snoozed && (
                  <span className="flex items-center gap-0.5">
                    <Clock className="size-3" /> à rappeler plus tard
                  </span>
                )
              )}
            </p>
          )}

          {!fait && (t.tel || t.projet_id) && (
            <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
              {t.categorie === 'commission' && t.projet_id && (
                <Button
                  size="sm"
                  className="h-8 rounded-full bg-[#22C55E] shadow-none hover:bg-[#16A34A]"
                  disabled={encaisser.isPending}
                  onClick={() =>
                    encaisser.mutate(t.projet_id!, {
                      onSuccess: () => toast.success('Commission encaissée'),
                    })
                  }
                >
                  <Check className="size-3.5" />
                  Encaissée
                </Button>
              )}
              {t.tel && (
                <>
                  <Button asChild size="sm" variant="outline" className="h-8 rounded-full">
                    <a href={`tel:${t.tel}`}>
                      <Phone className="size-3.5" />
                      {formatTel(t.tel)}
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-full text-muted-foreground"
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
                <Button asChild size="sm" variant="ghost" className="h-8 rounded-full">
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
            className="size-8 shrink-0 rounded-full text-muted-foreground"
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
