import { Copy, Mail, Link2, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useArtisan } from '@/features/artisans/hooks/use-artisans'
import { useContratArtisan } from '@/features/contrats/use-contrats'
import { ContratGenerateur } from '@/features/contrats/contrat-generateur'
import type { ProjetAvecArtisan } from '@/types/database'

// Carte "Espace artisan" sur la fiche projet : le lien unique à envoyer à
// l'artisan. Le lien n'est exploitable que si le contrat d'engagement est prêt,
// donc on affiche ici l'état du contrat + l'action pour le préparer.
export function MissionLinkCard({ projet }: { projet: ProjetAvecArtisan }) {
  const { data: artisan } = useArtisan(projet.artisan_id ?? undefined)
  const { data: contrat, isLoading } = useContratArtisan(projet.artisan_id ?? undefined)

  const lien = `${window.location.origin}/mission/${projet.token}`
  const email = projet.artisan?.email ?? ''
  const contratPret = !!contrat

  function copier() {
    navigator.clipboard.writeText(lien).then(
      () => toast.success('Lien copié'),
      () => toast.error('Copie impossible'),
    )
  }

  const mailto = `mailto:${email}?subject=${encodeURIComponent(
    'Votre dossier client Celexia',
  )}&body=${encodeURIComponent(
    `Bonjour,\n\nVoici votre espace pour ce projet : signez le contrat puis accédez aux coordonnées du client et déposez votre devis.\n${lien}\n\nL'équipe Celexia`,
  )}`

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4" />
          Espace artisan
        </CardTitle>
        {!isLoading &&
          (contratPret ? (
            <Badge
              style={{
                backgroundColor: contrat!.statut === 'signe' ? '#22C55E' : '#F59E0B',
                color: '#fff',
              }}
              className="border-transparent"
            >
              {contrat!.statut === 'signe' ? 'Contrat signé' : 'Contrat prêt'}
            </Badge>
          ) : (
            <Badge style={{ backgroundColor: '#64748B', color: '#fff' }} className="border-transparent">
              Contrat à préparer
            </Badge>
          ))}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !contratPret ? (
          // Contrat pas encore généré → l'artisan ne pourra pas signer : on le prépare ici.
          <>
            <div className="flex items-start gap-2 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#F59E0B]" />
              <span>
                Prépare d'abord le contrat : tant qu'il n'est pas généré, l'artisan qui ouvre le
                lien ne peut pas signer.
              </span>
            </div>
            {artisan && <ContratGenerateur artisan={artisan} />}
          </>
        ) : (
          // Contrat prêt → on montre le lien à envoyer.
          <>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-[#22C55E]" />
              Lien à envoyer à l'artisan (signature → dossier client → dépôt devis) :
            </p>
            <div className="truncate rounded-md border border-border bg-secondary px-3 py-2 text-xs">
              {lien}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={copier}>
                <Copy className="size-4" />
                Copier
              </Button>
              <Button asChild variant="outline" disabled={!email}>
                <a href={mailto}>
                  <Mail className="size-4" />
                  Email
                </a>
              </Button>
            </div>
            {!email && (
              <p className="text-xs text-muted-foreground">
                Ajoute l'email de l'artisan (sur sa fiche) pour l'envoi par mail.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
