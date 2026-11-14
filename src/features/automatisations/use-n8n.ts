import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { AutomatisationN8n } from '../../../supabase/functions/_automatisations-n8n'

const MESSAGES: Record<string, string> = {
  connexion_non_configuree: 'La connexion à n8n doit être configurée côté serveur.',
  acces_n8n_refuse: 'n8n refuse l’accès configuré. Son état ne peut pas être vérifié.',
  etat_modifie: 'L’état a changé depuis votre dernier affichage. La liste a été actualisée ; vérifiez-la avant de recommencer.',
  modification_en_cours: 'Une modification est déjà en cours sur cette automatisation.',
  etat_modifie_journal_indisponible: 'L’état a changé dans n8n, mais le journal n’a pas pu être enregistré. Actualisez la liste.',
  reserve_fondateur: 'Seuls les fondateurs peuvent piloter les automatisations.',
  commande_n8n_refusee: 'n8n a refusé la commande. Vérifiez les connexions et la configuration du workflow dans n8n.',
}

async function appelerN8n(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('automatisations-n8n', { body })
  if (error) {
    let code: string | undefined
    if (error.context instanceof Response) {
      try { code = (await error.context.json()).error } catch { /* Connexion coupée. */ }
    }
    throw new Error(MESSAGES[code ?? ''] ?? 'Commande non confirmée. Actualisez pour vérifier l’état réel avant de réessayer.')
  }
  if (data?.error) throw new Error(MESSAGES[data.error] ?? 'Le service d’automatisation est indisponible.')
  return data
}

export function useAutomatisationsN8n() {
  return useQuery({
    queryKey: ['automatisations-n8n'],
    queryFn: async (): Promise<{ workflows: AutomatisationN8n[]; verifie_le: string }> => appelerN8n({ action: 'lister' }),
    refetchInterval: 30_000,
    retry: 1,
  })
}

export function useModifierN8n() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ workflow, active }: { workflow: AutomatisationN8n; active: boolean }) => {
      const data = await appelerN8n({ action: 'modifier', id: workflow.id, active, revision: workflow.revision, confirmer: true })
      qc.setQueryData<{ workflows: AutomatisationN8n[]; verifie_le: string }>(['automatisations-n8n'], (old) => old ? {
        ...old, workflows: old.workflows.map((w) => w.id === data.workflow.id ? data.workflow : w),
      } : old)
    },
    onSettled: async () => { await Promise.all([
      qc.invalidateQueries({ queryKey: ['automatisations-n8n'] }),
      qc.invalidateQueries({ queryKey: ['automatisations-journal'] }),
    ]) },
  })
}

export function useJournalAutomatisations() {
  return useQuery({
    queryKey: ['automatisations-journal'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('automatisations_journal').select('id, source, cle, titre, avant, apres, created_at')
        .order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      return data as { id: number; source: string; cle: string; titre: string; avant: string | null; apres: string; created_at: string }[]
    },
  })
}
