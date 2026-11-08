import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileSignature, CalendarClock, FileClock, ChevronRight } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { supabase } from '@/lib/supabase/client'
import { DashboardFeedback } from './dashboard-feedback'

interface ActionData {
  contrats: number
  rdv: number
  devis: number
}

/** Les attributions et commissions sont déjà dans ATraiter ; ici, le suivi. */
export function ActionDuJour() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['action-du-jour'],
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ActionData> => {
      const { data, error } = await supabase.rpc('action_du_jour')
      if (error) throw error
      return data as ActionData
    },
  })

  if (isLoading) return <Skeleton className="h-16 w-full rounded-xl" />
  if (isError || !data) return <DashboardFeedback message="Les relances n’ont pas pu être chargées" retry={() => void refetch()} />

  const items = [
    { cle: 'contrats', n: data.contrats, label: 'Contrats à faire signer', icon: FileSignature, to: '/projets?tri=a_signer' },
    { cle: 'rdv', n: data.rdv, label: 'Rendez-vous passés sans suivi', icon: CalendarClock, to: '/projets?statut=rdv_pris' },
    { cle: 'devis', n: data.devis, label: 'Devis envoyés à relancer', icon: FileClock, to: '/projets?statut=devis_envoye' },
  ].filter((i) => i.n > 0)

  return (
    <section aria-labelledby="relances-titre" className="border-t border-border">
      <h3 id="relances-titre" className="px-5 pb-1 pt-4 text-[13px] font-medium">Relances</h3>
      {items.length === 0 ? <p className="px-5 pb-5 pt-2 text-xs text-muted-foreground">Aucun contrat, rendez-vous ou devis à relancer</p> : (
        <ul className="pb-2">
          {items.map(({ cle, n, label, icon: Icon, to }) => (
            <li key={cle}>
              <Link to={to} className="flex min-h-11 items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/60">
                <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">{label}</span>
                <span className="text-[13px] font-medium tabular-nums">{n}</span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
