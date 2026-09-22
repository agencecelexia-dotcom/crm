import { useState } from 'react'
import { Check, ExternalLink, Loader2, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { formatDate } from '@/lib/format'
import { urlSignee } from '@/lib/storage'
import type { Artisan } from '@/types/database'
import { useValiderAssurances } from './use-assurances'

/**
 * Validation des assurances, côté agence.
 *
 * L'artisan dépose, Claude lit, l'agence tranche. La validation ouvre le
 * générateur de devis (0131) : c'est un acte volontaire, pas une conséquence
 * automatique du dépôt — un PDF illisible ou périmé ne doit pas passer.
 */
export function AssurancesArtisanCard({ artisan }: { artisan: Artisan }) {
  const valider = useValiderAssurances()
  const [ouverture, setOuverture] = useState<string | null>(null)

  const pieces = [
    {
      cle: 'decennale',
      libelle: 'Responsabilité décennale',
      url: artisan.assurance_decennale_url,
      assureur: artisan.assurance_decennale_assureur,
      police: artisan.assurance_decennale_police,
      echeance: artisan.assurance_decennale_echeance,
    },
    {
      cle: 'rc_pro',
      libelle: 'RC professionnelle',
      url: artisan.assurance_rc_pro_url,
      assureur: artisan.assurance_rc_pro_assureur,
      police: artisan.assurance_rc_pro_police,
      echeance: artisan.assurance_rc_pro_echeance,
    },
  ]

  const complet = pieces.every((p) => p.url)
  const validees = artisan.assurances_validees_at != null
  const expiree = (d: string | null) => d != null && d < new Date().toISOString().slice(0, 10)

  // Ouvrir la pièce demande une URL signée : le bucket `documents` est privé.
  async function ouvrir(chemin: string) {
    setOuverture(chemin)
    try {
      const url = await urlSignee(chemin, 600)
      if (url) window.open(url, '_blank', 'noopener')
      else toast.error('Document introuvable')
    } catch {
      toast.error('Ouverture impossible')
    } finally {
      setOuverture(null)
    }
  }

  return (
    <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <CardTitre>
          <ShieldCheck className="size-4" /> Assurances
        </CardTitre>
        {validees ? (
          <Badge className="shrink-0 gap-1 bg-[#22C55E]/10 text-[#16A34A]">
            <Check className="size-3.5" />
            Validées le {formatDate(artisan.assurances_validees_at)}
          </Badge>
        ) : (
          <Badge variant="secondary" className="shrink-0">
            {complet ? 'À vérifier' : 'Incomplètes'}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {pieces.map((p) => (
          <div key={p.cle} className="rounded-xl bg-muted/40 p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{p.libelle}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {!p.url ? (
                    'Non déposée'
                  ) : (
                    <>
                      {p.assureur || 'Assureur non renseigné'}
                      {p.police && ` · n° ${p.police}`}
                      {p.echeance && (
                        <>
                          {' · '}
                          <span className={expiree(p.echeance) ? 'text-destructive' : undefined}>
                            {expiree(p.echeance) ? 'expirée le ' : 'valable jusqu’au '}
                            {formatDate(p.echeance)}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </p>
              </div>
              {p.url && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ouverture === p.url}
                  onClick={() => ouvrir(p.url!)}
                >
                  {ouverture === p.url ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ExternalLink className="size-4" />
                  )}
                  Voir
                </Button>
              )}
            </div>
          </div>
        ))}

        {pieces.some((p) => expiree(p.echeance)) && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Une attestation expirée referme le chiffrage automatiquement, même validée.
          </p>
        )}

        <Button
          variant={validees ? 'outline' : 'default'}
          className="w-full"
          disabled={valider.isPending || (!validees && !complet)}
          onClick={() =>
            valider.mutate(
              { id: artisan.id, valide: !validees },
              {
                onSuccess: () =>
                  toast.success(validees ? 'Validation retirée' : 'Assurances validées'),
                onError: (e) =>
                  toast.error('Échec', {
                    description: e instanceof Error ? e.message : undefined,
                  }),
              },
            )
          }
        >
          {valider.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : validees ? (
            <ShieldX className="size-4" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
          {validees ? 'Retirer la validation' : 'Valider et ouvrir le chiffrage'}
        </Button>
        {!complet && !validees && (
          <p className="text-center text-xs text-muted-foreground">
            Les deux attestations doivent être déposées.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
