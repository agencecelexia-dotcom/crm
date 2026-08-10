import { Link } from 'react-router-dom'
import { BadgeCheck, Clock, X, Loader2, FileText, Eye, Download } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { Button } from '@/components/ui/button'
import { StatutBadge } from '@/components/statut-badge'
import { cn } from '@/lib/utils'
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
    <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
      <CardHeader>
        <CardTitre>
          Artisans assignés ({affectations?.length ?? 0})
        </CardTitre>
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
            const nomArtisan = a?.societe || (a ? `${a.nom} ${a.prenom ?? ''}`.trim() : 'artisan')
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
                  <div className="mt-2 space-y-2 border-t border-border pt-2">
                    {/* Devis déposés par l'artisan. Auparavant réduits à deux
                        micro-liens noyés dans une ligne de métadonnées, ils
                        passaient inaperçus : ce sont désormais de vrais
                        boutons, avec le montant associé. */}
                    <DevisDepose
                      label="Devis"
                      url={af.devis_url}
                      montant={af.montant_devis}
                      nomFichier={`Devis ${nomArtisan}.pdf`}
                    />
                    <DevisDepose
                      label="Devis signé"
                      url={af.devis_signe_url}
                      montant={af.montant_devis_signe}
                      nomFichier={`Devis signé ${nomArtisan}.pdf`}
                      accent
                    />
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

/**
 * Un devis déposé par l'artisan : montant + accès au PDF.
 *
 * Les PDF vivent dans le bucket `devis` sous un chemin non devinable, préfixé
 * par le token d'affectation. On ouvre l'onglet DANS le geste de clic (les
 * navigateurs mobiles bloquent une ouverture asynchrone), et le téléchargement
 * force un nom de fichier lisible plutôt que le nom aléatoire du stockage.
 */
function DevisDepose({
  label,
  url,
  montant,
  nomFichier,
  accent,
}: {
  label: string
  url: string | null
  montant: number | null
  nomFichier: string
  accent?: boolean
}) {
  if (url == null && montant == null) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border p-2',
        accent ? 'border-[#22C55E]/30 bg-[#22C55E]/5' : 'border-border bg-muted/30',
      )}
    >
      <FileText
        className={cn('size-4 shrink-0', accent ? 'text-[#22C55E]' : 'text-muted-foreground')}
      />
      <span className="text-sm font-medium">{label}</span>
      {montant != null && (
        <span className="montant text-sm font-semibold">{formatEuros(montant)}</span>
      )}

      {url ? (
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-8 bg-card" asChild>
            <a href={url} target="_blank" rel="noopener">
              <Eye className="size-3.5" />
              Voir
            </a>
          </Button>
          <Button size="icon" variant="ghost" className="size-8" asChild>
            <a href={url} download={nomFichier} aria-label={`Télécharger ${label}`}>
              <Download className="size-3.5" />
            </a>
          </Button>
        </div>
      ) : (
        <span className="ml-auto text-xs italic text-muted-foreground">PDF non déposé</span>
      )}
    </div>
  )
}
