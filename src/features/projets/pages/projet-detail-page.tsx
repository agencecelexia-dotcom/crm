import { Link, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Loader2, Pencil, Trash2, Phone, Mail, MapPin } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { StatutBadge } from '@/components/statut-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { STATUTS, STATUTS_ORDRE } from '@/lib/constants'
import { formatEuros, formatDateHeure, formatTel } from '@/lib/format'
import { useProjet, usePatchProjet, useDeleteProjet } from '../hooks/use-projets'
import { AffectationsCard } from '../components/affectations-card'
import { MontantsCard } from '../components/montants-card'
import { ProjetPhotos } from '../components/projet-photos'
import { SuiviCard } from '../components/suivi-card'
import { DocumentRow } from '../components/document-row'
import { ContratEngagementRow } from '@/features/contrats/contrat-engagement-row'
import type { ProjetInput, StatutProjet } from '@/types/database'

// Fiche projet : infos, statut, assignation, montants/commission, documents.
export function ProjetDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: projet, isLoading } = useProjet(id)
  const patch = usePatchProjet()
  const remove = useDeleteProjet()

  if (isLoading || !projet) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  // Changement de statut. Passage à "devis signé" → date de signature auto si vide.
  function changerStatut(nouveau: StatutProjet) {
    if (!projet) return
    const patchData: Partial<ProjetInput> = { statut: nouveau }
    if (nouveau === 'devis_signe' && !projet.date_signature) {
      patchData.date_signature = format(new Date(), 'yyyy-MM-dd')
    }
    patch.mutate(
      { id: projet.id, patch: patchData },
      {
        onSuccess: () => toast.success(`Statut : ${STATUTS[nouveau].label}`),
        onError: (err) =>
          toast.error('Changement impossible', {
            description: err instanceof Error ? err.message : undefined,
          }),
      },
    )
  }

  const adresseClient = [
    projet.client_adresse,
    projet.client_code_postal,
    projet.client_ville,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        titre={projet.client_nom}
        sousTitre={projet.metiers.join(' + ')}
        back
        action={
          <Button asChild variant="outline" size="icon" aria-label="Modifier">
            <Link to={`/projets/${projet.id}/edit`}>
              <Pencil className="size-4" />
            </Link>
          </Button>
        }
      />

      {/* Statut */}
      <Card className="mb-4">
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Statut</span>
            <StatutBadge statut={projet.statut} />
          </div>
          <Select value={projet.statut} onValueChange={(v) => changerStatut(v as StatutProjet)}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUTS_ORDRE.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUTS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {projet.statut === 'perdu' && (
            <p className="rounded-md border border-[#EF4444]/30 bg-[#EF4444]/10 p-2 text-xs text-[#991B1B]">
              ⚠️ Projet perdu : suppression automatique définitive 48 h après le passage en « Perdu »
              {projet.perdu_at
                ? ` (vers le ${formatDateHeure(
                    new Date(new Date(projet.perdu_at).getTime() + 48 * 3600 * 1000).toISOString(),
                  )})`
                : ''}
              . Repasse-le à un autre statut pour annuler.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Artisans assignés (multi-assignation, état isolé par artisan) */}
      <AffectationsCard projet={projet} />

      {/* Coordonnées client */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Client</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {projet.client_telephone && (
            <a
              href={`tel:${projet.client_telephone}`}
              className="flex items-center gap-3"
            >
              <Phone className="size-4 text-muted-foreground" />
              {formatTel(projet.client_telephone)}
            </a>
          )}
          {projet.client_email && (
            <a
              href={`mailto:${projet.client_email}`}
              className="flex items-center gap-3 break-all"
            >
              <Mail className="size-4 text-muted-foreground" />
              {projet.client_email}
            </a>
          )}
          {adresseClient && (
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{adresseClient}</span>
            </div>
          )}
          {projet.budget_estime != null && (
            <p className="text-muted-foreground">
              Budget estimé : {formatEuros(projet.budget_estime)}
            </p>
          )}
          {projet.description && (
            <>
              <Separator />
              <p className="whitespace-pre-wrap text-muted-foreground">
                {projet.description}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Photos du chantier (vues par l'artisan après signature) */}
      <ProjetPhotos projet={projet} />

      {/* Suivi du chantier (parcours déclaré par l'artisan + notes) */}
      <SuiviCard projetId={projet.id} />

      {/* Argent / commission */}
      <MontantsCard projet={projet} />

      {/* Documents */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Documents (PDF)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Contrat d'engagement = signé en ligne par l'artisan (table contrats) */}
          <ContratEngagementRow artisanId={projet.artisan_id} />
          <DocumentRow
            projetId={projet.id}
            type="devis"
            label="Devis"
            champ="devis_url"
            cheminActuel={projet.devis_url}
          />
          <DocumentRow
            projetId={projet.id}
            type="devis_signe"
            label="Devis signé"
            champ="devis_signe_url"
            cheminActuel={projet.devis_signe_url}
          />
        </CardContent>
      </Card>

      {/* Suppression */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" className="w-full text-destructive">
            <Trash2 className="size-4" />
            Supprimer ce projet
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le projet ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                remove.mutate(projet.id, {
                  onSuccess: () => {
                    toast.success('Projet supprimé')
                    navigate('/projets', { replace: true })
                  },
                  onError: (err) =>
                    toast.error('Suppression impossible', {
                      description: err instanceof Error ? err.message : undefined,
                    }),
                })
              }
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
