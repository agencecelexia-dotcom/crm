import { useState } from 'react'
import { ExternalLink, Filter } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BUSINESS_PLAN } from './donnees'
import { TON } from './tons'
import { SectionIdentite } from './sections/identite'
import { SectionMoat } from './sections/moat'
import { SectionMachine } from './sections/machine'
import { SectionPricing } from './sections/pricing'
import { SectionOrganisation } from './sections/organisation'
import { SectionTrajectoire } from './sections/trajectoire'
import { SectionVerrous } from './sections/verrous'
import { SectionProcedures } from './sections/procedures'
import { SectionStack } from './sections/stack'
import { SectionDecisions } from './sections/decisions'
import { SectionRoadmap } from './sections/roadmap'

/**
 * Le business plan, en vue schématique.
 *
 * Ce n'est pas le document : celui-ci reste la référence rédigée, et le lien
 * en tête y renvoie. Ici on cherche à voir l'état de la boîte en un coup
 * d'œil — ce qui bloque, ce qui est décidé, ce qui vient.
 *
 * Tout le contenu vient de `donnees.ts`. Aucun texte métier ne doit être écrit
 * dans un composant : sinon la mise à jour se ferait à deux endroits, et l'un
 * des deux finirait par mentir.
 */
export function BusinessPlanPage() {
  // Le filtre le plus utilisé : ne garder que ce qui appelle une décision.
  const [filtreCritique, setFiltreCritique] = useState(false)
  const { meta } = BUSINESS_PLAN

  const critiques = BUSINESS_PLAN.verrous.filter((v) => v.gravite !== 'moyen').length
  const ouvertes = BUSINESS_PLAN.decisionsOuvertes.filter((d) => d.statut === 'ouvert').length

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titre="Business Plan"
        sousTitre={`${meta.version} · ${meta.misAJourLe}`}
        action={
          meta.urlDocument ? (
            <Button asChild variant="outline" size="sm">
              <a href={meta.urlDocument} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Document
              </a>
            </Button>
          ) : undefined
        }
      />

      {/* Le filtre reste en tête : c'est la vue de travail, pas une option
          enfouie. Il ne masque que les sections 07 et 10 — les autres portent
          des faits, pas des arbitrages. */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <Button
          variant={filtreCritique ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFiltreCritique((v) => !v)}
        >
          <Filter className="size-4" />
          {filtreCritique ? 'Vue complète' : 'Ce qui est critique'}
        </Button>
        <p className="text-xs text-muted-foreground">
          <span className={cn('font-medium', TON.critique.texte)}>{critiques} verrous</span> à
          gravité critique ou élevée ·{' '}
          <span className={cn('font-medium', TON.tension.texte)}>
            {ouvertes} décisions
          </span>{' '}
          en attente
        </p>
        {!meta.urlDocument && (
          <p className="w-full text-xs text-muted-foreground">
            Lien vers le document non renseigné — à compléter dans{' '}
            <code className="rounded bg-muted px-1 py-0.5">donnees.ts</code>, champ{' '}
            <code className="rounded bg-muted px-1 py-0.5">meta.urlDocument</code>.
          </p>
        )}
      </div>

      {/* 01 à 07 : toujours visibles. Ce sont les faits. */}
      <SectionIdentite />
      <SectionMoat />
      <SectionMachine />
      <SectionPricing />
      <SectionOrganisation />
      <SectionTrajectoire />
      <SectionVerrous filtreCritique={filtreCritique} />

      {/* 08 à 11 : consultées ponctuellement, repliées ou tabulées. */}
      <SectionProcedures />
      <SectionStack />
      <SectionDecisions filtreCritique={filtreCritique} />
      <SectionRoadmap />
    </div>
  )
}
