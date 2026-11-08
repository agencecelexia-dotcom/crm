import { useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Loader2, Minus, Plus } from 'lucide-react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { devisEnBlob, type DevisData } from './devis-pdf'

/** Un instantané local : ouvrir, lire et télécharger ne sauvegardent rien et
 * ne changent jamais la révision du brouillon resté ouvert dessous. */
export function ApercuDevis({ data, onClose, retourFocus }: {
  data: DevisData
  onClose: () => void
  retourFocus: () => void
}) {
  const [tentative, setTentative] = useState(0)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[96dvh] max-h-[96dvh] max-w-full flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-[1100px] sm:rounded-xl"
        onCloseAutoFocus={(event) => { event.preventDefault(); retourFocus() }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <DialogTitle className="font-display text-lg font-medium">Aperçu du devis</DialogTitle>
            <DialogDescription className="mt-1 text-xs">{data.numero === 'APERÇU' ? 'Numéro attribué à l’enregistrement' : data.numero} · Vérifiez le document avant l’envoi</DialogDescription>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={onClose}>
            <ArrowLeft className="size-4" aria-hidden />
            Revenir au devis
          </Button>
        </header>
        <DocumentDevis key={tentative} data={data} onRetry={() => setTentative((n) => n + 1)} />
      </DialogContent>
    </Dialog>
  )
}

function DocumentDevis({ data, onRetry }: { data: DevisData; onRetry: () => void }) {
  const [fichier, setFichier] = useState<string | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [erreur, setErreur] = useState(false)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [texteVisible, setTexteVisible] = useState(false)
  const [largeur, setLargeur] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let annule = false
    let url: string | undefined
    let chargement: PDFDocumentLoadingTask | undefined
    let worker: Worker | undefined
    let moteur: PDFWorker | undefined
    let arreterSurveillance = () => {}
    async function charger() {
      try {
        const blob = await devisEnBlob(data)
        if (annule) return
        url = URL.createObjectURL(blob)
        setFichier(url)
        const pdfjs = await import('pdfjs-dist')
        const contenu = await blob.arrayBuffer()
        if (annule) return
        // Un worker propre à cet aperçu : le repli global de PDF.js mémorise
        // définitivement un échec réseau et empêcherait « Réessayer » de
        // fonctionner, même une fois la connexion rétablie.
        worker = new Worker(workerUrl, { type: 'module' })
        const attenteWorker = new Promise<never>((_, reject) => {
          const echec = (event: ErrorEvent) => { event.preventDefault(); reject(new Error('Lecture PDF indisponible')) }
          const timeout = window.setTimeout(() => reject(new Error('Lecture PDF trop longue')), 20_000)
          worker!.addEventListener('error', echec)
          arreterSurveillance = () => { window.clearTimeout(timeout); worker?.removeEventListener('error', echec) }
        })
        moteur = pdfjs.PDFWorker.create({ port: worker })
        chargement = pdfjs.getDocument({ data: contenu, worker: moteur })
        const document = await Promise.race([chargement.promise, attenteWorker])
        if (!annule) setPdf(document)
      } catch {
        if (!annule) setErreur(true)
      } finally {
        arreterSurveillance()
      }
    }
    void charger()
    return () => {
      annule = true
      arreterSurveillance()
      if (url) URL.revokeObjectURL(url)
      // Détruit aussi le worker et les pages, même en cours de chargement.
      void chargement?.destroy().catch(() => undefined)
      moteur?.destroy()
      worker?.terminate()
    }
  }, [data])

  useEffect(() => {
    const zone = viewport.current
    if (!zone) return
    const observer = new ResizeObserver(([entry]) => setLargeur(Math.max(1, entry.contentRect.width - 32)))
    observer.observe(zone)
    return () => observer.disconnect()
  }, [])

  function allerPage(numero: number) {
    setPage(numero)
    viewport.current?.scrollTo({ top: 0, left: 0 })
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2 sm:px-6" aria-label="Commandes de l’aperçu">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-11" aria-label="Page précédente" disabled={!pdf || page <= 1} onClick={() => allerPage(page - 1)}><ChevronLeft className="size-4" /></Button>
          <label className="flex items-center gap-1.5 text-xs tabular-nums">
            Page
            <select aria-label="Page affichée" className="h-11 rounded-md border bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={page} disabled={!pdf} onChange={(e) => allerPage(Number(e.target.value))}>
              {Array.from({ length: pdf?.numPages ?? 1 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
            </select>
            <span aria-live="polite">sur {pdf?.numPages ?? '…'}</span>
          </label>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Page suivante" disabled={!pdf || page >= pdf.numPages} onClick={() => allerPage(page + 1)}><ChevronRight className="size-4" /></Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-11" aria-label="Réduire le zoom" disabled={!pdf || zoom <= 0.75} onClick={() => setZoom((n) => Math.max(0.75, n - 0.25))}><Minus className="size-4" /></Button>
          <Button variant="ghost" size="sm" title="Adapter le document à la largeur" disabled={!pdf} onClick={() => setZoom(1)} className="min-w-20 text-xs tabular-nums">{zoom === 1 ? 'À la largeur' : `${Math.round(zoom * 100)} %`}</Button>
          <Button variant="ghost" size="icon" className="size-11" aria-label="Agrandir le zoom" disabled={!pdf || zoom >= 2} onClick={() => setZoom((n) => Math.min(2, n + 0.25))}><Plus className="size-4" /></Button>
        </div>
        {fichier ? <Button variant="outline" size="sm" asChild><a href={fichier} download={`devis-${data.numero}.pdf`}><Download className="size-4" aria-hidden />Télécharger</a></Button> : <Button variant="outline" size="sm" disabled><Download className="size-4" aria-hidden />Télécharger</Button>}
      </div>
      <div ref={viewport} className="min-h-0 flex-1 overflow-auto overscroll-contain bg-background p-4" role="region" aria-label="Document PDF" tabIndex={0}>
        {erreur ? (
          <div role="alert" className="mx-auto my-10 max-w-md rounded-xl border bg-card p-6 text-center">
            <p className="font-medium">L’aperçu n’a pas pu être affiché</p>
            <p className="mt-2 text-sm text-muted-foreground">Vos saisies sont conservées. Vous pouvez revenir au devis{fichier ? ' ou télécharger le PDF' : ''}.</p>
            <Button variant="outline" className="mt-4" onClick={onRetry}>Réessayer l’aperçu</Button>
          </div>
        ) : pdf && largeur > 0 ? (
          <PageDevis key={`${page}-${largeur}-${zoom}`} pdf={pdf} numero={page} largeur={largeur * zoom} texteVisible={texteVisible} />
        ) : <div role="status" className="flex justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />Préparation de l’aperçu…</div>}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t bg-card px-4 py-2 text-xs text-muted-foreground sm:px-6">
        <p>Aucun enregistrement ni envoi.</p>
        <Button variant="ghost" size="sm" disabled={!pdf} aria-pressed={texteVisible} onClick={() => setTexteVisible((v) => !v)} className="text-xs">{texteVisible ? 'Afficher le document' : 'Afficher le texte'}</Button>
      </footer>
    </>
  )
}

/** Une seule page/canvas à la fois, y compris sur les devis longs. Le texte
 * extrait du même PDF reste disponible aux lecteurs d’écran et en vue texte. */
function PageDevis({ pdf, numero, largeur, texteVisible }: { pdf: PDFDocumentProxy; numero: number; largeur: number; texteVisible: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const texteId = useId()
  const [texte, setTexte] = useState('')
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'erreur'>('chargement')
  const [tentative, setTentative] = useState(0)

  useEffect(() => {
    let annule = false
    let rendu: RenderTask | undefined
    async function afficher() {
      try {
        const page = await pdf.getPage(numero)
        if (annule || !canvas.current) return
        const vue = page.getViewport({ scale: largeur / page.getViewport({ scale: 1 }).width })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const cible = canvas.current
        cible.width = Math.ceil(vue.width * ratio)
        cible.height = Math.ceil(vue.height * ratio)
        cible.style.width = `${vue.width}px`
        cible.style.height = `${vue.height}px`
        rendu = page.render({ canvas: cible, viewport: vue, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
        const [, contenu] = await Promise.all([rendu.promise, page.getTextContent()])
        if (annule) return
        setTexte(contenu.items.map((item) => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join(''))
        if (!annule) setEtat('pret')
      } catch {
        if (!annule) setEtat('erreur')
      }
    }
    void afficher()
    return () => { annule = true; rendu?.cancel() }
  }, [pdf, numero, largeur, tentative])

  return (
    <div className={texteVisible ? 'mx-auto min-w-0 max-w-3xl' : 'mx-auto w-fit min-w-0 max-w-none'}>
      {etat === 'chargement' && <p role="status" className="py-4 text-center text-sm text-muted-foreground">Affichage de la page {numero}…</p>}
      {etat === 'erreur' && <div role="alert" className="rounded-xl border bg-card p-5 text-sm"><p>Cette page n’a pas pu être affichée. Le téléchargement reste disponible.</p><Button variant="outline" className="mt-3" onClick={() => { setEtat('chargement'); setTentative((n) => n + 1) }}>Réessayer cette page</Button></div>}
      <canvas ref={canvas} aria-hidden="true" className={texteVisible || etat !== 'pret' ? 'hidden' : 'block bg-white shadow-sm'} />
      <article id={texteId} aria-label={`Texte de la page ${numero}`} className={texteVisible ? 'whitespace-pre-wrap wrap-anywhere rounded-lg border bg-card p-5 text-sm leading-relaxed' : 'sr-only'}>
        <h2 className="mb-3 font-medium">Page {numero} sur {pdf.numPages}</h2>
        {texte}
      </article>
    </div>
  )
}
