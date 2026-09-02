import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion'
import { businessPlan } from '../donnees'
import { Section } from '../section'

/**
 * 08 — Les procédures, repliées.
 *
 * Cinq procédures dépliées feraient à elles seules la moitié de la page. On ne
 * les consulte qu'au moment de les appliquer : l'accordéon garde la page
 * navigable.
 */
export function SectionProcedures() {
  return (
    <Section numero="08" titre="Procédures">
      <Accordion type="single" collapsible className="rounded-lg border border-border bg-card">
        {businessPlan.procedures.map((p) => (
          <AccordionItem key={p.titre} value={p.titre} className="px-4 last:border-b-0">
            <AccordionTrigger className="text-sm font-medium">{p.titre}</AccordionTrigger>
            <AccordionContent>
              <ol className="space-y-2 pb-2">
                {p.etapes.map((e, i) => (
                  <li key={e} className="flex gap-2.5 text-sm leading-relaxed">
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-muted-foreground">{e}</span>
                  </li>
                ))}
              </ol>
              {/* La note porte le piège de la procédure — ce qu'on oublie en
                  l'appliquant. Elle se distingue donc des étapes. */}
              {p.note && (
                <p className="mb-2 rounded-md border border-border bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
                  {p.note}
                </p>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Section>
  )
}
