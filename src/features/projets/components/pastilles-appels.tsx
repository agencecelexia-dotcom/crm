import { cn } from '@/lib/utils'

/** Au-delà, insister n'a plus de sens : le client ne décrochera pas. */
export const APPELS_MAX = 5

/**
 * Montant de devis au-dessus duquel on continue d'appeler malgré les échecs.
 *
 * Posé sur la médiane observée de la pile (≈ 17 000 €). À 10-15 % de
 * commission, un tel chantier vaut plusieurs milliers d'euros : abandonner
 * après cinq sonneries coûterait bien plus cher que de rappeler une sixième
 * fois. Le seuil ne s'applique donc qu'aux petits dossiers, où le temps passé
 * dépasse vite ce que le chantier rapporte.
 */
export const MONTANT_ON_INSISTE = 15000

export type ResultatAppel = 'pas_de_reponse' | 'repondu' | 'rappeler' | 'faux_numero'

/**
 * Les tentatives d'appel de L'AGENCE, en cinq pastilles.
 *
 * Verte quand le client a décroché, rouge quand personne n'a répondu, ambre
 * quand il a demandé à être rappelé. Les pastilles restantes sont vides.
 *
 * Ne compte QUE nos appels, et seulement depuis que le chantier est revenu
 * dans la pile (migration 0124). Les tentatives de l'artisan précédent ne
 * disent rien de la nôtre : quand il rend un dossier, le compteur repart de
 * zéro. Les mélanger afficherait l'acharnement de quelqu'un d'autre.
 */
export function PastillesAppels({
  appels,
  className,
}: {
  appels: ResultatAppel[]
  className?: string
}) {
  // Au-delà de cinq, on garde les cinq DERNIERS : ce sont eux qui disent où en
  // est le dossier aujourd'hui.
  const visibles = appels.slice(-APPELS_MAX)
  const surplus = appels.length - visibles.length

  return (
    <span
      className={cn('inline-flex items-center gap-1', className)}
      // Un lecteur d'écran ne voit pas les couleurs : le décompte est écrit.
      aria-label={
        appels.length === 0
          ? 'Jamais appelé'
          : `${appels.length} appel${appels.length > 1 ? 's' : ''}, ` +
            `${appels.filter((a) => a === 'repondu').length} avec réponse`
      }
    >
      {Array.from({ length: APPELS_MAX }, (_, i) => {
        const r = visibles[i]
        return (
          <span
            key={i}
            aria-hidden
            title={r ? LIBELLE[r] : 'Pas encore tenté'}
            className={cn(
              'size-2.5 rounded-full border transition-colors',
              !r && 'border-border bg-transparent',
              r === 'repondu' && 'border-[#16A34A] bg-[#16A34A]',
              r === 'pas_de_reponse' && 'border-[#EF4444] bg-[#EF4444]',
              r === 'rappeler' && 'border-[#F59E0B] bg-[#F59E0B]',
              r === 'faux_numero' && 'border-[#1F2937] bg-[#1F2937]',
            )}
          />
        )
      })}
      {surplus > 0 && (
        <span className="text-[10px] font-medium text-muted-foreground">+{surplus}</span>
      )}
    </span>
  )
}

const LIBELLE: Record<ResultatAppel, string> = {
  pas_de_reponse: 'Pas de réponse',
  repondu: 'Client joint',
  rappeler: 'À rappeler',
  faux_numero: 'Numéro invalide',
}
