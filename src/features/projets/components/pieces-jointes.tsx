import { useRef, useState } from 'react'
import { FileText, Loader2, Plus, Trash2, Download, Eye } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useDropzone } from '@/hooks/use-dropzone'
import { urlSignee } from '@/lib/storage'
import { formatDate } from '@/lib/format'
import {
  useAjouterDocuments,
  useProjetDocuments,
  useSupprimerDocument,
} from '../hooks/use-projet-documents'
import type { ProjetDocument } from '@/types/database'

/** Taille max par fichier. Au-delà, l'upload échouerait côté Supabase sans message clair. */
const TAILLE_MAX_OCTETS = 20 * 1024 * 1024

function formatTaille(octets: number | null): string {
  if (octets == null) return ''
  if (octets < 1024) return `${octets} o`
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} Ko`
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`
}

/**
 * Pièces jointes libres d'un projet : autant de PDF que nécessaire, en plus
 * des trois emplacements fixes (contrat / devis / devis signé) qui, eux,
 * pilotent la machine à états et restent uniques.
 *
 * Les fichiers vivent dans le bucket PRIVÉ `documents` ; toute consultation
 * passe par une URL signée d'une heure.
 */
export function PiecesJointes({ projetId }: { projetId: string }) {
  const { data: documents, isLoading, isError, refetch } = useProjetDocuments(projetId)
  const ajouter = useAjouterDocuments(projetId)
  const supprimer = useSupprimerDocument(projetId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [aSupprimer, setASupprimer] = useState<ProjetDocument | null>(null)

  function traiter(files: File[]) {
    const pdfs = files.filter((f) => !f.type || f.type.includes('pdf'))
    const rejetes = files.length - pdfs.length
    if (rejetes > 0) {
      toast.error(rejetes > 1 ? `${rejetes} fichiers ignorés` : 'Fichier ignoré', {
        description: 'Format PDF uniquement.',
      })
    }
    const tropGros = pdfs.filter((f) => f.size > TAILLE_MAX_OCTETS)
    if (tropGros.length) {
      toast.error('Fichier trop volumineux', { description: 'Maximum 20 Mo par document.' })
    }
    const retenus = pdfs.filter((f) => f.size <= TAILLE_MAX_OCTETS)
    if (retenus.length) ajouter.mutate(retenus)
    if (inputRef.current) inputRef.current.value = ''
  }

  const { dragActive, handlers } = useDropzone(
    (f) => traiter([f]),
    traiter,
  )

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => traiter(Array.from(e.target.files ?? []))}
      />

      {isLoading ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium">Impossible de charger les pièces jointes.</p>
          <button onClick={() => void refetch()} className="mt-1 text-xs underline">
            Réessayer
          </button>
        </div>
      ) : (
        documents?.map((doc) => (
          <LignePiece key={doc.id} doc={doc} onSupprimer={() => setASupprimer(doc)} />
        ))
      )}

      {/* Zone de dépôt / ajout */}
      <button
        type="button"
        {...handlers}
        onClick={() => inputRef.current?.click()}
        disabled={ajouter.isPending}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-sm transition-colors',
          dragActive
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-accent/40',
        )}
      >
        {ajouter.isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Envoi en cours…
          </>
        ) : (
          <>
            <Plus className="size-4" />
            {dragActive ? 'Déposez vos PDF ici…' : 'Ajouter des PDF (ou glissez-les ici)'}
          </>
        )}
      </button>

      <AlertDialog
        open={aSupprimer != null}
        onOpenChange={(o) => !o && setASupprimer(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {aSupprimer?.nom} » sera définitivement supprimé. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (aSupprimer) supprimer.mutate(aSupprimer)
                setASupprimer(null)
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function LignePiece({ doc, onSupprimer }: { doc: ProjetDocument; onSupprimer: () => void }) {
  const [ouverture, setOuverture] = useState(false)
  const [telechargement, setTelechargement] = useState(false)

  // On ouvre l'onglet DANS le geste de clic puis on le redirige : les
  // navigateurs (surtout mobiles) bloquent une ouverture asynchrone.
  // Même approche que DocumentRow.
  async function consulter() {
    setOuverture(true)
    const onglet = window.open('about:blank', '_blank')
    try {
      const url = await urlSignee(doc.chemin)
      if (!url) {
        onglet?.close()
        toast.error('Document introuvable')
        return
      }
      if (onglet) onglet.location.href = url
      else window.location.href = url
    } finally {
      setOuverture(false)
    }
  }

  async function telecharger() {
    setTelechargement(true)
    try {
      const url = await urlSignee(doc.chemin, 3600, doc.nom)
      if (!url) {
        toast.error('Document introuvable')
        return
      }
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      setTelechargement(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <FileText className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{doc.nom}</p>
        <p className="text-xs text-muted-foreground">
          {formatDate(doc.created_at)}
          {doc.taille_octets != null && ` · ${formatTaille(doc.taille_octets)}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Consulter ${doc.nom}`}
          disabled={ouverture}
          onClick={() => void consulter()}
        >
          {ouverture ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Télécharger ${doc.nom}`}
          disabled={telechargement}
          onClick={() => void telecharger()}
        >
          {telechargement ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Supprimer ${doc.nom}`}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={onSupprimer}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}
