import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { businessPlan } from '../donnees'
import { Bloc, Section } from '../section'
import { LIBELLE_PERIMETRE, TON, TON_ETAPE, TON_PERIMETRE } from '../tons'

/**
 * 03 — La chaîne de valeur, de la publicité au chantier signé.
 *
 * Le flux horizontal montre où l'argent se bloque : deux étapes sur cinq sont
 * en rouge, et ce sont celles du milieu. Une liste verticale ne le dirait pas
 * aussi vite.
 */
export function SectionMachine() {
  const { machine, metriques } = businessPlan
  return (
    <Section numero="03" titre="La machine">
      {/* Le flux passe en colonne sous 768px : cinq cartes côte à côte sur un
          téléphone deviendraient illisibles. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
        {machine.map((e, i) => {
          const ton = TON[TON_ETAPE[e.statut]]
          return (
            <div key={e.nom} className="flex flex-1 items-center gap-2">
              <div className={cn('flex-1 rounded-lg border p-3', ton.bord, ton.fond)}>
                <p className={cn('text-sm font-medium', ton.texte)}>{e.nom}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{e.sousTitre}</p>
                {/* Le statut colore la carte, le périmètre dit qui la tient :
                    deux informations orthogonales, deux traitements distincts. */}
                <p className={cn('mt-1.5 text-xs', TON[TON_PERIMETRE[e.perimetre]].texte)}>
                  {LIBELLE_PERIMETRE[e.perimetre]}
                </p>
              </div>
              {i < machine.length - 1 && (
                <ChevronRight
                  className="size-4 shrink-0 rotate-90 text-muted-foreground md:rotate-0"
                  aria-hidden
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metriques.map((m) => (
          <Bloc key={m.label}>
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="mt-0.5 font-display text-xl tabular-nums tracking-tight">{m.valeur}</p>
            <p className="mt-1 text-xs text-muted-foreground">{m.note}</p>
          </Bloc>
        ))}
      </div>
    </Section>
  )
}
