import { useState } from 'react'
import { Upload, Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
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

  async function poster(statut?: string, message?: string) {
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
    } catch {
      toast.error("Impossible d'enregistrer")
    } finally {
      setEnvoi(false)
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
            const actif = statutActuel === s
            return (
              <button
                key={s}
                type="button"
                disabled={envoi}
                onClick={() => poster(s)}
                aria-pressed={actif}
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
