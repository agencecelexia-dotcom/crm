import { useRef, useState } from 'react'
import { ArrowLeft, Loader2, RotateCcw, Lock } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { formatEuros, formatDate } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'
import { MOTIF_LABEL } from '@/lib/motifs-perte'
import { messageErreurSuivi } from './erreur-suivi'
import { DrawerChantierPerdu } from './drawer-chantier-perdu'
import type { ProjetPerdu } from '@/types/database'

const ORIGINE_LABEL: Record<ProjetPerdu['motif'], string> = {
  retrait: 'Vous vous êtes retiré',
  perdu: 'Déclaré perdu',
  masque: 'Retiré par Celexia',
}

/**
 * Espace « Chantiers perdus » du portail artisan.
 *
 * Le pipe principal se nettoie tout seul (retraits, perdus de plus de 15 jours,
 * masquages). Rien n'est supprimé pour autant : cette vue rend ces chantiers
 * consultables, et permet à l'artisan de les remettre dans son pipe lui-même
 * si le client le recontacte — sans repasser par l'agence.
 *
 * Un chantier repris entre-temps par un confrère n'est pas restaurable : le
 * bouton est alors désactivé plutôt que masqué, pour que l'artisan comprenne
 * pourquoi il ne peut pas le récupérer.
 */
export function ChantiersPerdus({
  projets,
  signe,
  onRetour,
  onChange,
}: {
  projets: ProjetPerdu[]
  /** Contrat signé : conditionne l'accès aux coordonnées client. */
  signe: boolean
  onRetour: () => void
  onChange: () => void
}) {
  const [enCours, setEnCours] = useState<string | null>(null)
  const restaurationEnCours = useRef(false)
  /** Dossier ouvert en panneau : voir ce qui s'est passé avant de décider
   *  d'une réattribution. */
  const [ouvert, setOuvert] = useState<ProjetPerdu | null>(null)
  // Montant total perdu : information stratégique absente de cette vue.
  const totalPerdu = projets.reduce((t, p) => t + (p.montant_devis ?? 0), 0)

  async function restaurer(p: ProjetPerdu) {
    if (restaurationEnCours.current || !signe) return
    restaurationEnCours.current = true
    setEnCours(p.id)
    try {
      const { data, error } = await supabase.rpc('restaurer_chantier_by_token', {
        p_token: p.token,
      })
      const r = data as { ok?: boolean; error?: string } | null
      if (error || !r?.ok) {
        const messages: Record<string, string> = {
          projet_clos: "Ce chantier a été clôturé par Celexia, il n'est plus récupérable.",
          deja_attribue: 'Ce chantier a été repris par un autre artisan.',
          introuvable: 'Chantier introuvable.',
        }
        throw new Error(
          (r?.error && messages[r.error]) || messageErreurSuivi(error ?? r, "Le chantier n'a pas pu être repris."),
        )
      }
      toast.success('Chantier repris', {
        description: 'Celexia a été prévenu.',
      })
      setOuvert((dossier) => dossier?.id === p.id ? null : dossier)
      onChange()
    } catch (e) {
      toast.error('Restauration impossible', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      restaurationEnCours.current = false
      setEnCours(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Button variant="outline" className="min-h-11" onClick={onRetour}>
          <ArrowLeft className="size-4" />
          Mes chantiers
        </Button>
        <span className="text-sm text-muted-foreground">
          {projets.length} chantier{projets.length > 1 ? 's' : ''} perdu
          {projets.length > 1 ? 's' : ''}
          {totalPerdu > 0 && (
            <> · <strong className="montant">{formatEuros(totalPerdu)}</strong> de devis</>
          )}
        </span>
      </div>

      {projets.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          titre="Aucun chantier perdu"
          description="Les chantiers que vous retirez ou déclarez perdus apparaîtront ici. Vous pourrez les reprendre si le client vous recontacte."
        />
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-border bg-card">
          {projets.map((p) => {
            const metiers = p.metiers?.length ? p.metiers : [p.metier]
            return (
              <Card
                key={p.id}
                className="gap-0 rounded-none border-0 border-b border-border bg-transparent p-4 shadow-none last:border-b-0 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-full sm:basis-64">
                    {/* Le nom du client manquait totalement dans cette vue
                        (audit §8), rendant les dossiers non identifiables. */}
                    <button
                      type="button"
                      className="-my-2 flex min-h-11 max-w-full items-center rounded-md text-left text-base font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setOuvert(p)}
                    >
                      <span className="break-words">
                        {signe && p.client_nom ? p.client_nom : 'Client confidentiel'}
                      </span>
                    </button>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {metiers.join(', ')}
                      {p.client_ville && ` · ${p.client_ville}`}
                      {p.montant_devis != null && ` · devis ${formatEuros(p.montant_devis)}`}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {p.motif_perte && (
                        <span className="font-medium text-foreground">
                          {MOTIF_LABEL[p.motif_perte] ?? p.motif_perte}
                        </span>
                      )}
                      <span>
                        {ORIGINE_LABEL[p.motif]} le {formatDate(p.sorti_le)}
                      </span>
                    </p>
                    {signe && p.derniere_raison && (
                      <p className="mt-2 break-words border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
                        « {p.derniere_raison} »
                      </p>
                    )}
                    {signe && (p.suivis?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => setOuvert(p)}
                        className="mt-1 min-h-11 rounded-md text-left text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Voir l'historique ({p.suivis!.length} échange
                        {p.suivis!.length > 1 ? 's' : ''})
                        {p.devis_depose && ' · devis déposé'}
                      </button>
                    )}
                  </div>

                  {p.restaurable && signe ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 max-w-full"
                      disabled={enCours != null}
                      onClick={(e) => {
                        e.stopPropagation()
                        void restaurer(p)
                      }}
                    >
                      {enCours === p.id ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Restauration…
                        </>
                      ) : (
                        <>
                          <RotateCcw className="size-4" />
                          Reprendre ce chantier
                        </>
                      )}
                    </Button>
                  ) : (
                    <span className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
                      <Lock className="size-3.5" />
                      {signe ? 'Chantier indisponible pour une reprise' : 'Contrat à signer pour reprendre'}
                    </span>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <DrawerChantierPerdu
        projet={ouvert}
        signe={signe}
        onClose={() => setOuvert(null)}
        enCours={enCours === ouvert?.id}
        onRestaurer={(p) => {
          void restaurer(p)
        }}
      />
    </div>
  )
}
