import { BUSINESS_PLAN } from '../donnees'
import { Bloc, Section } from '../section'

/** 11 — Ce qu'on fait maintenant, par pôle. */
export function SectionRoadmap() {
  return (
    <Section numero="11" titre="Les 90 prochains jours">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {BUSINESS_PLAN.roadmap90j.map((r) => (
          <Bloc key={r.pole}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {r.pole}
            </p>
            <ul className="space-y-1.5">
              {r.actions.map((a) => (
                <li key={a} className="text-sm leading-snug">
                  {a}
                </li>
              ))}
            </ul>
          </Bloc>
        ))}
      </div>
    </Section>
  )
}
