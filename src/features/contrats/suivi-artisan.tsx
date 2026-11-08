import { useRef, useState } from 'react'
import { Send, Check, CalendarIcon, Loader2, Phone, PhoneCall, PhoneMissed, Bell, Pause, XCircle } from 'lucide-react'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatEuros } from '@/lib/format'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import { SUIVI_STATUTS } from '@/lib/constants'
import { FilDiscussion } from './fil-discussion'
import { messageErreurSuivi } from './erreur-suivi'
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
  montantDevis,
  devisDepose,
  dateRdv,
  enAttenteDepuis,
  montantSigne,
  devisSigneDepose,
  commissionEncaissee,
}: {
  token: string
  suivis: Suivi[]
  onChange: () => void
  /** Statut courant du chantier — pour mettre en évidence l'étape en cours. */
  statutActuel?: string
  /** Rappel déjà posé, s'il y en a un. Co-statut : n'affecte pas l'étape. */
  rappelLe?: string | null
  /** Montant du devis déposé : on le nomme avant de le faire disparaître. */
  montantDevis?: number | null
  devisDepose?: boolean
  dateRdv?: string | null
  enAttenteDepuis?: string | null
  montantSigne?: number | null
  devisSigneDepose?: boolean
  commissionEncaissee?: boolean
}) {
  const [note, setNote] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const envoiEnCours = useRef(false)
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
  const rdvCanonique = dateRdv && Number.isFinite(new Date(dateRdv).getTime()) ? new Date(dateRdv) : null
  const rdvInfo = rdvCanonique
    ? format(rdvCanonique, "d MMMM yyyy 'à' HH:mm", { locale: fr })
    : dateRdv === undefined ? [...suivis].reverse().find((s) => s.statut === 'rdv_pris' && s.message)?.message : null

  // UN APPUI NE DOIT PAS SUFFIRE À CHANGER L'ARGENT.
  //
  // Les étapes sont de grands boutons empilés, sur un téléphone, sur un
  // chantier. L'audit a montré qu'un appui de travers :
  //  - sur « Projet terminé » ou « Devis signé » déclarait l'affaire gagnée et
  //    créait une commission due à Celexia (28 190 € signés d'un seul doigt) ;
  //  - sur une étape antérieure au devis effaçait le devis déposé et son
  //    montant, sans retour possible — la base les retire en redescendant.
  // Ces deux gestes demandent maintenant une confirmation qui dit, en clair,
  // ce qui va se passer.
  const [aConfirmer, setAConfirmer] = useState<{
    titre: string
    texte: string
    bouton: string
    action: () => void
  } | null>(null)
  const rangDevisEnvoye = PARCOURS.indexOf('devis_envoye')
  const devisEnJeu = rangCourant >= rangDevisEnvoye && (devisDepose || (montantDevis ?? 0) > 0)
  const leDevis =
    montantDevis && montantDevis > 0 ? `votre devis de ${formatEuros(montantDevis)}` : 'votre devis déposé'

  /** Ce qu'il faut confirmer avant d'aller à cette étape, ou null. */
  function confirmationPour(cle: string): { titre: string; texte: string; bouton: string } | null {
    const cible = PARCOURS.indexOf(cle as (typeof PARCOURS)[number])
    if ((cle === 'devis_signe' || cle === 'termine') && rangCourant < cible) {
      return {
        titre: cle === 'termine' ? 'Déclarer le chantier terminé ?' : 'Le client a-t-il signé ?',
        texte:
          (cle === 'termine'
            ? 'Un chantier terminé est une affaire signée. '
            : '') +
          'Celexia facturera sa commission sur le montant signé' +
          (montantDevis && montantDevis > 0 ? ` (${formatEuros(montantDevis)} aujourd’hui)` : '') +
          '. Ne confirmez que si le client a bien signé le devis.',
        bouton: cle === 'termine' ? 'Oui, chantier terminé' : 'Oui, le client a signé',
      }
    }
    if (rangCourant >= PARCOURS.indexOf('devis_signe') && cible >= 0 && cible < PARCOURS.indexOf('devis_signe')) {
      return {
        titre: 'Annuler la signature déclarée ?',
        texte: `Ce chantier repassera en cours. Le montant signé${montantSigne != null ? ` de ${formatEuros(montantSigne)}` : ''} et le devis signé seront retirés du suivi ; les indicateurs et la commission seront recalculés. Ne confirmez que pour corriger une erreur de déclaration.`,
        bouton: 'Confirmer la correction',
      }
    }
    if (devisEnJeu && cible >= 0 && cible < rangDevisEnvoye) {
      return {
        titre: `Revenir à « ${SUIVI_STATUTS[cle as keyof typeof SUIVI_STATUTS]?.label ?? cle} » ?`,
        texte: `Revenir avant le devis retire ${leDevis} du suivi : il faudra le déposer à nouveau. Pour noter un nouveau rendez-vous sans reculer, écrivez-le plutôt dans une note.`,
        bouton: 'Revenir quand même',
      }
    }
    return null
  }

  /** Aller à une étape, en demandant confirmation quand l'argent est en jeu. */
  function allerA(cle: string, action: () => void) {
    if (envoiEnCours.current) return
    const cible = PARCOURS.indexOf(cle as (typeof PARCOURS)[number])
    if (cible >= 0 && cible < PARCOURS.indexOf('devis_signe') && (devisSigneDepose || commissionEncaissee)) {
      toast.error(messageErreurSuivi(commissionEncaissee ? 'commission_encaissee' : 'devis_signe_depose'))
      return
    }
    const c = confirmationPour(cle)
    if (c) setAConfirmer({ ...c, action })
    else action()
  }

  async function poster(statut?: string, message?: string, dateRdv?: string): Promise<boolean> {
    if (envoiEnCours.current) return false
    envoiEnCours.current = true
    setEnvoi(true)
    try {
      const { data, error } = await supabase.rpc('add_suivi_by_token', {
        p_token: token,
        p_statut: statut ?? null,
        p_message: message ?? null,
        p_date_rdv: dateRdv ?? null,
      })
      const ok = (data as { ok?: boolean } | null)?.ok
      if (error || !ok) throw error ?? data
      if (!statut) setNote((actuelle) => actuelle.trim() === message?.trim() ? '' : actuelle)
      toast.success('Mis à jour. Merci !')
      onChange()
      return true
    } catch (erreur) {
      toast.error(messageErreurSuivi(erreur))
      return false
    } finally {
      envoiEnCours.current = false
      setEnvoi(false)
    }
  }

  // Confirme « RDV pris » avec sa date : consignée dans le suivi ET enregistrée
  // en clair (date_rdv) pour la relance post-RDV automatique.
  /** Pose ou retire la date de rappel. `null` annule. */
  async function enregistrerRappel(quand: Date | null) {
    if (envoiEnCours.current) return
    envoiEnCours.current = true
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
      envoiEnCours.current = false
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
    const envoyerRdv = async () => {
      if (await poster('rdv_pris', txt, dt.toISOString())) {
        setRdvMode(false)
        setRdvHeure('')
      }
    }
    // Un second rendez-vous pris après le devis fait RECULER le chantier : on
    // le dit avant que le devis ne disparaisse du suivi.
    allerA('rdv_pris', () => void envoyerRdv())
  }

  // Logue une tentative d'appel (surtout « pas de réponse » : on saura qu'il a essayé).
  async function loggerAppel(resultat: string) {
    if (envoiEnCours.current) return
    envoiEnCours.current = true
    setEnvoi(true)
    try {
      const { data, error } = await supabase.rpc('log_appel_by_token', {
        p_token: token,
        p_resultat: resultat,
      })
      const ok = (data as { ok?: boolean } | null)?.ok
      if (error || !ok) throw error ?? data
      toast.success('Appel enregistré. Merci !')
      onChange()
    } catch (erreur) {
      toast.error(messageErreurSuivi(erreur, "Impossible d'enregistrer l'appel"))
    } finally {
      envoiEnCours.current = false
      setEnvoi(false)
    }
  }

  return (
    <Card className="gap-5 rounded-[10px] border-border bg-card py-4 shadow-none">
      <CardHeader className="gap-2 px-4">
        <CardTitle className="text-base font-semibold">Où en êtes-vous ?</CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Cliquez sur l'étape où vous en êtes. Celexia est informé en direct — vous ne serez pas
          relancé inutilement.
        </p>
      </CardHeader>
      <AlertDialog open={!!aConfirmer} onOpenChange={(o) => !o && setAConfirmer(null)}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[10px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{aConfirmer?.titre}</AlertDialogTitle>
            <AlertDialogDescription>{aConfirmer?.texte}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              onClick={() => {
                const a = aConfirmer?.action
                setAConfirmer(null)
                a?.()
              }}
            >
              {aConfirmer?.bouton}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CardContent className="space-y-5 px-4">
        {/* Parcours d'avancement */}
        <div className="space-y-1" role="group" aria-label="Avancement du chantier">
          {PARCOURS.map((cle, idx) => {
            const conf = SUIVI_STATUTS[cle]
            const estRdv = cle === 'rdv_pris'
            const active = statutActuel === cle
            // Franchi = strictement avant l'étape courante. Corriger une étape
            // en arrière éteint donc bien les pastilles au-delà.
            const done = !active && rangCourant > idx

            return (
              <div key={cle}>
                <button
                  type="button"
                  disabled={envoi}
                  aria-current={active ? 'step' : undefined}
                  onClick={() => {
                    if (estRdv) {
                      if (!rdvMode) {
                        setRdvDate(rdvCanonique ?? undefined)
                        setRdvHeure(rdvCanonique ? format(rdvCanonique, 'HH:mm') : '')
                      }
                      setRdvMode((v) => !v)
                    }
                    else if (!active || enAttenteDepuis) allerA(cle, () => void poster(cle))
                  }}
                  className={cn(
                    'group flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                    active ? 'border-primary/20 bg-primary/5' : 'border-transparent hover:bg-muted/60',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-medium',
                      active ? 'bg-primary text-primary-foreground' : done ? 'bg-secondary text-foreground' : 'border border-border text-muted-foreground',
                    )}
                  >
                    {done ? <Check className="size-4" /> : idx + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', active || done ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                      {conf.label}
                    </span>
                    {estRdv && rdvInfo && (
                      <span className="mt-1 block break-words text-xs text-muted-foreground">{rdvInfo}</span>
                    )}
                  </span>
                  {active && <span className="shrink-0 text-xs font-medium text-primary">En cours</span>}
                </button>

                {/* Panneau date du RDV (obligatoire) */}
                {estRdv && rdvMode && (
                  <div className="my-3 space-y-3 rounded-lg border border-border bg-muted/30 p-3 sm:ml-12">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <CalendarIcon className="size-4 text-muted-foreground" />
                      Quelle est la date du rendez-vous ?
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              'h-11 min-w-0 flex-1 justify-start bg-card font-normal',
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
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" className="min-h-11 flex-1 bg-card" onClick={() => setRdvMode(false)} disabled={envoi}>
                        Annuler
                      </Button>
                      <Button className="min-h-11 flex-1" onClick={() => void confirmerRdv()} disabled={envoi || !rdvDate}>
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
        <div className="space-y-3 border-t border-border pt-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Phone className="size-3.5" />
            Journal des appels
          </p>
          <p className="text-sm text-muted-foreground">Vous avez essayé d'appeler le client ?</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="min-h-11 bg-card" disabled={envoi} onClick={() => void loggerAppel('pas_de_reponse')}>
              <PhoneMissed className="size-4" /> Pas de réponse
            </Button>
            <Button variant="outline" size="sm" className="min-h-11 bg-card" disabled={envoi} onClick={() => void loggerAppel('repondu')}>
              <PhoneCall className="size-4" /> Je l'ai eu
            </Button>
            <Button variant="outline" size="sm" className="min-h-11 bg-card" disabled={envoi} onClick={() => void loggerAppel('rappeler')}>
              <Phone className="size-4" /> À rappeler
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Ces boutons ajoutent une trace d’appel. Après avoir joint le client, indiquez aussi son étape. Pour un rappel daté, utilisez « Me le rappeler plus tard ».
          </p>
        </div>

        {/* Rappel — un CO-statut : le chantier garde son étape, on note juste
            quand le reprendre. « Il signera à son retour le 5 » ne fait pas
            reculer un devis envoyé. */}
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          {rappelLe && !rappelMode ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm">
                <Bell className="size-4 shrink-0 text-muted-foreground" />
                <span>
                  À reprendre le{' '}
                  <strong>{format(new Date(rappelLe), 'EEEE d MMMM', { locale: fr })}</strong>
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="min-h-11" disabled={envoi}
                        onClick={() => { setRappelDate(new Date(rappelLe)); setRappelMode(true) }}>
                  Modifier
                </Button>
                <Button size="sm" variant="ghost" className="min-h-11" disabled={envoi}
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
              className="flex min-h-11 w-full items-start gap-3 rounded-md text-left text-sm leading-relaxed text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                <Bell className="size-4 text-muted-foreground" />
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
              <div className="flex flex-wrap gap-2">
                <Button
                  className="min-h-11 flex-1"
                  disabled={envoi || !rappelDate}
                  onClick={() => rappelDate && void enregistrerRappel(rappelDate)}
                >
                  Programmer le rappel
                </Button>
                <Button variant="ghost" className="min-h-11" disabled={envoi}
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
            const active = cle === 'en_attente' ? Boolean(enAttenteDepuis) : statutActuel === cle
            return (
              <button
                key={cle}
                type="button"
                disabled={envoi}
                onClick={() => {
                  if (active) {
                    if (cle === 'en_attente') void poster('reprendre')
                    return
                  }
                  if (cle === 'perdu') setPerduMode(true)
                  else void poster(cle)
                }}
                aria-pressed={active}
                title={cle === 'en_attente' && active ? 'Reprendre le suivi sans changer d’étape' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'border-foreground/30 bg-secondary text-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted',
                )}
              >
                {cle === 'perdu' ? <XCircle className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
                {conf.label}
              </button>
            )
          })}
        </div>

        {enAttenteDepuis && <p className="text-xs text-muted-foreground">Ce chantier est en pause. Cliquez sur « En attente » ou sur son étape pour reprendre le suivi.</p>}

        {/* Justification OBLIGATOIRE quand on déclare « perdu » */}
        {perduMode && (
          <div className="space-y-3 rounded-lg border border-destructive/25 bg-card p-4">
            <p className="text-sm font-medium text-destructive">Pourquoi ce chantier est-il perdu ?</p>
            <p className="text-xs text-muted-foreground">
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
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="min-h-11 flex-1 bg-card"
                disabled={envoi}
                onClick={() => {
                  setPerduMode(false)
                  setPerduRaison('')
                }}
              >
                Annuler
              </Button>
              <Button
                className="min-h-11 flex-1"
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
            className="min-h-11 w-full"
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
              <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
                Échanges avec Celexia
                {nonLus > 0 && (
                  <span className="text-xs font-medium text-primary">
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
