import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, Euro, Inbox, RotateCcw, Wallet } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'

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
  const { data, isLoading } = useQuery({
    queryKey: ['a-traiter'],
    queryFn: async (): Promise<ATraiter> => {
      const { data, error } = await supabase.rpc('a_traiter')
      if (error) throw error
      return data as ATraiter
    },
  })

  if (isLoading) return <Skeleton className="mb-5 h-40 rounded-2xl" />
  if (!data) return null

  const lignes = [
    {
      cle: 'leads',
      actif: data.leads_neufs > 0,
      to: '/projets?pipe=neuf',
      icone: Inbox,
      titre: `${data.leads_neufs} lead${data.leads_neufs > 1 ? 's' : ''} à attribuer`,
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
      titre: `${formatEuros(data.a_encaisser_montant)} à encaisser`,
      detail: `${data.a_encaisser_n} chantier${data.a_encaisser_n > 1 ? 's' : ''} signé${data.a_encaisser_n > 1 ? 's' : ''}, commission non perçue`,
      urgent: false,
    },
    {
      cle: 'reprendre',
      actif: data.a_reprendre > 0,
      to: '/projets/a-reattribuer',
      icone: RotateCcw,
      titre: `${data.a_reprendre} chantier${data.a_reprendre > 1 ? 's' : ''} à replacer`,
      detail:
        data.repris_en_cours > 0
          ? `${data.repris_en_cours} déjà repris par un commercial`
          : 'plus aucun artisan dessus',
      urgent: false,
    },
    {
      cle: 'verser',
      actif: Number(data.a_verser) > 0,
      to: '/reprises',
      icone: Wallet,
      titre: `${formatEuros(data.a_verser)} à verser`,
      detail: 'commissions dues aux commerciaux',
      urgent: false,
    },
  ].filter((l) => l.actif)

  if (lignes.length === 0) {
    return (
      <Card className="mb-5 rounded-2xl border-[#16A34A]/30 bg-[#16A34A]/5 p-4 shadow-card">
        <p className="text-sm font-medium">Rien à traiter dans l’immédiat.</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Tous les leads sont attribués et les commissions sont à jour.
        </p>
      </Card>
    )
  }

  return (
    <div className="mb-5">
      <h2 className="mb-2 font-display text-lg tracking-tight">À traiter</h2>
      <div className="space-y-2">
        {lignes.map(({ cle, to, icone: Icone, titre, detail, urgent }) => (
          <Link key={cle} to={to} className="block">
            <Card
              className={cn(
                'flex items-center gap-3 rounded-2xl p-3.5 shadow-card transition-all',
                'hover:shadow-card-hover active:scale-[0.99]',
                urgent ? 'border-[#F59E0B]/40 bg-[#F59E0B]/5' : 'border-border/70',
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full',
                  urgent ? 'bg-[#F59E0B]/15 text-[#B45309]' : 'bg-primary/10 text-primary',
                )}
              >
                <Icone className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium tabular-nums">{titre}</p>
                <p className="truncate text-xs text-muted-foreground">{detail}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Card>
          </Link>
        ))}
      </div>

      {/* Le pipe artisan : ce n'est pas une action, mais c'est le risque
          principal quand la quasi-totalité des chantiers part chez un seul
          partenaire. */}
      <Card className="mt-2 rounded-2xl border-border/70 p-3.5 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm">
            <strong className="tabular-nums">{data.chez_artisan}</strong> chantiers chez un
            artisan
          </p>
          {data.chez_artisan_dormants > 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-[#B45309]">
              <AlertTriangle className="size-3.5 shrink-0" />
              {data.chez_artisan_dormants} sans mouvement depuis 3 semaines
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">tous suivis récemment</p>
          )}
        </div>
      </Card>
    </div>
  )
}
