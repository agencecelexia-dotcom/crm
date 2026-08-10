import { useState } from 'react'
import { ArrowLeft, Loader2, RotateCcw, Lock } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { formatEuros, formatDate } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'
import type { ProjetPerdu } from '@/types/database'

const MOTIF_LABEL: Record<ProjetPerdu['motif'], string> = {
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
  onRetour,
  onChange,
}: {
  projets: ProjetPerdu[]
  onRetour: () => void
  onChange: () => void
}) {
  const [enCours, setEnCours] = useState<string | null>(null)

  async function restaurer(p: ProjetPerdu) {
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
          (r?.error && messages[r.error]) || "Le chantier n'a pas pu être remis dans votre pipe.",
        )
      }
      toast.success('Chantier remis dans votre pipe', {
        description: 'Celexia a été prévenu.',
      })
      onChange()
    } catch (e) {
      toast.error('Restauration impossible', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setEnCours(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onRetour}>
          <ArrowLeft className="size-4" />
          Mes chantiers
        </Button>
        <span className="text-sm text-muted-foreground">
          {projets.length} chantier{projets.length > 1 ? 's' : ''} perdu
          {projets.length > 1 ? 's' : ''}
        </span>
      </div>

      {projets.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          titre="Aucun chantier perdu"
          description="Les chantiers que vous retirez ou déclarez perdus apparaîtront ici. Vous pourrez les remettre dans votre pipe si le client vous recontacte."
        />
      ) : (
        <div className="space-y-3">
          {projets.map((p) => {
            const metiers = p.metiers?.length ? p.metiers : [p.metier]
            return (
              <Card key={p.id} className="rounded-2xl border-border/70 p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base tracking-tight">{metiers.join(', ')}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {p.client_ville ?? 'Ville non précisée'}
                      {p.montant_devis != null && ` · devis ${formatEuros(p.montant_devis)}`}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {MOTIF_LABEL[p.motif]} le {formatDate(p.sorti_le)}
                    </p>
                    {p.derniere_raison && (
                      <p className="mt-1.5 rounded-lg bg-muted/50 p-2 text-xs italic text-muted-foreground">
                        « {p.derniere_raison} »
                      </p>
                    )}
                  </div>

                  {p.restaurable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={enCours === p.id}
                      onClick={() => void restaurer(p)}
                    >
                      {enCours === p.id ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Restauration…
                        </>
                      ) : (
                        <>
                          <RotateCcw className="size-4" />
                          Remettre dans mon pipe
                        </>
                      )}
                    </Button>
                  ) : (
                    <span className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                      <Lock className="size-3.5" />
                      Repris ailleurs
                    </span>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
