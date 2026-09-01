import { BUSINESS_PLAN } from '../donnees'
import { Bloc, Section } from '../section'

/** 02 — Les quatre protections, dans l'ordre où on y investit. */
export function SectionMoat() {
  return (
    <Section
      numero="02"
      titre="Ce qui nous protège"
      sousTitre="Par ordre d’investissement"
    >
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {BUSINESS_PLAN.moat.map((m) => (
          <Bloc key={m.rang}>
            <p className="mb-1.5 font-mono text-xs tabular-nums text-muted-foreground">
              {String(m.rang).padStart(2, '0')}
            </p>
            <p className="text-sm font-medium">{m.titre}</p>
            <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
          </Bloc>
        ))}
      </div>
    </Section>
  )
}
