import { Eye, FileText, Lock, MapPin, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
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
  const suivis = signe ? projet.suivis ?? [] : []
  const montant = projet.montant_devis_signe ?? projet.montant_devis

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="h-dvh max-h-dvh w-full gap-0 overflow-hidden bg-background sm:max-w-[640px]"
        aria-describedby={undefined}
      >
        <SheetHeader className="shrink-0 space-y-2 border-b border-border bg-card p-5 pr-14 text-left sm:px-6 sm:pr-14">
          <p className="text-xs font-medium text-muted-foreground">Chantier perdu · Dossier archivé</p>
          <SheetTitle className="break-words text-xl font-semibold leading-tight">
            {signe && projet.client_nom ? (
              projet.client_nom
            ) : (
              <span className="flex items-center gap-1.5 text-muted-foreground">
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

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
          {/* Ce qui permet de juger : jusqu'où c'est allé, et pourquoi ça
              s'est arrêté. */}
          <div className="rounded-[10px] border border-border bg-card px-4 py-1 text-sm">
            <dl className="divide-y divide-border">
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
              <p className="mb-2 text-sm font-semibold text-foreground">
                Demande initiale
              </p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{projet.description}</p>
            </div>
          )}

          {/* Les devis qui ont circulé : un chantier déjà chiffré se
              réattribue différemment d'un chantier jamais travaillé. */}
          {signe && (projet.devis_url || projet.devis_signe_url) && (
            <div>
              <p className="mb-3 text-sm font-semibold text-foreground">
                Devis déposés
              </p>
              <div className="flex flex-wrap gap-2">
                {projet.devis_url && (
                  <Button variant="outline" className="min-h-11" asChild>
                    <a href={projet.devis_url} target="_blank" rel="noopener">
                      <FileText className="size-3.5" />
                      Devis
                    </a>
                  </Button>
                )}
                {projet.devis_signe_url && (
                  <Button variant="outline" className="min-h-11" asChild>
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
            <p className="mb-3 text-sm font-semibold text-foreground">
              Historique {suivis.length > 0 && `(${suivis.length})`}
            </p>
            {suivis.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {signe ? 'Aucun échange enregistré sur ce chantier.' : 'Signez votre contrat pour consulter les échanges et les documents de ce chantier.'}
              </p>
            ) : (
              <ul className="space-y-2.5">
                {[...suivis].reverse().map((s, i) => (
                  <li
                    key={s.id ?? i}
                    className="rounded-lg border border-border bg-card p-3 text-sm"
                  >
                    <p className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                      <span
                        className="font-semibold text-foreground"
                      >
                        {s.auteur === 'agence' ? 'Celexia' : 'Vous'}
                      </span>
                      <span className="text-muted-foreground">{dateLisible(s.created_at)}</span>
                    </p>
                    {s.message ? (
                      <p className="whitespace-pre-wrap break-words leading-relaxed">{s.message}</p>
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

          {signe && onRestaurer && (
            <div className="space-y-3">
            {projet.restaurable && <p className="text-sm leading-relaxed text-muted-foreground">Le chantier reprendra à l’étape conservée, avec ses devis et son historique. Les anciens rappels et rendez-vous dépassés seront effacés.</p>}
            <Button
              className="min-h-11 w-full"
              disabled={!projet.restaurable || enCours}
              onClick={() => onRestaurer(projet)}
            >
              <RotateCcw className="size-4" />
              {projet.restaurable
                ? enCours ? 'Reprise en cours…' : 'Remettre dans mon pipe'
                : 'Chantier indisponible pour une reprise'}
            </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Ligne({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{valeur}</dd>
    </div>
  )
}
