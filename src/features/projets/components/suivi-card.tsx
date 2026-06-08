import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useSuivis, useAddSuiviAgence } from '../hooks/use-suivis'
import { SuiviTimeline } from './suivi-timeline'

// Carte "Suivi du chantier" côté agence : voir le parcours déclaré par l'artisan
// (contacté, RDV, devis…) + ses notes, et ajouter une note interne.
export function SuiviCard({ projetId }: { projetId: string }) {
  const { data: suivis, isLoading } = useSuivis(projetId)
  const add = useAddSuiviAgence()
  const [msg, setMsg] = useState('')

  function envoyer() {
    const m = msg.trim()
    if (!m) return
    add.mutate(
      { projetId, message: m },
      {
        onSuccess: () => setMsg(''),
        onError: (e) =>
          toast.error('Ajout impossible', { description: e instanceof Error ? e.message : undefined }),
      },
    )
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Suivi du chantier</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <SuiviTimeline suivis={suivis ?? []} />
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <Textarea
            placeholder="Note interne (visible aussi par l'artisan dans son espace)…"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={2}
          />
          <Button size="sm" onClick={envoyer} disabled={add.isPending || !msg.trim()}>
            {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Ajouter une note
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
