import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, Euro, Inbox, RotateCcw, Ruler, Wallet } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { formatEuros } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'
import { DashboardFeedback } from './dashboard-feedback'

interface ATraiter {
  leads_neufs: number
  leads_neufs_vieux: number
  a_encaisser_n: number
  a_encaisser_montant: number
  a_reprendre: number
  repris_en_cours: number
  a_verser: number
  chez_artisan: number
  chez_artisan_dormants: number
  /** Chantiers où la parole du client et la mesure divergent (0173). */
  metrages_a_verifier?: number
}

/**
 * Ce qu'il faut traiter aujourd'hui.
 *
 * Le tableau de bord ouvrait sur des totaux cumulés : utiles pour un bilan,
 * inutiles pour décider quoi faire ce matin. Ces quatre lignes sont les seules
 * qui appellent une action, et chacune mène directement à l'écran concerné.
 *
 * Une ligne à zéro disparaît — un tableau de bord qui affiche « 0 » partout
 * n'apprend rien et noie les vrais signaux.
 */
export function ATraiter() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['a-traiter'],
    queryFn: async (): Promise<ATraiter> => {
      const { data, error } = await supabase.rpc('a_traiter')
      if (error) throw error
      return data as ATraiter
    },
  })

  if (isLoading) return <Skeleton className="h-32 rounded-xl" />
  if (isError || !data) return <DashboardFeedback message="Les priorités n’ont pas pu être chargées" retry={() => void refetch()} />

  const lignes = [
    {
      cle: 'leads',
      actif: data.leads_neufs > 0,
      to: '/projets?file=attribution',
      icone: Inbox,
      titre: 'Projets à attribuer',
      valeur: String(data.leads_neufs),
      detail:
        data.leads_neufs_vieux > 0
          ? `dont ${data.leads_neufs_vieux} depuis plus de 3 jours`
          : 'jamais partis chez un artisan',
      urgent: data.leads_neufs_vieux > 0,
    },
    {
      cle: 'encaisser',
      actif: data.a_encaisser_n > 0,
      to: '/commissions',
      icone: Euro,
      titre: 'Commissions à encaisser',
      valeur: formatEuros(data.a_encaisser_montant),
      detail: `${data.a_encaisser_n} chantier${data.a_encaisser_n > 1 ? 's' : ''} signé${data.a_encaisser_n > 1 ? 's' : ''}, commission non perçue`,
      urgent: false,
    },
    {
      cle: 'reprendre',
      actif: data.a_reprendre > 0,
      to: '/projets/a-reattribuer',
      icone: RotateCcw,
      titre: 'Chantiers à réattribuer',
      valeur: String(data.a_reprendre),
      detail:
        data.repris_en_cours > 0
          ? `${data.repris_en_cours} déjà repris par un commercial`
          : 'plus aucun artisan dessus',
      urgent: false,
    },
    {
      cle: 'metrages',
      actif: (data.metrages_a_verifier ?? 0) > 0,
      to: '/metres-a-verifier',
      icone: Ruler,
      titre: 'Métrés à vérifier',
      valeur: String(data.metrages_a_verifier ?? 0),
      detail: 'ce que dit le client ne concorde pas avec la mesure',
      urgent: false,
    },
    {
      cle: 'verser',
      actif: Number(data.a_verser) > 0,
      to: '/reprises',
      icone: Wallet,
      titre: 'Commissions à verser',
      valeur: formatEuros(data.a_verser),
      detail: 'commissions dues aux commerciaux',
      urgent: false,
    },
  ].filter((l) => l.actif)

  return (
    <div>
      {lignes.length === 0 && <p className="px-5 py-5 text-[13px] leading-relaxed text-muted-foreground">Aucune attribution, réattribution, commission ou vérification de métré en attente</p>}
      <ul className="divide-y divide-border">
        {lignes.map(({ cle, to, icone: Icone, titre, valeur, detail, urgent }) => (
          <li key={cle}>
            <Link to={to} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/60">
              <Icone className={`size-4 shrink-0 ${urgent ? 'text-amber-700' : 'text-muted-foreground'}`} strokeWidth={1.5} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{titre}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
              </div>
              <span className="shrink-0 text-[13px] font-medium tabular-nums">{valeur}</span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-5 py-3">
        <p className="text-xs text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{data.chez_artisan}</span> chantiers chez un artisan</p>
        {data.chez_artisan_dormants > 0 && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-800"><AlertTriangle className="size-3.5 shrink-0" aria-hidden />{data.chez_artisan_dormants} sans mouvement depuis 3 semaines</p>
        )}
      </div>
    </div>
  )
}
