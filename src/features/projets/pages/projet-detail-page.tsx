import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Pencil, Trash2, Phone, Mail, MapPin, Map } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { StatutBadge } from '@/components/statut-badge'
import { CardTitre } from '@/components/card-titre'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
import { NotesInternesCard } from '../components/notes-internes-card'
import { RappelProjetCard } from '../components/rappel-projet-card'
import { RelancesProjetCard } from '@/features/automatisations/relances-projet-card'
import { DocumentRow } from '../components/document-row'
import { DevisProjetCard } from '@/features/devis/devis-projet-card'
import { ContratEngagementRow } from '@/features/contrats/contrat-engagement-row'
import { ConfirmStatutDialog } from '../components/confirm-statut-dialog'
import type { ProjetInput, StatutProjet } from '@/types/database'

// Fiche projet : infos, statut, assignation, montants/commission, documents.
export function ProjetDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: projet, isLoading } = useProjet(id)
  const patch = usePatchProjet()
  const remove = useDeleteProjet()
  const [statutEnAttente, setStatutEnAttente] = useState<StatutProjet | null>(null)

  if (isLoading || !projet) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-2xl" />
        ))}
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
      <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center justify-between">
            <CardTitre>Statut</CardTitre>
            <StatutBadge statut={projet.statut} />
          </div>
          <Select
            value={projet.statut}
            onValueChange={(v) => setStatutEnAttente(v as StatutProjet)}
          >
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
            <p className="rounded-xl border border-[#EF4444]/25 bg-[#EF4444]/5 p-2.5 text-xs text-[#DC2626]">
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
      <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
        <CardHeader>
          <CardTitre>Client</CardTitre>
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
          {projet.latitude != null && projet.longitude != null && (
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to={`/carte?projet=${projet.id}`}>
                <Map className="size-4" />
                Voir sur la carte (artisans autour)
              </Link>
            </Button>
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

      {/* Suivi du chantier (parcours déclaré par l'artisan + notes) — PARTAGÉ avec l'artisan */}
      <SuiviCard projetId={projet.id} />

      {/* Notes internes PRIVÉES (agence uniquement — jamais visibles par l'artisan) */}
      <NotesInternesCard projetId={projet.id} valeur={projet.notes_internes} />

      {/* Programmer un rappel daté (email + tâche dans « À faire ») */}
      <RappelProjetCard projetId={projet.id} />

      {/* Relances automatiques (anti-inaction) */}
      <RelancesProjetCard projetId={projet.id} />

      {/* Devis générés par l'artisan, rattachés à ce dossier */}
      <DevisProjetCard projetId={projet.id} />

      {/* Argent / commission */}
      <MontantsCard projet={projet} />

      {/* Documents */}
      <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
        <CardHeader>
          <CardTitre>Documents (PDF)</CardTitre>
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

      <ConfirmStatutDialog
        open={statutEnAttente != null}
        statut={statutEnAttente}
        onOpenChange={(open) => !open && setStatutEnAttente(null)}
        onConfirm={() => {
          if (statutEnAttente) changerStatut(statutEnAttente)
          setStatutEnAttente(null)
        }}
      />

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
