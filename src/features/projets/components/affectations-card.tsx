import { Link } from 'react-router-dom'
import { BadgeCheck, Clock, X, Loader2, FileText } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatutBadge } from '@/components/statut-badge'
import { formatEuros } from '@/lib/format'
import { useArtisansSignes } from '@/features/contrats/use-contrats'
import { useAffectations, useRetirerAffectation } from '../hooks/use-affectations'
import { AssignArtisan } from './assign-artisan'
import type { ProjetAvecArtisan } from '@/types/database'

// Liste des artisans assignés à un projet (multi-assignation), avec pour chacun :
// contrat signé ?, statut individuel, montants + devis, et retrait.
export function AffectationsCard({ projet }: { projet: ProjetAvecArtisan }) {
  const { data: affectations, isLoading } = useAffectations(projet.id)
  const { data: signes } = useArtisansSignes()
  const retirer = useRetirerAffectation()

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">
          Artisans assignés ({affectations?.length ?? 0})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !affectations || affectations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun artisan. Assigne-en un ou plusieurs : chacun verra le projet de façon isolée.
          </p>
        ) : (
          affectations.map((af) => {
            const a = af.artisan
            const signe = signes?.has(af.artisan_id)
            return (
              <div key={af.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <Link to={`/artisans/${af.artisan_id}`} className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      {signe ? (
                        <BadgeCheck className="size-4 shrink-0 text-[#22C55E]" />
                      ) : (
                        <Clock className="size-4 shrink-0 text-[#F59E0B]" />
                      )}
                      {a ? `${a.nom} ${a.prenom ?? ''}`.trim() : 'Artisan'}
                      {a?.societe && (
                        <span className="truncate text-sm text-muted-foreground">· {a.societe}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs">
                      <span className={signe ? 'text-[#22C55E]' : 'text-[#F59E0B]'}>
                        {signe ? 'contrat signé' : 'contrat non signé'}
                      </span>
                    </p>
                  </Link>
                  <StatutBadge statut={af.statut} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-destructive"
                    aria-label="Retirer"
                    disabled={retirer.isPending}
                    onClick={() =>
                      retirer.mutate(
                        { id: af.id, projetId: projet.id },
                        {
                          onSuccess: () => toast.success('Artisan retiré du projet'),
                          onError: (e) =>
                            toast.error('Retrait impossible', {
                              description: e instanceof Error ? e.message : undefined,
                            }),
                        },
                      )
                    }
                  >
                    <X className="size-4" />
                  </Button>
                </div>

                {/* Montants + devis déposés par cet artisan */}
                {(af.montant_devis != null ||
                  af.montant_devis_signe != null ||
                  af.devis_url ||
                  af.devis_signe_url) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                    {af.montant_devis != null && <span>Devis : {formatEuros(af.montant_devis)}</span>}
                    {af.devis_url && (
                      <a
                        href={af.devis_url}
                        target="_blank"
                        rel="noopener"
                        className="flex items-center gap-1 text-primary"
                      >
                        <FileText className="size-3" /> Devis
                      </a>
                    )}
                    {af.montant_devis_signe != null && (
                      <span>Signé : {formatEuros(af.montant_devis_signe)}</span>
                    )}
                    {af.devis_signe_url && (
                      <a
                        href={af.devis_signe_url}
                        target="_blank"
                        rel="noopener"
                        className="flex items-center gap-1 text-primary"
                      >
                        <FileText className="size-3" /> Devis signé
                      </a>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}

        <AssignArtisan projet={projet} />
      </CardContent>
    </Card>
  )
}
