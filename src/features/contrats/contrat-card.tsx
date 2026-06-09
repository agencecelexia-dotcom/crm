import { useState } from 'react'
import { Loader2, Copy, Mail, CheckCircle2, Eye, Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { formatDate } from '@/lib/format'
import { N8N_WEBHOOK_URL } from '@/lib/constants'
import type { Artisan } from '@/types/database'
import { useRegenererTokenArtisan } from '@/features/artisans/hooks/use-artisans'
import { useContratArtisan } from './use-contrats'
import { ContratGenerateur } from './contrat-generateur'
import { telechargerContratPdf } from './contrat-pdf'
import { finaliserContenu } from './contrat-modele'

// Carte "Contrat d'engagement" sur la fiche artisan.
export function ContratCard({ artisan }: { artisan: Artisan }) {
  const { data: contrat, isLoading } = useContratArtisan(artisan.id)
  const [signatureVisible, setSignatureVisible] = useState(false)
  const [envoiMail, setEnvoiMail] = useState(false)
  const regenerer = useRegenererTokenArtisan()

  const lien = contrat
    ? `${window.location.origin}/signer/${contrat.token}`
    : ''

  // Lien UNIQUE de l'artisan : contrat + tous ses chantiers (le lien à envoyer).
  const lienEspace = `${window.location.origin}/artisan/${artisan.token}`

  function copier() {
    navigator.clipboard.writeText(lien).then(
      () => toast.success('Lien copié'),
      () => toast.error('Copie impossible'),
    )
  }

  function copierEspace() {
    navigator.clipboard.writeText(lienEspace).then(
      () => toast.success('Lien copié'),
      () => toast.error('Copie impossible'),
    )
  }

  // Envoi automatique du lien espace à l'artisan via n8n (email Gmail), comme
  // l'ancien envoi par projet — mais ici c'est SON lien unique (tous ses chantiers).
  async function envoyerEspace() {
    if (!artisan.email) return
    setEnvoiMail(true)
    try {
      await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'envoyer_lien_mission',
          email: artisan.email,
          lien: lienEspace,
          artisan_prenom: artisan.prenom ?? '',
          artisan_nom: artisan.nom,
        }),
      })
      toast.success(`Lien envoyé à ${artisan.email}`)
    } catch {
      toast.error('Envoi impossible')
    } finally {
      setEnvoiMail(false)
    }
  }

  // Email pré-rempli (envoi manuel pour l'instant ; automatisable via n8n plus tard).
  const mailto = `mailto:${artisan.email ?? ''}?subject=${encodeURIComponent(
    'Votre contrat Celexia à signer',
  )}&body=${encodeURIComponent(
    `Bonjour ${artisan.prenom ?? artisan.nom},\n\nMerci de signer votre contrat d'engagement Celexia via ce lien :\n${lien}\n\nÀ très vite,\nL'équipe Celexia`,
  )}`

  return (
    <Card className="mb-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Contrat d'engagement</CardTitle>
        {contrat &&
          (contrat.statut === 'signe' ? (
            <Badge style={{ backgroundColor: '#22C55E', color: '#fff' }} className="border-transparent">
              Signé
            </Badge>
          ) : (
            <Badge style={{ backgroundColor: '#F59E0B', color: '#fff' }} className="border-transparent">
              En attente
            </Badge>
          ))}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Lien unique de l'artisan — à lui envoyer (contrat + tous ses chantiers) */}
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-medium">Lien de l'artisan (à lui envoyer)</p>
          <p className="text-xs text-muted-foreground">
            Il y signe son contrat une seule fois et retrouve tous ses chantiers.
          </p>
          <div className="truncate rounded-md border border-border bg-background px-3 py-2 text-xs">
            {lienEspace}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={copierEspace}>
              <Copy className="size-4" />
              Copier
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={envoyerEspace}
              disabled={!artisan.email || envoiMail}
            >
              {envoiMail ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Envoyer
            </Button>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full text-muted-foreground" disabled={regenerer.isPending}>
                {regenerer.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Régénérer le lien (révoque l'ancien)
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Régénérer le lien de l'artisan ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Le lien actuel cessera de fonctionner. Il faudra renvoyer le nouveau lien à
                  l'artisan. Son contrat signé et ses chantiers sont conservés.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    regenerer.mutate(artisan.id, {
                      onSuccess: () => toast.success('Nouveau lien généré — pensez à le renvoyer'),
                      onError: (e) =>
                        toast.error('Échec', {
                          description: e instanceof Error ? e.message : undefined,
                        }),
                    })
                  }
                >
                  Régénérer
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !contrat ? (
          <>
            <p className="text-sm text-muted-foreground">
              Aucun contrat. Prépare-le (variables pré-remplies) puis envoie le lien de
              signature à l'artisan.
            </p>
            <ContratGenerateur artisan={artisan} />
          </>
        ) : contrat.statut === 'signe' ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-[#22C55E]" />
              Signé par <strong>{contrat.signataire_nom}</strong>
              {contrat.signed_at && ` le ${formatDate(contrat.signed_at)}`}
            </p>

            {/* Téléchargement du contrat signé (PDF avec les 2 signatures) */}
            <Button
              onClick={() =>
                telechargerContratPdf({
                  contenu: finaliserContenu(contrat.contenu, contrat.signed_at),
                  signataire: contrat.signataire_nom,
                  signedAt: contrat.signed_at,
                  signatureDataUrl: contrat.signature_data,
                  apporteurSignatureUrl: contrat.apporteur_signature,
                })
              }
            >
              <Download className="size-4" />
              Télécharger le contrat signé (PDF)
            </Button>

            {contrat.signature_data && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSignatureVisible((v) => !v)}
                >
                  <Eye className="size-4" />
                  {signatureVisible ? 'Masquer' : 'Voir'} la signature
                </Button>
                {signatureVisible && (
                  <img
                    src={contrat.signature_data}
                    alt="Signature"
                    className="max-h-32 rounded-md border border-border bg-white"
                  />
                )}
              </>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Contrat généré. Envoie ce lien à l'artisan pour qu'il signe depuis son téléphone :
            </p>
            <div className="truncate rounded-md border border-border bg-secondary px-3 py-2 text-xs">
              {lien}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={copier}>
                <Copy className="size-4" />
                Copier
              </Button>
              <Button asChild variant="outline" disabled={!artisan.email}>
                <a href={mailto}>
                  <Mail className="size-4" />
                  Email
                </a>
              </Button>
            </div>
            {!artisan.email && (
              <p className="text-xs text-muted-foreground">
                Ajoute l'email de l'artisan pour l'envoi par mail.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
