import { Copy, Mail, Link2 } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { ProjetAvecArtisan } from '@/types/database'

// Carte "Espace artisan" sur la fiche projet : le lien unique à envoyer à
// l'artisan (signature du contrat → dossier client → dépôt des devis).
export function MissionLinkCard({ projet }: { projet: ProjetAvecArtisan }) {
  const lien = `${window.location.origin}/mission/${projet.token}`
  const email = projet.artisan?.email ?? ''

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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4" />
          Espace artisan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Lien à envoyer à l'artisan : il signe le contrat, voit les coordonnées du
          client et dépose son devis puis le devis signé.
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
      </CardContent>
    </Card>
  )
}
