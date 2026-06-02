import { useState } from 'react'
import {
  FileSignature,
  Loader2,
  Copy,
  Mail,
  CheckCircle2,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'
import type { Artisan } from '@/types/database'
import { useContratArtisan, useCreateContrat } from './use-contrats'

// Carte "Contrat d'engagement" sur la fiche artisan.
export function ContratCard({ artisan }: { artisan: Artisan }) {
  const { data: contrat, isLoading } = useContratArtisan(artisan.id)
  const create = useCreateContrat()
  const [signatureVisible, setSignatureVisible] = useState(false)

  const lien = contrat
    ? `${window.location.origin}/signer/${contrat.token}`
    : ''

  function copier() {
    navigator.clipboard.writeText(lien).then(
      () => toast.success('Lien copié'),
      () => toast.error('Copie impossible'),
    )
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
        {isLoading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !contrat ? (
          <>
            <p className="text-sm text-muted-foreground">
              Aucun contrat. Génère-le puis envoie le lien de signature à l'artisan.
            </p>
            <Button
              className="w-full"
              disabled={create.isPending}
              onClick={() =>
                create.mutate(artisan, {
                  onSuccess: () => toast.success('Contrat généré'),
                  onError: (e) =>
                    toast.error('Génération impossible', {
                      description: e instanceof Error ? e.message : undefined,
                    }),
                })
              }
            >
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileSignature className="size-4" />
              )}
              Générer le contrat
            </Button>
          </>
        ) : contrat.statut === 'signe' ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-[#22C55E]" />
              Signé par <strong>{contrat.signataire_nom}</strong>
              {contrat.signed_at && ` le ${formatDate(contrat.signed_at)}`}
            </p>
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
