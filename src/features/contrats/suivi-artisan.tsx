import { useState } from 'react'
import { Upload, Check, CalendarIcon, Loader2 } from 'lucide-react'
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
import { SUIVI_ORDRE, SUIVI_STATUTS } from '@/lib/constants'
import type { Suivi } from '@/types/database'
import { SuiviTimeline } from '@/features/projets/components/suivi-timeline'

// Suivi côté artisan : boutons de statut + note libre (ce qui s'est dit).
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
  /** Statut courant du chantier — sert UNIQUEMENT à mettre le bouton en surbrillance. */
  statutActuel?: string
}) {
  const [note, setNote] = useState('')
  const [envoi, setEnvoi] = useState(false)
  // Saisie obligatoire de la date quand l'artisan déclare « RDV pris »
  const [rdvMode, setRdvMode] = useState(false)
  const [rdvDate, setRdvDate] = useState<Date | undefined>(undefined)
  const [rdvHeure, setRdvHeure] = useState('')

  async function poster(statut?: string, message?: string): Promise<boolean> {
    setEnvoi(true)
    try {
      const { data, error } = await supabase.rpc('add_suivi_by_token', {
        p_token: token,
        p_statut: statut ?? null,
        p_message: message ?? null,
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

  // Confirme « RDV pris » avec sa date (et heure éventuelle) consignée dans le suivi.
  async function confirmerRdv() {
    if (!rdvDate) return toast.error('Choisissez la date du rendez-vous')
    const txt = `RDV pris le ${format(rdvDate, 'EEEE d MMMM yyyy', { locale: fr })}${
      rdvHeure.trim() ? ` à ${rdvHeure.trim()}` : ''
    }`
    if (await poster('rdv_pris', txt)) {
      setRdvMode(false)
      setRdvHeure('')
    }
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Où en êtes-vous ?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Indiquez votre avancement (Celexia est tenu informé en temps réel) :
        </p>
        <div
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          role="group"
          aria-label="Mettre à jour le statut du chantier"
        >
          {SUIVI_ORDRE.map((s) => {
            const conf = SUIVI_STATUTS[s]
            const estRdv = s === 'rdv_pris'
            const actif = statutActuel === s || (estRdv && rdvMode)
            return (
              <button
                key={s}
                type="button"
                disabled={envoi}
                onClick={() => (estRdv ? setRdvMode((v) => !v) : poster(s))}
                aria-pressed={actif}
                aria-expanded={estRdv ? rdvMode : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  actif
                    ? 'border-transparent text-white shadow-sm'
                    : 'bg-card text-foreground hover:-translate-y-px hover:shadow-sm active:translate-y-0',
                )}
                style={
                  actif
                    ? { backgroundColor: conf.color }
                    : { borderColor: `${conf.color}55` }
                }
              >
                <span className="text-base leading-none" aria-hidden>
                  {conf.emoji}
                </span>
                <span className="min-w-0 flex-1">{conf.label}</span>
                {actif && <Check className="size-4 shrink-0" aria-hidden />}
              </button>
            )
          })}
        </div>

        {/* Saisie de la date du RDV (obligatoire) — apparaît au clic sur « RDV pris » */}
        {rdvMode && (
          <div className="space-y-3 rounded-xl border border-[#8B5CF6]/40 bg-[#8B5CF6]/5 p-3">
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
              <Button
                variant="outline"
                className="flex-1 bg-card"
                onClick={() => setRdvMode(false)}
                disabled={envoi}
              >
                Annuler
              </Button>
              <Button className="flex-1" onClick={() => void confirmerRdv()} disabled={envoi || !rdvDate}>
                {envoi ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Confirmer le RDV
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Textarea
            placeholder="Racontez ce qui s'est dit pendant l'appel (besoins, délais, objections…)"
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
            <Upload className="size-4" />
            Envoyer la note
          </Button>
        </div>
        {suivis.length > 0 && (
          <>
            <Separator />
            <SuiviTimeline suivis={suivis} />
          </>
        )}
      </CardContent>
    </Card>
  )
}
