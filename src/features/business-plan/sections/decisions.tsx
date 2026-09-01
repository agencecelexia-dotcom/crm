import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { BUSINESS_PLAN } from '../donnees'
import { Section } from '../section'
import { TON } from '../tons'

/** 10 — Ce qui n'est pas tranché, et pour quand. */
export function SectionDecisions({ filtreCritique }: { filtreCritique: boolean }) {
  const lignes = BUSINESS_PLAN.decisionsOuvertes.filter(
    (d) => !filtreCritique || d.statut === 'ouvert',
  )

  return (
    <Section
      numero="10"
      titre="Décisions ouvertes"
      sousTitre={`${lignes.filter((d) => d.statut === 'ouvert').length} en attente d’arbitrage.`}
    >
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="w-44">Sujet</TableHead>
              <TableHead>Question</TableHead>
              <TableHead className="w-48">Échéance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lignes.map((d) => (
              <TableRow key={d.sujet}>
                <TableCell className="align-top">
                  {/* Une pastille suffit : la colonne « statut » écrite en
                      toutes lettres n'ajouterait rien à deux valeurs. */}
                  <span
                    title={d.statut === 'ouvert' ? 'Ouvert' : 'Tranché'}
                    className={cn(
                      'mt-1.5 block size-2 rounded-full',
                      d.statut === 'ouvert' ? 'bg-[#F59E0B]' : 'bg-[#16A34A]',
                    )}
                  />
                  <span className="sr-only">
                    {d.statut === 'ouvert' ? 'Ouvert' : 'Tranché'}
                  </span>
                </TableCell>
                <TableCell className="align-top font-medium">{d.sujet}</TableCell>
                <TableCell className="align-top text-muted-foreground">{d.question}</TableCell>
                <TableCell className={cn('align-top text-sm', TON.tension.texte)}>
                  {d.echeance}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  )
}
