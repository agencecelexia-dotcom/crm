import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

// Notifications in-app (alertes « à appeler » générées par les escalades).
export interface Notification {
  id: string
  type: string
  titre: string
  message: string | null
  projet_id: string | null
  lu: boolean
  created_at: string
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('lu', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as Notification[]
    },
  })
}

export function useMarquerLue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notifications').update({ lu: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useToutMarquerLu() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('notifications').update({ lu: true }).eq('lu', false)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
