import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Inbox, FileSignature, CalendarClock, FileClock, BadgeEuro, CheckCircle2 } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabase/client'
import { formatEuros } from '@/lib/format'

interface ActionData {
  leads: number
  contrats: number
  rdv: number
  devis: number
  commissions_n: number
  commissions_total: number
}

function useActionDuJour() {
  return useQuery({
    queryKey: ['action-du-jour'],
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ActionData> => {
      const { data, error } = await supabase.rpc('action_du_jour')
      if (error) throw error
      return data as ActionData
    },
  })
}

// Bandeau « Action du jour » : tout ce qui demande une action, en un coup d'œil.
export function ActionDuJour() {
  const { data } = useActionDuJour()
  if (!data) return null

  const items = [
    {
      cle: 'leads',
      n: data.leads,
      label: 'Leads à attribuer',
      icon: Inbox,
      color: '#3B82F6',
      to: '/projets?statut=nouveau',
    },
    {
      cle: 'contrats',
      n: data.contrats,
      label: 'Contrats à faire signer',
      icon: FileSignature,
      color: '#F59E0B',
      to: '/projets?tri=a_signer',
    },
    {
      cle: 'rdv',
      n: data.rdv,
      label: 'RDV passés sans suivi',
      icon: CalendarClock,
      color: '#8B5CF6',
      to: '/projets?statut=rdv_pris',
    },
    {
      cle: 'devis',
      n: data.devis,
      label: 'Devis envoyés à relancer',
      icon: FileClock,
      color: '#0EA5E9',
      to: '/projets?statut=devis_envoye',
    },
    {
      cle: 'commissions',
      n: data.commissions_n,
      label: 'Commissions à encaisser',
      sous: data.commissions_total > 0 ? formatEuros(data.commissions_total) : undefined,
      icon: BadgeEuro,
      color: '#22C55E',
      to: '/commissions',
    },
  ].filter((i) => i.n > 0)

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Action du jour</h2>
      {items.length === 0 ? (
        <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <CheckCircle2 className="size-5 text-[#22C55E]" />
          Tout est à jour — rien à traiter dans l'immédiat. 🎉
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((i) => (
            <Link key={i.cle} to={i.to}>
              <Card className="flex h-full flex-col gap-1 p-3 transition-colors hover:bg-accent/40">
                <div className="flex items-center gap-1.5">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${i.color}1a`, color: i.color }}
                  >
                    <i.icon className="size-4" />
                  </span>
                  <span className="montant text-2xl font-semibold leading-none">{i.n}</span>
                </div>
                <p className="text-xs leading-tight text-muted-foreground">{i.label}</p>
                {i.sous && <p className="text-xs font-medium text-primary">{i.sous}</p>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
