import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Send, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase/client'

/**
 * Écrire à l'artisan dans le fil d'un chantier.
 *
 * L'agence n'avait aucune voix dans le dossier : l'artisan pouvait envoyer une
 * note, personne ne pouvait lui répondre, et tous les événements étaient
 * attribués à « Artisan » (audit §5). Une consigne marquée « à traiter »
 * ressort en tête du fil côté artisan.
 */
export function MessageArtisan({
  affectationId,
  projetId,
  nomArtisan,
}: {
  affectationId: string
  projetId: string
  nomArtisan: string
}) {
  const [message, setMessage] = useState('')
  const [prioritaire, setPrioritaire] = useState(false)
  const qc = useQueryClient()

  const envoyer = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('message_agence', {
        p_affectation_id: affectationId,
        p_message: message.trim(),
        p_prioritaire: prioritaire,
      })
      const r = data as { ok?: boolean; error?: string } | null
      if (error || !r?.ok) {
        throw new Error(
          r?.error === 'message_vide' ? 'Le message est vide.' : "L'envoi a échoué.",
        )
      }
    },
    onSuccess: () => {
      setMessage('')
      setPrioritaire(false)
      qc.invalidateQueries({ queryKey: ['suivis', projetId] })
      qc.invalidateQueries({ queryKey: ['affectations', projetId] })
      toast.success('Message envoyé', { description: `${nomArtisan} le verra dans son espace.` })
    },
    onError: (e) =>
      toast.error('Envoi impossible', {
        description: e instanceof Error ? e.message : undefined,
      }),
  })

  const valide = message.trim().length >= 2

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <Label htmlFor={`msg-${affectationId}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Écrire à {nomArtisan}
      </Label>
      <Textarea
        id={`msg-${affectationId}`}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Ex. : client prioritaire, à rappeler avant vendredi."
        rows={2}
        disabled={envoyer.isPending}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`prio-${affectationId}`}
            checked={prioritaire}
            onCheckedChange={(v) => setPrioritaire(v === true)}
            disabled={envoyer.isPending}
          />
          <Label
            htmlFor={`prio-${affectationId}`}
            className="flex cursor-pointer items-center gap-1 text-xs font-normal"
          >
            <AlertTriangle className="size-3.5 text-[#B45309]" />
            Marquer « à traiter »
          </Label>
        </div>
        <Button
          size="sm"
          disabled={!valide || envoyer.isPending}
          onClick={() => envoyer.mutate()}
        >
          {envoyer.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Envoi…
            </>
          ) : (
            <>
              <Send className="size-4" />
              Envoyer
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
