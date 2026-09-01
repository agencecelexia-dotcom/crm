import { businessPlan } from '../donnees'
import { Bloc, Section } from '../section'

/** 01 — Ce qu'on fait et où on va. Deux cartes, rien de plus. */
export function SectionIdentite() {
  const { identite } = businessPlan
  return (
    <Section numero="01" titre="Identité et positionnement">
      <div className="grid gap-3 md:grid-cols-2">
        <Bloc>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Ce qu’on fait
          </p>
          <p className="text-sm leading-relaxed">{identite.ceQuonFait}</p>
        </Bloc>
        <Bloc>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Ambition
          </p>
          <p className="text-sm leading-relaxed">{identite.ambition}</p>
        </Bloc>
      </div>
      <Bloc className="mt-3">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Positionnement
        </p>
        <p className="text-sm leading-relaxed">{identite.positionnement}</p>
      </Bloc>
    </Section>
  )
}
