import { useState } from 'react'
import { Copy, Mail, Link2, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { N8N_WEBHOOK_URL } from '@/lib/constants'
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
  const [envoi, setEnvoi] = useState(false)

  const lien = `${window.location.origin}/mission/${projet.token}`
  const email = projet.artisan?.email ?? ''
  const contratPret = !!contrat

  function copier() {
    navigator.clipboard.writeText(lien).then(
      () => toast.success('Lien copié'),
      () => toast.error('Copie impossible'),
    )
  }

  // Envoi automatique du lien à l'artisan via n8n (email Gmail), au lieu d'un mailto.
  async function envoyerLien() {
    if (!email) return
    setEnvoi(true)
    try {
      await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors', // webhook cross-origin : envoi "fire and forget"
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'envoyer_lien_mission',
          email,
          lien,
          // On NE transmet PAS l'identité du client dans l'email (révélée après signature) :
          // seulement ville + type de projet + description.
          client_ville: projet.client_ville ?? '',
          metiers: projet.metiers.join(', '),
          description: projet.description ?? '',
          artisan_prenom: projet.artisan?.prenom ?? '',
          artisan_nom: projet.artisan?.nom ?? '',
        }),
      })
      toast.success(`Lien envoyé à l'artisan (${email})`)
    } catch {
      toast.error('Envoi impossible')
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
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
                Copier le lien
              </Button>
              <Button onClick={envoyerLien} disabled={!email || envoi}>
                {envoi ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                Envoyer à l'artisan
              </Button>
            </div>
            {!email ? (
              <p className="text-xs text-muted-foreground">
                Ajoute l'email de l'artisan (sur sa fiche) pour l'envoi automatique.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                « Envoyer » expédie automatiquement le lien par email à {email}.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
