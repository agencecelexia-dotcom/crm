import { useState } from 'react'
import { Send, Check, CalendarIcon, Loader2, Phone, PhoneCall, PhoneMissed, Bell } from 'lucide-react'
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
import { FilDiscussion } from './fil-discussion'
import type { Suivi } from '@/types/database'

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
  rappelLe,
}: {
  token: string
  suivis: Suivi[]
  onChange: () => void
  /** Statut courant du chantier — pour mettre en évidence l'étape en cours. */
  statutActuel?: string
  /** Rappel déjà posé, s'il y en a un. Co-statut : n'affecte pas l'étape. */
  rappelLe?: string | null
}) {
  const [note, setNote] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [rdvMode, setRdvMode] = useState(false)
  const [rdvDate, setRdvDate] = useState<Date | undefined>(undefined)
  const [rdvHeure, setRdvHeure] = useState('')
  const [perduMode, setPerduMode] = useState(false)
  const [perduRaison, setPerduRaison] = useState('')
  // Rappel : un CO-statut, pas une étape. « Le client signera à son retour de
  // vacances le 5 » ne fait pas reculer le chantier — il reste « devis
  // envoyé », avec une date à laquelle le reprendre.
  const [rappelMode, setRappelMode] = useState(false)
  const [rappelDate, setRappelDate] = useState<Date | undefined>(undefined)

  // Date du RDV éventuelle, lue dans l'historique des suivis.
  const nonLus = suivis.filter((s) => s.auteur === 'agence' && !s.lu_at).length
  // Rang de l'étape courante dans le parcours. C'est LUI qui décide de ce qui
  // est franchi, et non l'historique des suivis : une étape cliquée par erreur
  // puis corrigée y resterait pour toujours, laissant « devis signé » en vert
  // alors que le chantier est redescendu à « devis envoyé ».
  const rangCourant = PARCOURS.indexOf(statutActuel as (typeof PARCOURS)[number])
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
  /** Pose ou retire la date de rappel. `null` annule. */
  async function enregistrerRappel(quand: Date | null) {
    setEnvoi(true)
    try {
      const { data, error } = await supabase.rpc('definir_rappel_by_token', {
        p_token: token,
        p_quand: quand ? quand.toISOString() : null,
      })
      if (error) throw error
      const r = data as { ok?: boolean; error?: string } | null
      if (!r?.ok) {
        throw new Error(
          r?.error === 'date_passee'
            ? 'Choisissez une date à venir.'
            : 'Le rappel n’a pas pu être enregistré.',
        )
      }
      toast.success(quand ? 'Rappel programmé' : 'Rappel retiré')
      setRappelMode(false)
      setRappelDate(undefined)
      onChange()
    } catch (e) {
      toast.error('Rappel impossible', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setEnvoi(false)
    }
  }

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

  // Logue une tentative d'appel (surtout « pas de réponse » : on saura qu'il a essayé).
  async function loggerAppel(resultat: string) {
    setEnvoi(true)
    try {
      const { data, error } = await supabase.rpc('log_appel_by_token', {
        p_token: token,
        p_resultat: resultat,
      })
      const ok = (data as { ok?: boolean } | null)?.ok
      if (error || !ok) throw new Error('Échec')
      toast.success('Appel enregistré. Merci !')
      onChange()
    } catch {
      toast.error("Impossible d'enregistrer l'appel")
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="font-display text-base tracking-tight">Où en êtes-vous ?</CardTitle>
        <p className="text-sm text-muted-foreground">
          Cliquez sur l'étape où vous en êtes. Celexia est informé en direct — vous ne serez pas
          relancé inutilement.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Parcours d'avancement */}
        <div role="group" aria-label="Avancement du chantier">
          {PARCOURS.map((cle, idx) => {
            const conf = SUIVI_STATUTS[cle]
            const estRdv = cle === 'rdv_pris'
            const active = statutActuel === cle
            // Franchi = strictement avant l'étape courante. Corriger une étape
            // en arrière éteint donc bien les pastilles au-delà.
            const done = !active && rangCourant > idx
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
                        'flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all duration-200',
                        !rempli && 'bg-card text-muted-foreground group-hover:border-primary/50 group-hover:text-primary',
                      )}
                      style={
                        rempli
                          ? {
                              backgroundColor: conf.color,
                              borderColor: conf.color,
                              color: '#fff',
                              ...(active ? { boxShadow: `0 0 0 4px ${conf.color}22` } : {}),
                            }
                          : { borderColor: 'var(--border)' }
                      }
                    >
                      {done ? <Check className="size-4.5" /> : idx + 1}
                    </span>
                    {!dernier && (
                      <span
                        className={cn(
                          'my-1 w-0.5 flex-1 rounded transition-colors',
                          rempli ? 'bg-primary/30' : 'bg-border',
                        )}
                      />
                    )}
                  </div>

                  {/* Libellé */}
                  <div className={cn('flex-1', dernier ? 'pb-1' : 'pb-5')}>
                    <p
                      className={cn(
                        'flex items-center gap-2 text-sm leading-10',
                        active ? 'font-semibold' : done ? 'font-medium' : 'text-muted-foreground',
                      )}
                      style={active ? { color: conf.color } : undefined}
                    >
                      {conf.label}
                      {active && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-medium leading-normal"
                          style={{ backgroundColor: `${conf.color}1a`, color: conf.color }}
                        >
                          en cours
                        </span>
                      )}
                    </p>
                    {estRdv && rdvInfo && (
                      <p className="-mt-2 text-xs text-muted-foreground">{rdvInfo}</p>
                    )}
                  </div>
                </button>

                {/* Panneau date du RDV (obligatoire) */}
                {estRdv && rdvMode && (
                  <div className="mb-4 ml-12 space-y-3 rounded-xl border border-violet-400/40 bg-violet-500/5 p-3.5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <CalendarIcon className="size-4 text-violet-600" />
                      Quelle est la date du rendez-vous ?
                    </p>
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

        {/* Appel client — logguer une tentative (surtout « pas de réponse ») */}
        <div className="space-y-2.5 rounded-xl border border-border/70 bg-muted/30 p-3.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Phone className="size-3.5" />
            Appels
          </p>
          <p className="text-sm font-medium">Vous avez essayé d'appeler le client ?</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="h-9 rounded-full bg-card" disabled={envoi} onClick={() => void loggerAppel('pas_de_reponse')}>
              <PhoneMissed className="size-4" /> Pas de réponse
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-full bg-card" disabled={envoi} onClick={() => void loggerAppel('repondu')}>
              <PhoneCall className="size-4" /> Je l'ai eu
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-full bg-card" disabled={envoi} onClick={() => void loggerAppel('rappeler')}>
              <Phone className="size-4" /> À rappeler
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Notez chaque tentative — surtout si le client ne décroche pas, pour qu'on sache que vous avez essayé.
          </p>
        </div>

        {/* Rappel — un CO-statut : le chantier garde son étape, on note juste
            quand le reprendre. « Il signera à son retour le 5 » ne fait pas
            reculer un devis envoyé. */}
        <div className="rounded-xl border border-border bg-muted/30 p-3">
          {rappelLe && !rappelMode ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm">
                <Bell className="size-4 shrink-0 text-primary" />
                <span>
                  À reprendre le{' '}
                  <strong>{format(new Date(rappelLe), 'EEEE d MMMM', { locale: fr })}</strong>
                </span>
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={envoi}
                        onClick={() => { setRappelDate(new Date(rappelLe)); setRappelMode(true) }}>
                  Modifier
                </Button>
                <Button size="sm" variant="ghost" disabled={envoi}
                        onClick={() => void enregistrerRappel(null)}>
                  Retirer
                </Button>
              </div>
            </div>
          ) : !rappelMode ? (
            <button
              type="button"
              disabled={envoi}
              onClick={() => setRappelMode(true)}
              className="flex w-full items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground"
            >
              <Bell className="size-4 shrink-0" />
              <span>
                <strong className="text-foreground">Me le rappeler plus tard</strong> — le
                client vous a donné une date ? Notez-la, le chantier garde son étape.
              </span>
            </button>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Bell className="size-4 text-primary" />
                Quand faut-il reprendre ce chantier ?
              </p>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'h-11 w-full justify-start bg-card font-normal',
                      !rappelDate && 'text-muted-foreground',
                    )}
                  >
                    <CalendarIcon className="size-4" />
                    {rappelDate
                      ? format(rappelDate, 'd MMMM yyyy', { locale: fr })
                      : 'Choisir la date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={rappelDate}
                    onSelect={setRappelDate}
                    locale={fr}
                    // Un rappel dans le passé n'a pas de sens ; la fonction SQL
                    // le refuse aussi (`date_passee`).
                    disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={envoi || !rappelDate}
                  onClick={() => rappelDate && void enregistrerRappel(rappelDate)}
                >
                  Programmer le rappel
                </Button>
                <Button variant="ghost" disabled={envoi}
                        onClick={() => { setRappelMode(false); setRappelDate(undefined) }}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
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
                onClick={() => {
                  if (active) return
                  if (cle === 'perdu') setPerduMode(true)
                  else void poster(cle)
                }}
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

        {/* Justification OBLIGATOIRE quand on déclare « perdu » */}
        {perduMode && (
          <div className="space-y-3 rounded-xl border border-rose-300 bg-rose-50 p-3.5 animate-in fade-in slide-in-from-top-1 duration-200">
            <p className="text-sm font-medium text-rose-800">Pourquoi ce chantier est-il perdu ?</p>
            <p className="text-xs text-rose-700">
              Une explication est obligatoire (le client a refusé, budget trop élevé, ne répond
              plus, a déjà fait faire ailleurs…). Ça nous aide à comprendre et à mieux vous
              envoyer les bons chantiers.
            </p>
            <Textarea
              value={perduRaison}
              onChange={(e) => setPerduRaison(e.target.value)}
              rows={2}
              placeholder="Expliquez en quelques mots…"
              aria-label="Raison de la perte du chantier"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 bg-card"
                disabled={envoi}
                onClick={() => {
                  setPerduMode(false)
                  setPerduRaison('')
                }}
              >
                Annuler
              </Button>
              <Button
                className="flex-1"
                disabled={envoi || !perduRaison.trim()}
                onClick={async () => {
                  if (await poster('perdu', perduRaison.trim())) {
                    setPerduMode(false)
                    setPerduRaison('')
                  }
                }}
              >
                {envoi ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Confirmer « perdu »
              </Button>
            </div>
          </div>
        )}

        <Separator />

        {/* Note libre */}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Send className="size-3.5 text-muted-foreground" />
            Une note pour Celexia ?
          </p>
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

        {/* Fil partagé avec Celexia. Remplace l'ancien historique en lecture
            seule, qui attribuait tous les événements à « Artisan ». */}
        {suivis.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                Échanges avec Celexia
                {nonLus > 0 && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    {nonLus} nouveau{nonLus > 1 ? 'x' : ''}
                  </span>
                )}
              </p>
              <FilDiscussion suivis={suivis} token={token} onLu={onChange} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
