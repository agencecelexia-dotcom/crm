import { Eye, FileText, Lock, MapPin, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { formatDate, formatEuros } from '@/lib/format'
import { MOTIF_LABEL } from '@/lib/motifs-perte'
import { dateLisible } from './dernier-suivi'
import type { ProjetPerdu } from '@/types/database'

const ETAPE_LABEL: Record<string, string> = {
  contacte: 'Client contacté',
  rdv_pris: 'RDV pris',
  devis_envoye: 'Devis envoyé',
  devis_signe: 'Devis signé',
  termine: 'Chantier terminé',
}

/**
 * Dossier complet d'un chantier sorti du pipe, en lecture seule.
 *
 * La liste des perdus n'affichait qu'un résumé : ville, métier, motif et une
 * ligne de commentaire. Or la question qu'on se pose devant un chantier perdu
 * est « que s'est-il passé, et est-ce que ça vaut le coup de le
 * réattribuer ? » — à laquelle un résumé ne répond pas. Il faut voir le fil
 * des échanges, jusqu'où le dossier est allé, et les devis qui ont circulé.
 *
 * Lecture seule volontairement : le chantier est sorti du pipe, on ne déclare
 * plus d'étape dessus. La seule action possible reste la restauration.
 */
export function DrawerChantierPerdu({
  projet,
  signe,
  onClose,
  onRestaurer,
  enCours,
}: {
  projet: ProjetPerdu | null
  signe: boolean
  onClose: () => void
  onRestaurer?: (p: ProjetPerdu) => void
  enCours?: boolean
}) {
  if (!projet) return null

  const metiers = projet.metiers?.length ? projet.metiers : [projet.metier]
  const suivis = projet.suivis ?? []
  const montant = projet.montant_devis_signe ?? projet.montant_devis

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
      >
        <SheetHeader className="space-y-2 text-left">
          <SheetTitle className="font-display text-xl tracking-tight">
            {signe && projet.client_nom ? (
              projet.client_nom
            ) : (
              <span className="flex items-center gap-1.5 italic text-muted-foreground">
                <Lock className="size-4" /> Client confidentiel
              </span>
            )}
          </SheetTitle>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {projet.client_ville && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {projet.client_ville} {projet.client_code_postal}
              </span>
            )}
            <span>· {metiers.join(', ')}</span>
          </p>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          {/* Ce qui permet de juger : jusqu'où c'est allé, et pourquoi ça
              s'est arrêté. */}
          <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
            <dl className="space-y-1.5">
              {projet.recu_le && (
                <Ligne label="Reçu le" valeur={formatDate(projet.recu_le)} />
              )}
              {projet.etape && (
                <Ligne label="Allé jusqu'à" valeur={ETAPE_LABEL[projet.etape] ?? projet.etape} />
              )}
              {projet.date_rdv && (
                <Ligne label="RDV" valeur={formatDate(projet.date_rdv)} />
              )}
              {montant != null && montant > 0 && (
                <Ligne label="Montant chiffré" valeur={formatEuros(montant)} />
              )}
              <Ligne label="Sorti du pipe" valeur={formatDate(projet.sorti_le)} />
              {projet.motif_perte && (
                <Ligne
                  label="Motif"
                  valeur={MOTIF_LABEL[projet.motif_perte] ?? projet.motif_perte}
                />
              )}
            </dl>
          </div>

          {projet.description && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Demande initiale
              </p>
              <p className="whitespace-pre-wrap text-sm">{projet.description}</p>
            </div>
          )}

          {/* Les devis qui ont circulé : un chantier déjà chiffré se
              réattribue différemment d'un chantier jamais travaillé. */}
          {(projet.devis_url || projet.devis_signe_url) && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Devis déposés
              </p>
              <div className="flex flex-wrap gap-2">
                {projet.devis_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={projet.devis_url} target="_blank" rel="noopener">
                      <FileText className="size-3.5" />
                      Devis
                    </a>
                  </Button>
                )}
                {projet.devis_signe_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={projet.devis_signe_url} target="_blank" rel="noopener">
                      <Eye className="size-3.5" />
                      Devis signé
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Le fil complet : c'est lui qui raconte ce qui s'est passé. */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Historique {suivis.length > 0 && `(${suivis.length})`}
            </p>
            {suivis.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun échange enregistré sur ce chantier.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {[...suivis].reverse().map((s, i) => (
                  <li
                    key={s.id ?? i}
                    className={cn(
                      'rounded-xl border p-2.5 text-sm',
                      s.auteur === 'agence'
                        ? 'border-primary/25 bg-primary/5'
                        : 'border-border bg-card',
                    )}
                  >
                    <p className="mb-0.5 flex items-baseline gap-1.5 text-xs">
                      <span
                        className={cn(
                          'font-semibold',
                          s.auteur === 'agence' ? 'text-primary' : 'text-foreground',
                        )}
                      >
                        {s.auteur === 'agence' ? 'Celexia' : 'Vous'}
                      </span>
                      <span className="text-muted-foreground">{dateLisible(s.created_at)}</span>
                    </p>
                    {s.message ? (
                      <p className="whitespace-pre-wrap">{s.message}</p>
                    ) : (
                      <p className="text-muted-foreground">
                        {s.statut ? `Étape : ${ETAPE_LABEL[s.statut] ?? s.statut}` : '—'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {onRestaurer && (
            <Button
              className="w-full"
              disabled={!projet.restaurable || enCours}
              onClick={() => onRestaurer(projet)}
            >
              <RotateCcw className="size-4" />
              {projet.restaurable
                ? 'Remettre dans mon pipe'
                : 'Repris par un autre artisan'}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Ligne({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{valeur}</dd>
    </div>
  )
}
