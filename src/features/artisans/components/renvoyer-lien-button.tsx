import { useState } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { N8N_WEBHOOK_URL } from '@/lib/constants'
import type { Artisan } from '@/types/database'

/**
 * Renvoie à l'artisan, par email, le lien de son espace (tous ses chantiers),
 * quand il l'a perdu. Réservé au fondateur : le lien ouvre l'espace sans mot
 * de passe et seul le fondateur peut lire le jeton (migration 0159).
 */
export function RenvoyerLienButton({ artisan, jeton }: {
  artisan: Pick<Artisan, 'email' | 'nom' | 'prenom'>
  jeton: string | null | undefined
}) {
  const [envoi, setEnvoi] = useState(false)
  const email = artisan.email?.trim() ?? ''
  const lien = jeton ? `${window.location.origin}/artisan/${jeton}` : ''

  async function envoyer() {
    if (!email || !lien) return
    setEnvoi(true)
    try {
      // `no-cors` : n8n ne renvoie pas d'en-têtes CORS, la réponse est donc
      // opaque. Seule une panne réseau est détectable ici.
      await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'renvoyer_lien_espace',
          email,
          lien,
          artisan_prenom: artisan.prenom ?? '',
          artisan_nom: artisan.nom,
        }),
      })
      toast.success(`Lien envoyé à ${email}`)
    } catch {
      toast.error('Envoi impossible', { description: 'Vérifie ta connexion puis réessaie.' })
    } finally {
      setEnvoi(false)
    }
  }

  if (!email) {
    return (
      <Button variant="outline" size="sm" disabled title="Ajoute un email à la fiche pour envoyer le lien">
        <Link2 className="size-4" />
        Renvoyer son lien (pas d’email)
      </Button>
    )
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={envoi || !lien}>
          {envoi ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          Renvoyer son lien par email
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Renvoyer le lien de son espace ?</AlertDialogTitle>
          <AlertDialogDescription>
            Un email avec le lien de son espace (tous ses chantiers) part à <b>{email}</b>.
            Le lien reste le même : l’ancien continue de fonctionner.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={() => void envoyer()}>Envoyer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
