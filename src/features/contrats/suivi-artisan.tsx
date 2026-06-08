import { useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
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
}: {
  token: string
  suivis: Suivi[]
  onChange: () => void
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
        <div className="grid grid-cols-2 gap-2">
          {SUIVI_ORDRE.map((s) => (
            <Button
              key={s}
              variant="outline"
              disabled={envoi}
              onClick={() => poster(s)}
              className="justify-start"
              style={{ borderColor: SUIVI_STATUTS[s].color }}
            >
              <span>{SUIVI_STATUTS[s].emoji}</span> {SUIVI_STATUTS[s].label}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <Textarea
            placeholder="Racontez ce qui s'est dit pendant l'appel (besoins, délais, objections…)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
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
