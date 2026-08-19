import { useEffect, useRef, useState } from 'react'
import {
  Download,
  Eye,
  File,
  FileText,
  Image as ImageIcon,
  Loader2,
  Music,
  Plus,
  Trash2,
  Video,
} from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useDropzone } from '@/hooks/use-dropzone'
import { urlSignee } from '@/lib/storage'
import { formatDate } from '@/lib/format'
import {
  categorieDe,
  formatAutorise,
  formatTaille,
  TAILLE_MAX_OCTETS,
  type CategorieFichier,
} from '@/lib/fichiers'
import {
  useAjouterDocuments,
  useBasculerPartage,
  useProjetDocuments,
  useSupprimerDocument,
} from '../hooks/use-projet-documents'
import type { ProjetDocument } from '@/types/database'

const ICONE: Record<CategorieFichier, typeof File> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  pdf: FileText,
  autre: File,
}

/**
 * Pièces jointes libres d'un projet : autant de fichiers que nécessaire, de
 * n'importe quel format, en plus des trois emplacements fixes (contrat / devis
 * / devis signé) qui, eux, pilotent la machine à états et restent uniques.
 *
 * Depuis 0098 on ne se limite plus au PDF : un client qui a déjà fait chiffrer
 * son chantier nous envoie son devis, des photos, parfois une vidéo — et tout
 * cela doit pouvoir remonter à l'artisan, d'où l'interrupteur de partage sur
 * chaque ligne.
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
    const acceptes = files.filter(formatAutorise)
    const rejetes = files.length - acceptes.length
    if (rejetes > 0) {
      toast.error(rejetes > 1 ? `${rejetes} fichiers ignorés` : 'Fichier ignoré', {
        description: 'Les programmes et scripts ne peuvent pas être joints.',
      })
    }
    const tropGros = acceptes.filter((f) => f.size > TAILLE_MAX_OCTETS)
    if (tropGros.length) {
      toast.error(
        tropGros.length > 1 ? `${tropGros.length} fichiers trop volumineux` : 'Fichier trop volumineux',
        { description: `Maximum ${formatTaille(TAILLE_MAX_OCTETS)} par pièce.` },
      )
    }
    const retenus = acceptes.filter((f) => f.size <= TAILLE_MAX_OCTETS)
    if (retenus.length) ajouter.mutate(retenus)
    if (inputRef.current) inputRef.current.value = ''
  }

  const { dragActive, handlers } = useDropzone((f) => traiter([f]), traiter)

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
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
          <LignePiece
            key={doc.id}
            doc={doc}
            projetId={projetId}
            onSupprimer={() => setASupprimer(doc)}
          />
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
            {dragActive
              ? 'Déposez vos fichiers ici…'
              : 'Ajouter des fichiers (PDF, photos, vidéos…)'}
          </>
        )}
      </button>

      <AlertDialog open={aSupprimer != null} onOpenChange={(o) => !o && setASupprimer(null)}>
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

function LignePiece({
  doc,
  projetId,
  onSupprimer,
}: {
  doc: ProjetDocument
  projetId: string
  onSupprimer: () => void
}) {
  const [ouverture, setOuverture] = useState(false)
  const [telechargement, setTelechargement] = useState(false)
  const partage = useBasculerPartage(projetId)
  const categorie = categorieDe(doc.nom, doc.type_mime)
  const Icone = ICONE[categorie]

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
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        <Vignette doc={doc} categorie={categorie} Icone={Icone} />
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

      {/* Partage avec l'artisan. Sur sa propre ligne : c'est une décision
          éditoriale (« est-ce que l'artisan doit voir ça ? »), pas une action
          sur le fichier — la mélanger aux icônes la rendrait cliquable par
          erreur. */}
      <label className="mt-2.5 flex cursor-pointer items-center gap-2 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
        <Switch
          checked={doc.visible_artisan}
          onCheckedChange={(v) => partage.mutate({ id: doc.id, visible: v })}
          aria-label={`Partager ${doc.nom} avec l'artisan`}
        />
        {doc.visible_artisan ? 'Visible par l’artisan' : 'Interne à l’agence'}
      </label>
    </div>
  )
}

/**
 * Vignette d'aperçu : miniature réelle pour une image, icône de type sinon.
 *
 * L'image demande une URL signée, donc un appel réseau — on ne le fait que
 * pour les images, et une seule fois par ligne. Pour les vidéos on s'abstient :
 * générer une miniature imposerait de télécharger le fichier, ce qui est
 * exactement ce qu'on veut éviter sur une liste.
 */
function Vignette({
  doc,
  categorie,
  Icone,
}: {
  doc: ProjetDocument
  categorie: CategorieFichier
  Icone: typeof File
}) {
  const [apercu, setApercu] = useState<string | null>(null)

  useEffect(() => {
    if (categorie !== 'image') return
    let vivant = true
    void urlSignee(doc.chemin).then((url) => {
      if (vivant) setApercu(url)
    })
    return () => {
      vivant = false
    }
  }, [categorie, doc.chemin])

  if (categorie === 'image' && apercu) {
    return (
      <img
        src={apercu}
        alt=""
        className="size-10 shrink-0 rounded-md border border-border object-cover"
      />
    )
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
      <Icone className="size-5" />
    </span>
  )
}
