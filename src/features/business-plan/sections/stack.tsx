import { ExternalLink } from 'lucide-react'

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { BUSINESS_PLAN } from '../donnees'
import { Section } from '../section'

/** 09 — Les outils et ce qu'ils portent. */
export function SectionStack() {
  return (
    <Section numero="09" titre="Stack et outils">
      {/* Un tableau ne se compresse pas : il défile dans son propre cadre
          plutôt que de faire déborder la page sur mobile. */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Outil</TableHead>
              <TableHead>Rôle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {BUSINESS_PLAN.stack.map((s) => (
              <TableRow key={s.outil}>
                <TableCell className="align-top font-medium">
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      {s.outil}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : (
                    s.outil
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{s.role}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  )
}
