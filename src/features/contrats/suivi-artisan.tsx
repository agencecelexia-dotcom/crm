import { useState } from 'react'
import { Send, Check, CalendarIcon, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import { SUIVI_STATUTS } from '@/lib/constants'
import type { Suivi } from '@/types/database'
import { SuiviTimeline } from '@/features/projets/components/suivi-timeline'

// Parcours principal (dans l'ordre) + statuts secondaires hors parcours.
const PARCOURS = ['contacte', 'rdv_pris', 'devis_envoye', 'devis_signe', 'termine'] as const
const SECONDAIRES = ['en_attente', 'perdu'] as const

// Suivi côté artisan : parcours d'avancement visuel + note libre.
// `token` = token du PROJET (sécurise add_suivi_by_token).
export function SuiviArtisan({
  token,
  suivis,
  onChange,
  statutActuel,
}: {
  token: string
  suivis: Suivi[]
  onChange: () => void
  /** Statut courant du chantier — pour mettre en évidence l'étape en cours. */
  statutActuel?: string
}) {
  const [note, setNote] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [rdvMode, setRdvMode] = useState(false)
  const [rdvDate, setRdvDate] = useState<Date | undefined>(undefined)
  const [rdvHeure, setRdvHeure] = useState('')

  // Étapes déjà franchies (d'après l'historique) + date du RDV éventuelle.
  const franchies = new Set(suivis.filter((s) => s.statut).map((s) => s.statut as string))
  const rdvInfo = [...suivis].reverse().find((s) => s.statut === 'rdv_pris' && s.message)?.message

  async function poster(statut?: string, message?: string, dateRdv?: string): Promise<boolean> {
    setEnvoi(true)
    try {
      const { data, error } = await supabase.rpc('add_suivi_by_token', {
        p_token: token,
        p_statut: statut ?? null,
        p_message: message ?? null,
        p_date_rdv: dateRdv ?? null,
      })
      const ok = (data as { ok?: boolean } | null)?.ok
      if (error || !ok) throw new Error('Échec')
      if (!statut) setNote('')
      toast.success('Mis à jour. Merci !')
      onChange()
      return true
    } catch {
      toast.error("Impossible d'enregistrer")
      return false
    } finally {
      setEnvoi(false)
    }
  }

  // Confirme « RDV pris » avec sa date : consignée dans le suivi ET enregistrée
  // en clair (date_rdv) pour la relance post-RDV automatique.
  async function confirmerRdv() {
    if (!rdvDate) return toast.error('Choisissez la date du rendez-vous')
    const txt = `RDV pris le ${format(rdvDate, 'EEEE d MMMM yyyy', { locale: fr })}${
      rdvHeure.trim() ? ` à ${rdvHeure.trim()}` : ''
    }`
    const dt = new Date(rdvDate)
    if (rdvHeure.trim()) {
      const [h, m] = rdvHeure.split(':')
      dt.setHours(Number(h) || 0, Number(m) || 0, 0, 0)
    } else {
      dt.setHours(12, 0, 0, 0)
    }
    if (await poster('rdv_pris', txt, dt.toISOString())) {
      setRdvMode(false)
      setRdvHeure('')
    }
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Où en êtes-vous ?</CardTitle>
        <p className="text-sm text-muted-foreground">
          Cliquez sur l'étape où vous en êtes. Celexia est informé en direct — vous ne serez pas
          relancé inutilement. 🙂
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Parcours d'avancement */}
        <div role="group" aria-label="Avancement du chantier">
          {PARCOURS.map((cle, idx) => {
            const conf = SUIVI_STATUTS[cle]
            const estRdv = cle === 'rdv_pris'
            const active = statutActuel === cle
            const done = !active && franchies.has(cle)
            const dernier = idx === PARCOURS.length - 1
            const rempli = active || done

            return (
              <div key={cle}>
                <button
                  type="button"
                  disabled={envoi}
                  aria-current={active ? 'step' : undefined}
                  onClick={() => {
                    if (estRdv) setRdvMode((v) => !v)
                    else if (!active) void poster(cle)
                  }}
                  className={cn(
                    'group flex w-full items-stretch gap-3 text-left',
                    'focus-visible:outline-none disabled:opacity-60',
                  )}
                >
                  {/* Pastille + connecteur */}
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-base transition-all',
                        active && 'shadow-md',
                        !rempli && 'bg-card group-hover:border-primary/50',
                      )}
                      style={
                        rempli
                          ? { backgroundColor: conf.color, borderColor: conf.color, color: '#fff' }
                          : { borderColor: 'var(--border)' }
                      }
                    >
                      {done ? (
                        <Check className="size-4" />
                      ) : (
                        <span className={cn(!active && 'opacity-40')} aria-hidden>
                          {conf.emoji}
                        </span>
                      )}
                    </span>
                    {!dernier && <span className="my-1 w-0.5 flex-1 rounded bg-border" />}
                  </div>

                  {/* Libellé */}
                  <div className={cn('flex-1', dernier ? 'pb-1' : 'pb-5')}>
                    <p
                      className={cn(
                        'text-sm leading-9',
                        active ? 'font-semibold' : done ? 'font-medium' : 'text-muted-foreground',
                      )}
                      style={active ? { color: conf.color } : undefined}
                    >
                      {conf.label}
                      {active && <span className="ml-2 text-xs font-normal text-muted-foreground">• en cours</span>}
                    </p>
                    {estRdv && rdvInfo && (
                      <p className="-mt-2 text-xs text-muted-foreground">{rdvInfo}</p>
                    )}
                  </div>
                </button>

                {/* Panneau date du RDV (obligatoire) */}
                {estRdv && rdvMode && (
                  <div className="mb-4 ml-12 space-y-3 rounded-xl border border-[#8B5CF6]/40 bg-[#8B5CF6]/5 p-3">
                    <p className="text-sm font-medium">📅 Quelle est la date du rendez-vous ?</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              'h-11 flex-1 justify-start bg-card font-normal',
                              !rdvDate && 'text-muted-foreground',
                            )}
                          >
                            <CalendarIcon className="size-4" />
                            {rdvDate ? format(rdvDate, 'd MMMM yyyy', { locale: fr }) : 'Choisir la date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={rdvDate} onSelect={setRdvDate} locale={fr} autoFocus />
                        </PopoverContent>
                      </Popover>
                      <Input
                        type="time"
                        value={rdvHeure}
                        onChange={(e) => setRdvHeure(e.target.value)}
                        className="h-11 sm:w-32"
                        aria-label="Heure du rendez-vous (facultatif)"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 bg-card" onClick={() => setRdvMode(false)} disabled={envoi}>
                        Annuler
                      </Button>
                      <Button className="flex-1" onClick={() => void confirmerRdv()} disabled={envoi || !rdvDate}>
                        {envoi ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                        Confirmer le RDV
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Statuts secondaires */}
        <div className="flex flex-wrap gap-2">
          {SECONDAIRES.map((cle) => {
            const conf = SUIVI_STATUTS[cle]
            const active = statutActuel === cle
            return (
              <button
                key={cle}
                type="button"
                disabled={envoi}
                onClick={() => !active && void poster(cle)}
                aria-pressed={active}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'border-transparent text-white' : 'bg-card text-muted-foreground hover:bg-accent',
                )}
                style={active ? { backgroundColor: conf.color } : { borderColor: `${conf.color}55` }}
              >
                <span aria-hidden>{conf.emoji}</span>
                {conf.label}
              </button>
            )
          })}
        </div>

        <Separator />

        {/* Note libre */}
        <div className="space-y-2">
          <p className="text-sm font-medium">💬 Une note pour Celexia ?</p>
          <Textarea
            placeholder="Ce qui s'est dit : besoin du client, budget évoqué, délais, objection, prochaine étape…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            aria-label="Note de suivi"
          />
          <Button
            onClick={() => poster(undefined, note.trim())}
            disabled={envoi || !note.trim()}
            className="w-full"
          >
            {envoi ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Envoyer la note
          </Button>
        </div>

        {/* Historique */}
        {suivis.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="mb-2 text-sm font-medium">Historique</p>
              <SuiviTimeline suivis={suivis} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
