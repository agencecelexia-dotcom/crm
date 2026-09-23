import { useQuery } from '@tanstack/react-query'
import { Ruler } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabase/client'
import { formatM, formatM2 } from './geometrie'
import type { Metre } from './use-metres'

/**
 * Les métrés d'un chantier, vus de l'agence.
 *
 * Antoine qualifie au téléphone : savoir qu'une toiture fait 140 m² avant
 * d'en parler change la conversation, et permet de voir si un devis est
 * cohérent avec la surface réelle.
 *
 * La lecture passe par la RLS ordinaire (`metres_par_projet`, calquée sur
 * celle des devis) : chacun voit les mesures des projets qu'il voit.
 */
export function CarteMetresProjet({ projetId }: { projetId: string }) {
  const { data: metres } = useQuery({
    queryKey: ['metres-projet', projetId],
    queryFn: async (): Promise<Metre[]> => {
      const { data, error } = await supabase
        .from('metres')
        .select(
          'id, nom, type, geometrie, surface_m2, perimetre_m, longueur_m, hauteur_m, pente_pct, surface_reelle_m2, source, created_at',
        )
        .eq('projet_id', projetId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data as Metre[]) ?? []
    },
  })

  // Pas de carte vide : tant que l'artisan n'a rien mesuré, il n'y a rien à dire.
  if (!metres?.length) return null

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-medium">
        <Ruler className="size-4 text-primary" />
        Métrés
        <span className="text-sm font-normal text-muted-foreground">({metres.length})</span>
      </h2>
      <ul className="space-y-2">
        {metres.map((m) => (
          <li key={m.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {m.nom}
              {m.pente_pct ? (
                <span className="text-muted-foreground"> · pente {m.pente_pct} %</span>
              ) : null}
              {m.hauteur_m ? (
                <span className="text-muted-foreground"> · h. {formatM(Number(m.hauteur_m))}</span>
              ) : null}
            </span>
            <span className="montant shrink-0 font-medium">
              {m.type === 'surface'
                ? formatM2(Number(m.surface_reelle_m2 ?? m.surface_m2 ?? 0))
                : formatM(Number(m.longueur_m ?? 0))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Relevés par l’artisan sur photo aérienne — bons pour chiffrer, pas au centimètre.
      </p>
    </Card>
  )
}
