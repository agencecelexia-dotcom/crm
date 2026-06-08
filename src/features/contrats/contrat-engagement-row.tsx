import { FileSignature, Download, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/format'
import { useContratArtisan } from './use-contrats'
import { telechargerContratPdf } from './contrat-pdf'
import { finaliserContenu } from './contrat-modele'

// Ligne "Contrat d'engagement" dans le bloc Documents de la fiche projet.
// Reflète l'état du contrat de l'artisan (table contrats) + téléchargement si signé.
export function ContratEngagementRow({ artisanId }: { artisanId: string | null }) {
  const { data: contrat, isLoading } = useContratArtisan(artisanId ?? undefined)
  const signe = contrat?.statut === 'signe'

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <FileSignature className={signe ? 'size-5 text-primary' : 'size-5 text-muted-foreground'} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Contrat d'engagement</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {isLoading ? (
            'Chargement…'
          ) : !contrat ? (
            'Non préparé'
          ) : signe ? (
            <>
              <CheckCircle2 className="size-3 text-[#22C55E]" />
              Signé{contrat.signed_at ? ` le ${formatDate(contrat.signed_at)}` : ''}
            </>
          ) : (
            <>
              <Clock className="size-3" />
              En attente de signature
            </>
          )}
        </p>
      </div>
      {signe && contrat && (
        <Button
          variant="outline"
          size="sm"
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
          Télécharger
        </Button>
      )}
      {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  )
}
