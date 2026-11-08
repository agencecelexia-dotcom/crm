import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Download, Eye, File, FileText, Image as ImageIcon, Loader2, Music, Video } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { supabase } from '@/lib/supabase/client'
import { formatDate } from '@/lib/format'
import { categorieDe, formatTaille, type CategorieFichier } from '@/lib/fichiers'
import type { DocumentPartage } from '@/types/database'

const ICONE: Record<CategorieFichier, typeof File> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  pdf: FileText,
  autre: File,
}

/**
 * Demande une URL signée pour une pièce partagée.
 *
 * L'artisan est anonyme : il ne peut pas signer lui-même une URL sur un bucket
 * privé. L'edge function `document-signe` vérifie que son token correspond
 * bien à une affectation vivante sur le projet portant la pièce, puis signe
 * pour une heure. Renvoie null en cas de refus ou d'erreur.
 */
async function urlPiece(token: string, documentId: string, download = false) {
  const { data, error } = await supabase.functions.invoke('document-signe', {
    body: { token, document_id: documentId, download },
  })
  const r = data as { ok?: boolean; url?: string } | null
  if (error || !r?.ok || !r.url || !/^https:\/\//i.test(r.url)) return null
  return r.url
}

function useDocumentsPartages(token: string) {
  return useQuery({
    queryKey: ['espace-artisan', token, 'documents'],
    queryFn: async (): Promise<DocumentPartage[]> => {
      const { data, error } = await supabase.rpc('documents_projet_par_token', {
        p_token: token,
      })
      if (error) throw error
      return (data ?? []) as DocumentPartage[]
    },
  })
}

/**
 * Pièces jointes que l'agence a partagées sur ce chantier : devis déjà établi
 * par un confrère, photos et vidéos envoyées par le client, plans, courriers.
 *
 * C'est ce qui permet à l'artisan de se faire une idée du chantier — voire de
 * chiffrer — avant même de se déplacer. Rien ne s'affiche s'il n'y a rien à
 * montrer : une section vide sur chaque dossier serait du bruit.
 */
export function DocumentsPartages({ token }: { token: string }) {
  const { data: documents, isLoading, isError, refetch, isFetching } = useDocumentsPartages(token)

  if (isLoading) return <Skeleton className="h-16 w-full rounded-lg" />
  if (isError) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4" role="alert">
        <AlertCircle className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">Les documents n’ont pas pu être chargés.</p>
        <Button variant="outline" className="min-h-11" disabled={isFetching} onClick={() => void refetch()}>
          Réessayer
        </Button>
      </div>
    )
  }
  if (!documents?.length) return null

  return (
    <div className="space-y-2" aria-label="Documents partagés par Celexia">
      {documents.map((doc) => (
        <LigneDocument key={doc.id} doc={doc} token={token} />
      ))}
    </div>
  )
}

/**
 * Même contenu, présenté en carte autonome — la mise en page de `mission-page`
 * empile des `Card`, là où `corps-chantier` insère des sections dans une fiche
 * déjà encadrée. Comme le composant nu, ne rend rien s'il n'y a aucune pièce.
 */
export function DocumentsPartagesCard({ token }: { token: string }) {
  const { data: documents, isLoading, isError } = useDocumentsPartages(token)
  if (isLoading || (!isError && !documents?.length)) return null

  return (
    <Card className="rounded-[10px] border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Documents du chantier</CardTitle>
      </CardHeader>
      <CardContent>
        <DocumentsPartages token={token} />
      </CardContent>
    </Card>
  )
}

function LigneDocument({ doc, token }: { doc: DocumentPartage; token: string }) {
  const [ouverture, setOuverture] = useState(false)
  const [telechargement, setTelechargement] = useState(false)
  const categorie = categorieDe(doc.nom, doc.type_mime)
  const Icone = ICONE[categorie]

  // Onglet ouvert DANS le geste de clic puis redirigé : les navigateurs
  // mobiles bloquent une ouverture asynchrone. Même approche que côté agence.
  async function consulter() {
    setOuverture(true)
    const onglet = window.open('about:blank', '_blank')
    try {
      const url = await urlPiece(token, doc.id)
      if (!url) {
        onglet?.close()
        toast.error('Document indisponible')
        return
      }
      if (onglet) onglet.location.href = url
      else window.location.href = url
    } catch {
      onglet?.close()
      toast.error('Document indisponible. Réessayez.')
    } finally {
      setOuverture(false)
    }
  }

  async function telecharger() {
    setTelechargement(true)
    try {
      const url = await urlPiece(token, doc.id, true)
      if (!url) {
        toast.error('Document indisponible')
        return
      }
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      toast.error('Téléchargement indisponible. Réessayez.')
    } finally {
      setTelechargement(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ApercuPiece doc={doc} categorie={categorie} Icone={Icone} token={token} />
        <div className="min-w-0 flex-1 basis-24">
          <p className="break-words text-sm font-medium">{doc.nom}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(doc.created_at)}
            {doc.taille_octets != null && ` · ${formatTaille(doc.taille_octets)}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-11"
            aria-label={`Ouvrir ${doc.nom}`}
            disabled={ouverture}
            onClick={() => void consulter()}
          >
            {ouverture ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-11"
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
        </div>
      </div>
    </div>
  )
}

/**
 * Aperçu d'une pièce : miniature pour une image, icône sinon.
 *
 * Chaque aperçu coûte un appel à l'edge function — on ne le paie donc que pour
 * les images, où il apporte vraiment quelque chose. Une vidéo garde son icône :
 * en extraire une vignette obligerait à la télécharger entièrement, ce qui est
 * hors de question sur un mobile en 4G au bord d'un chantier.
 */
function ApercuPiece({
  doc,
  categorie,
  Icone,
  token,
}: {
  doc: DocumentPartage
  categorie: CategorieFichier
  Icone: typeof File
  token: string
}) {
  const [apercu, setApercu] = useState<string | null>(null)

  useEffect(() => {
    if (categorie !== 'image') return
    let vivant = true
    void urlPiece(token, doc.id).then((url) => {
      if (vivant) setApercu(url)
    }).catch(() => undefined)
    return () => {
      vivant = false
    }
  }, [categorie, doc.id, token])

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
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      <Icone className="size-5" />
    </span>
  )
}
