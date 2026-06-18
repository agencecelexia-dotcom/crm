import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Loader2,
  Pencil,
  Trash2,
  Phone,
  Mail,
  MapPin,
  TrendingUp,
  ShieldOff,
} from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { StatutBadge } from '@/components/statut-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
import { formatEuros, formatDate, formatTel } from '@/lib/format'
import { useArtisan, useDeleteArtisan, useEcarterArtisan } from '../hooks/use-artisans'
import { useProjetsByArtisan } from '@/features/projets/hooks/use-projets'
import { ContratCard } from '@/features/contrats/contrat-card'

// Fiche artisan : infos, spécificités, historique projets, total rapporté.
export function ArtisanDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: artisan, isLoading } = useArtisan(id)
  const { data: projets } = useProjetsByArtisan(id)
  const remove = useDeleteArtisan()
  const ecarter = useEcarterArtisan()
  const [motif, setMotif] = useState('')

  if (isLoading || !artisan) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  // Total rapporté = somme des commissions des devis signés de cet artisan.
  const totalRapporte = (projets ?? [])
    .filter((p) => p.statut === 'devis_signe')
    .reduce((acc, p) => acc + (p.commission ?? 0), 0)

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        titre={`${artisan.nom} ${artisan.prenom ?? ''}`.trim()}
        sousTitre={artisan.societe ?? undefined}
        back
        action={
          <Button asChild variant="outline" size="icon" aria-label="Modifier">
            <Link to={`/artisans/${artisan.id}/edit`}>
              <Pencil className="size-4" />
            </Link>
          </Button>
        }
      />

      {/* Total rapporté (KPI) */}
      <Card className="mb-4 bg-primary text-primary-foreground">
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-5" />
            <span className="text-sm font-medium opacity-90">Total rapporté</span>
          </div>
          <span className="montant text-2xl font-semibold">
            {formatEuros(totalRapporte)}
          </span>
        </CardContent>
      </Card>

      {/* Coordonnées */}
      <Card className="mb-4">
        <CardContent className="space-y-3 py-4 text-sm">
          {artisan.telephone && (
            <a
              href={`tel:${artisan.telephone}`}
              className="flex items-center gap-3 text-foreground"
            >
              <Phone className="size-4 text-muted-foreground" />
              {formatTel(artisan.telephone)}
            </a>
          )}
          {artisan.email && (
            <a
              href={`mailto:${artisan.email}`}
              className="flex items-center gap-3 break-all text-foreground"
            >
              <Mail className="size-4 text-muted-foreground" />
              {artisan.email}
            </a>
          )}
          {(artisan.adresse || artisan.ville) && (
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                {[artisan.adresse, artisan.code_postal, artisan.ville]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </div>
          )}
          {artisan.rayon_km != null && (
            <p className="text-muted-foreground">
              Rayon d'intervention : {artisan.rayon_km} km autour de son adresse
            </p>
          )}

          {artisan.metiers.length > 0 && (
            <>
              <Separator />
              <div className="flex flex-wrap gap-1.5">
                {artisan.metiers.map((m) => (
                  <Badge key={m} variant="secondary">
                    {m}
                  </Badge>
                ))}
              </div>
            </>
          )}

          {artisan.sous_metiers.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Fait exactement :
              </p>
              <div className="flex flex-wrap gap-1.5">
                {artisan.sous_metiers.map((s) => (
                  <Badge key={s} variant="outline">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {artisan.specificites && (
            <>
              <Separator />
              <p className="whitespace-pre-wrap text-muted-foreground">
                {artisan.specificites}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Contrat d'engagement (signature en ligne) */}
      <ContratCard artisan={artisan} />

      {/* Historique des projets */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">
            Projets ({projets?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!projets || projets.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              Aucun projet assigné pour le moment.
            </p>
          ) : (
            projets.map((p) => (
              <Link
                key={p.id}
                to={`/projets/${p.id}`}
                className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {p.client_nom} · {p.metier}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(p.created_at)}
                    {p.montant_devis_signe != null &&
                      ` · ${formatEuros(p.montant_devis_signe)}`}
                  </p>
                </div>
                <StatutBadge statut={p.statut} />
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {/* Écarter (pas fiable) — alternative recommandée à la suppression */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="mb-2 w-full">
            <ShieldOff className="size-4" />
            Écarter (pas fiable)
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Écarter cet artisan ?</AlertDialogTitle>
            <AlertDialogDescription>
              Il quitte la liste active (plus assignable ni relancé), mais reste conservé dans
              « Artisans écartés » — pour ne pas le recontacter par erreur. Réversible à tout moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Motif (facultatif)</Label>
            <Input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              placeholder="Ex. ne répond pas, devis hors prix, peu sérieux…"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                ecarter.mutate(
                  { id: artisan.id, motif: motif.trim() || undefined },
                  {
                    onSuccess: () => {
                      toast.success('Artisan écarté (conservé dans « Pas fiables »)')
                      navigate('/artisans', { replace: true })
                    },
                    onError: (err) =>
                      toast.error('Échec', {
                        description: err instanceof Error ? err.message : undefined,
                      }),
                  },
                )
              }
            >
              Écarter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Suppression définitive */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" className="w-full text-destructive">
            <Trash2 className="size-4" />
            Supprimer cet artisan
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l'artisan ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Les projets liés ne seront pas
              supprimés mais perdront leur artisan assigné.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                remove.mutate(artisan.id, {
                  onSuccess: () => {
                    toast.success('Artisan supprimé')
                    navigate('/artisans', { replace: true })
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
