import { cn } from '@/lib/utils'
import { businessPlan } from '../donnees'
import { Bloc, Section } from '../section'
import { TON } from '../tons'

/**
 * 05 — Qui fait quoi, et ce que ça produit.
 *
 * Les deux colonnes sont contrastées à dessein : « Thomas génère, Antoine
 * convertit » se voit avant de se lire. La longueur inégale des listes est
 * elle-même une information — c'est le point de vigilance du chapitre 1.
 */
export function SectionOrganisation() {
  const { organisation, capital } = businessPlan
  return (
    <Section
      numero="05"
      titre="Organisation"
      sousTitre="Thomas génère, Antoine convertit. Chacun est autonome dans sa zone et recrute pour sa zone."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Perimetre nom="Thomas" ton="thomas" lignes={organisation.thomas} />
        <Perimetre nom="Antoine" ton="antoine" lignes={organisation.antoine} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Bloc>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Capital
          </p>
          <p className="text-sm leading-relaxed">{capital.repartition}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {capital.structure}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {capital.vesting}
          </p>
          {/* La réserve est le point le plus sensible du chapitre capital :
              la masquer reviendrait à la laisser s'oublier. */}
          {capital.reserve && (
            <p
              className={cn(
                'mt-3 rounded-md border p-2.5 text-xs leading-relaxed',
                TON.tension.bord,
                TON.tension.fond,
                TON.tension.texte,
              )}
            >
              {capital.reserve}
            </p>
          )}
        </Bloc>
        <Bloc>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Rémunération
          </p>
          <p className="text-sm leading-relaxed">{capital.remuneration}</p>
        </Bloc>
        <Bloc>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Équipe
          </p>
          <ul className="space-y-1">
            {organisation.equipe.map((e) => (
              <li key={e} className="text-sm text-muted-foreground">
                {e}
              </li>
            ))}
          </ul>
        </Bloc>
      </div>
    </Section>
  )
}

function Perimetre({
  nom,
  ton,
  lignes,
}: {
  nom: string
  ton: 'thomas' | 'antoine'
  lignes: string[]
}) {
  const t = TON[ton]
  return (
    <div className={cn('rounded-lg border p-4', t.bord, t.fond)}>
      <p className={cn('mb-2 text-sm font-semibold', t.texte)}>{nom}</p>
      <ul className="space-y-1.5">
        {lignes.map((l) => (
          <li key={l} className="text-sm leading-snug">
            {l}
          </li>
        ))}
      </ul>
    </div>
  )
}
