import { cn } from '@/lib/utils'
import { BUSINESS_PLAN } from '../donnees'
import { Section } from '../section'
import { LIBELLE_GRAVITE, TON, TON_GRAVITE } from '../tons'

/**
 * 07 — Ce qui bloque le plan.
 *
 * Les verrous critiques d'abord : ce sont eux qui décident si le reste tient.
 * Le tri est fait ici plutôt que dans le fichier de données, pour que celui-ci
 * reste un simple relevé du document.
 */
const ORDRE = { critique: 0, eleve: 1, moyen: 2 } as const

export function SectionVerrous({ filtreCritique }: { filtreCritique: boolean }) {
  const verrous = [...BUSINESS_PLAN.verrous]
    .filter((v) => !filtreCritique || v.gravite !== 'moyen')
    .sort((a, b) => ORDRE[a.gravite] - ORDRE[b.gravite])

  return (
    <Section
      numero="07"
      titre="Les verrous"
      sousTitre={
        filtreCritique
          ? 'Filtré : gravité critique et élevée seulement.'
          : 'Ce qui empêche le plan de se dérouler, par gravité.'
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        {verrous.map((v) => {
          const t = TON[TON_GRAVITE[v.gravite]]
          return (
            <div key={v.titre} className={cn('rounded-lg border p-4', t.bord, t.fond)}>
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{v.titre}</p>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
                    t.bord,
                    t.texte,
                  )}
                >
                  {LIBELLE_GRAVITE[v.gravite]}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{v.description}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}
