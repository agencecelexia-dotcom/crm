import { BUSINESS_PLAN } from '../donnees'
import { Bloc, Section } from '../section'

/** 06 — Les trois horizons, côte à côte. */
export function SectionTrajectoire() {
  return (
    <Section numero="06" titre="Trajectoire">
      <div className="grid gap-3 md:grid-cols-3">
        {BUSINESS_PLAN.horizons.map((h) => (
          <Bloc key={h.horizon}>
            <p className="mb-2 font-display text-base tracking-tight">{h.horizon}</p>
            <ul className="space-y-1.5">
              {h.objectifs.map((o) => (
                <li key={o} className="text-sm leading-snug text-muted-foreground">
                  {o}
                </li>
              ))}
            </ul>
          </Bloc>
        ))}
      </div>
    </Section>
  )
}
