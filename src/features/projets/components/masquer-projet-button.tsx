import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import type { Projet } from '@/types/database'
import { invaliderDonneesProjets } from '../lib/invalidation'

export function MasquerProjetButton({ projet, compact = false }: {
  projet: Pick<Projet, 'id' | 'client_nom' | 'masque_agence_at'>
  compact?: boolean
}) {
  const qc = useQueryClient()
  const masque = Boolean(projet.masque_agence_at)
  const mutation = useMutation({
    mutationFn: async (masquer: boolean) => {
      const { data, error } = await supabase.rpc('masquer_projet', { p_projet_id: projet.id, p_masque: masquer })
      if (error) throw error
      if (!(data as { ok?: boolean })?.ok) throw new Error('La modification n’a pas été enregistrée.')
    },
    onSuccess: (_, masquer) => {
      void invaliderDonneesProjets(qc)
      toast.success(masquer ? 'Projet masqué, dossier conservé' : 'Projet remis dans le pipeline', {
        action: { label: 'Annuler', onClick: () => mutation.mutate(!masquer) },
      })
    },
    onError: () => toast.error('Visibilité inchangée. Réessayez.'),
  })
  return <Button variant={compact ? 'ghost' : 'outline'} size="sm" disabled={mutation.isPending}
    aria-label={`${masque ? 'Restaurer' : 'Masquer'} ${projet.client_nom}`}
    onClick={() => mutation.mutate(!masque)}>
    {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : masque ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
    {masque ? 'Remettre dans le pipeline' : 'Masquer'}
  </Button>
}
