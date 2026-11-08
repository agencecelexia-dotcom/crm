import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Loader2,
  FileText,
  CheckCircle2,
  Download,
  Lock,
  FilePlus,
  RotateCcw,
  Search,
  Rows3,
  Columns3,
  RefreshCw,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'

import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import { STATUTS_ORDRE, statutInfo } from '@/lib/constants'
import { formatDate } from '@/lib/format'
import { telechargerContratPdf } from './contrat-pdf'
import { finaliserContenu, raisonRefusSignature } from './contrat-modele'
import { ContratFormate } from './contrat-format'
import { ChantiersPerdus } from './chantiers-perdus'
import { PiedDePageArtisan } from './pied-de-page-artisan'
import { EnteteChantier, LisereStatut } from './entete-chantier'
import { KanbanChantiers } from './kanban-chantiers'
import { DrawerChantier } from './drawer-chantier'
import { ReleveCommissions } from './releve-commissions'
import { correspond, dateReception, estClos, urgenceChantier } from './urgence-chantier'
import { ApercuDernierSuivi } from './apercu-dernier-suivi'
import { TableauDeBordArtisan } from './tableau-de-bord-artisan'
import { DevisBuilder, type DevisInitial } from '@/features/devis/devis-builder'
import { useListeDevis, useReprendreDevis, type BrouillonDevis } from '@/features/devis/use-devis'
import { CarteIdentite } from '@/features/devis/carte-identite'
import { EcranMetres } from '@/features/metre/ecran-metres'
import { FeuilleMetreDifferee } from '@/features/metre/feuille-metre-differee'
import { CadreEspace } from './cadre-espace'
import { ECRANS } from './ecrans-espace'
import { PageHeader } from '@/components/page-header'
import { useVueEspace } from './use-vue-espace'
import { CarteAssurances } from '@/features/assurances/carte-assurances'
import { useEtatChiffrage } from '@/features/assurances/use-assurances'
import type { EspaceArtisan, ProjetEspace, StatutProjet } from '@/types/database'

// Espace artisan UNIQUE (/artisan/:token) : il signe son contrat une fois,
// puis retrouve TOUS ses chantiers. Identité client masquée tant que non signé.
export function EspaceArtisanPage() {
  const { token } = useParams()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['espace', token],
    enabled: !!token,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<EspaceArtisan | null> => {
      const { data, error } = await supabase.rpc('get_espace_artisan', { p_token: token })
      if (error) throw error
      return (data as EspaceArtisan) ?? null
    },
  })
  // Le générateur de devis s'ouvre aux artisans dont les assurances sont
  // déposées ET validées (0131) — il était jusqu'ici réservé en dur à un seul.
  const chiffrageQuery = useEtatChiffrage(token)
  const chiffrage = chiffrageQuery.data
  const [devisInitial, setDevisInitial] = useState<DevisInitial | null>(null)
  // Bascule pipe actif / espace « Perdus » (migration 0070).
  const [vuePerdus, setVuePerdus] = useState(false)
  // L'écran courant vit dans l'URL : le bouton retour du téléphone ramène au
  // précédent au lieu de quitter l'espace.
  const [vue, allerA] = useVueEspace()
  // Le chantier dont on prend les mesures, s'il y en a un.
  const [mesure, setMesure] = useState<ProjetEspace | null>(null)
  // Filtre demandé depuis le tableau de bord.
  const [filtreDemande, setFiltreDemande] = useState<'urgents' | null>(null)

  if (isLoading)
    return (
      <div className="min-h-dvh bg-background">
        <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6 sm:py-12">
          <div className="mb-8 flex flex-col items-center gap-4">
            <BrandLogo className="h-10 mix-blend-multiply sm:h-11" />
            <div className="flex w-full max-w-2xl items-center gap-3">
              <Skeleton className="size-12 rounded-2xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-2/5" />
                <Skeleton className="h-4 w-1/4" />
              </div>
            </div>
          </div>
          <div className="mx-auto max-w-2xl space-y-4">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-52 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    )
  // UNE COUPURE RÉSEAU N'EST PAS UN LIEN INVALIDE.
  //
  // L'écran « lien invalide ou expiré » s'affichait pour toute erreur : un
  // artisan qui revenait sur l'onglet avec une 4G qui décroche voyait tout son
  // espace remplacé par ce message — et perdait la note qu'il était en train
  // d'écrire. Hors ligne au premier chargement, il croyait son lien mort et
  // appelait l'agence. On distingue désormais :
  //  - une erreur AVANT toute donnée : problème de connexion, bouton Réessayer ;
  //  - une erreur APRÈS chargement : on garde l'écran, avec un bandeau ;
  //  - une réponse vide du serveur : là seulement, le lien est invalide.
  if (!data && isError)
    return (
      <Centre>
        <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-card p-8 shadow-card">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <WifiOff className="size-6" />
          </span>
          <p className="font-display text-lg font-medium">Connexion impossible</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Votre espace n’a pas pu se charger. Vérifiez votre connexion, puis réessayez.
          </p>
          <Button className="mt-4 h-11 w-full" onClick={() => void refetch()}>
            <RefreshCw className="size-4" />
            Réessayer
          </Button>
        </div>
      </Centre>
    )
  if (!data)
    return (
      <Centre>
        <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-card p-8 shadow-card">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <FileText className="size-6" />
          </span>
          <p className="font-display text-lg font-medium">Espace introuvable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ce lien n’est plus valable. Demandez à Celexia de vous renvoyer celui de votre espace.
          </p>
        </div>
      </Centre>
    )

  const { artisan, engagement, signe, contrat_externe, projets: projetsRecus } = data
  const accesOuvert = signe || contrat_externe
  const projets = accesOuvert ? projetsRecus : projetsRecus.map((p) => ({ ...p, client_nom: null, client_telephone: null, client_email: null, client_adresse: null, client_code_postal: null, suivis: [] }))
  const projetsPerdus = data.projets_perdus ?? []
  const nomArtisan = [artisan.prenom, artisan.nom].filter(Boolean).join(' ') || artisan.societe
  const peutChiffrer = accesOuvert && chiffrage?.peut_chiffrer === true

  function ouvrirDevisProjet(p: ProjetEspace) {
    setDevisInitial({
      affectation_token: p.token,
      client_nom: p.client_nom,
      client_adresse: p.client_adresse,
      client_cp: p.client_code_postal,
      client_ville: p.client_ville,
      client_email: p.client_email,
      client_tel: p.client_telephone,
      objet: p.metiers?.length ? p.metiers.join(', ') : p.metier,
      metier: p.metiers?.[0] ?? p.metier,
      description: p.description,
    })
  }

  const ecran = ECRANS.find((e) => e.cle === vue) ?? ECRANS[0]
  const naviguer = (destination: typeof vue) => {
    setVuePerdus(false)
    allerA(destination)
  }

  return (
    <CadreEspace vue={vue} onAller={naviguer} nom={nomArtisan || 'Artisan'} societe={artisan.societe} signe={accesOuvert} nbChantiers={projets.length}>
      <PageHeader
        titre={vue === 'chantiers' && vuePerdus ? 'Chantiers perdus' : ecran.titre}
        sousTitre={`${artisan.societe || nomArtisan} · ${ecran.detail}`}
        action={<div className="flex flex-wrap items-center gap-2">
          {vue === 'chantiers' && projetsPerdus.length > 0 && !vuePerdus && <Button variant="outline" onClick={() => setVuePerdus(true)}><RotateCcw className="size-4" aria-hidden />Perdus <span className="text-xs tabular-nums text-muted-foreground">{projetsPerdus.length}</span></Button>}
          {vue === 'devis' && peutChiffrer && <Button onClick={() => setDevisInitial({})}><FilePlus className="size-4" aria-hidden />Nouveau devis</Button>}
        </div>}
      />

      {isError && <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><WifiOff className="size-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1">Connexion perdue : les informations affichées peuvent dater.</span><Button size="sm" variant="outline" onClick={() => void refetch()}>Réessayer</Button></div>}

      {!accesOuvert && <SignatureContrat engagement={engagement} onSigne={() => void refetch()} />}

      {vue === 'chantiers' && (vuePerdus ? (
        <ChantiersPerdus projets={projetsPerdus} signe={accesOuvert} onRetour={() => setVuePerdus(false)} onChange={() => void refetch()} />
      ) : (
        <div className="space-y-6">
          {accesOuvert && data.stats && <TableauDeBordArtisan stats={data.stats} projets={projets} onFiltrer={(f) => {
            setFiltreDemande(f)
            document.getElementById('mes-chantiers')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
          }} />}
          <ListeChantiers filtreDemande={filtreDemande} onFiltreApplique={() => setFiltreDemande(null)} projets={projets} signe={accesOuvert} onChange={() => void refetch()} onCreerDevis={peutChiffrer ? ouvrirDevisProjet : undefined} onMesurer={accesOuvert ? setMesure : undefined} />
          {accesOuvert && <p className="text-xs leading-6 text-muted-foreground">Votre interlocuteur Celexia vous transmet ces chantiers. Contactez vos clients et renseignez l’avancement pour garder un suivi partagé avec l’agence.</p>}
        </div>
      ))}

      {vue === 'devis' && accesOuvert && token && <div className="space-y-5">
        {chiffrageQuery.isLoading ? <Skeleton className="h-24 w-full rounded-xl" aria-label="Chargement de l’accès au générateur" /> : chiffrageQuery.isError ? (
          <div role="alert" className="rounded-xl border border-border bg-card p-6"><h2 className="text-base font-medium">L’accès aux devis n’a pas pu être vérifié</h2><p className="mt-2 text-sm text-muted-foreground">Vos devis existants restent consultables. Réessayez pour retrouver le générateur.</p><Button variant="outline" className="mt-4" onClick={() => void chiffrageQuery.refetch()}>Réessayer</Button></div>
        ) : !peutChiffrer && (
          <section className="flex items-start gap-4 rounded-xl border border-border bg-card p-5">
            <Lock className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div><h2 className="text-base font-medium">Activez la création de vos devis</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Vos devis et leurs PDF restent consultables. La création et la modification nécessitent des attestations décennale et RC professionnelle validées par Celexia.</p><Button variant="outline" className="mt-4" onClick={() => naviguer('entreprise')}>Compléter mes assurances</Button></div>
          </section>
        )}
        <MesDevis token={token} modifiable={peutChiffrer} onCreer={() => setDevisInitial({})} onReprendre={(brouillon) => setDevisInitial({ brouillon, client_nom: brouillon.client_nom, affectation_token: brouillon.affectation_token })} />
      </div>}
      {vue === 'metres' && accesOuvert && token && <EcranMetres token={token} projets={projets} />}
      {vue === 'commissions' && accesOuvert && token && <ReleveCommissions token={token} />}

      {vue === 'entreprise' && accesOuvert && (
        <div className="space-y-6">
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-5" aria-label="Contrat de partenariat">
            <div className="flex items-center gap-3"><CheckCircle2 className="size-5 shrink-0 text-emerald-700" aria-hidden /><div><h2 className="text-sm font-medium">Contrat de partenariat signé</h2><p className="mt-1 text-xs text-muted-foreground">{contrat_externe ? 'Contrat enregistré par votre agence' : engagement.signed_at ? `Signé le ${formatDate(engagement.signed_at)}` : 'Votre engagement avec Celexia'}</p></div></div>
            {!contrat_externe && <Button variant="outline" size="sm" onClick={() => telechargerContratPdf({ contenu: finaliserContenu(engagement.contenu, engagement.signed_at), signataire: engagement.signataire_nom, signedAt: engagement.signed_at, signatureDataUrl: engagement.signature_data, apporteurSignatureUrl: engagement.apporteur_signature })}><Download className="size-4" aria-hidden />Télécharger le contrat</Button>}
          </section>
          {token && <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]"><div className="min-w-0"><CarteIdentite token={token} /></div><div className="min-w-0"><CarteAssurances token={token} /></div></div>}
        </div>
      )}
      {vue === 'aide' && <PiedDePageArtisan />}

      {accesOuvert && mesure && token && <FeuilleMetreDifferee key={mesure.token} token={token} affectationToken={mesure.token} titre={mesure.client_nom} onClose={() => setMesure(null)} />}
      {peutChiffrer && token && devisInitial && <DevisBuilder key={devisInitial.brouillon?.id ?? devisInitial.affectation_token ?? 'standalone'} token={token} vendeur={artisan} initial={devisInitial} onClose={() => setDevisInitial(null)} onDone={() => void refetch()} />}
    </CadreEspace>
  )
}

// Titre de section du portail artisan.
function SectionTitre({ children, compte }: { children: ReactNode; compte?: number }) {
  return (
    <h2 className="flex items-center gap-2 font-display text-lg font-medium tracking-tight">
      <span>{children}</span>
      {compte != null && (
        <span className="font-sans text-xs font-normal tabular-nums text-muted-foreground">({compte})</span>
      )}
    </h2>
  )
}

function MesDevis({ token, modifiable, onCreer, onReprendre }: { token: string; modifiable: boolean; onCreer: () => void; onReprendre: (devis: BrouillonDevis) => void }) {
  const reprendre = useReprendreDevis(token)
  const { data: devis, isLoading, isError, refetch } = useListeDevis(token)
  const [filtre, setFiltre] = useState<'tous' | 'brouillon' | 'envoye'>('tous')
  const liste = (devis ?? []).filter((d) => filtre === 'tous' || d.statut === filtre)
  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" aria-label="Chargement des devis" />
  if (isError) return <div role="alert" className="rounded-xl border border-border bg-card p-6"><h2 className="text-base font-medium">Impossible de charger vos devis</h2><p className="mt-2 text-sm text-muted-foreground">Vos documents ne sont pas disponibles pour le moment.</p><Button variant="outline" className="mt-4" onClick={() => void refetch()}>Réessayer</Button></div>
  if (!devis?.length) return <section className="rounded-xl border border-border bg-card px-6 py-14 text-center"><FileText className="mx-auto mb-4 size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden /><h2 className="text-xl font-medium">{modifiable ? 'Votre premier devis commence ici' : 'Aucun devis enregistré'}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Créez un devis pour un chantier ou un nouveau client. Retrouvez ensuite ses montants, son statut et son PDF dans cet espace.</p>{modifiable && <Button className="mt-6" onClick={onCreer}><FilePlus className="size-4" aria-hidden />Créer un devis</Button>}</section>
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Liste des devis">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrer les devis">{([{ cle: 'tous', label: 'Tous' }, { cle: 'brouillon', label: 'Brouillons' }, { cle: 'envoye', label: 'Envoyés' }] as const).map((f) => <button type="button" key={f.cle} aria-pressed={filtre === f.cle} onClick={() => setFiltre(f.cle)} className={cn('min-h-11 rounded-md px-3 text-xs transition-colors md:min-h-8', filtre === f.cle ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/50')}>{f.label}</button>)}</div>
        <p role="status" className="text-xs tabular-nums text-muted-foreground">{liste.length} devis</p>
      </div>
      <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_120px_100px_160px] gap-4 border-b border-border bg-muted/40 px-5 py-3 text-xs text-muted-foreground xl:grid" aria-hidden><span>Client · référence</span><span>Objet</span><span className="text-right">Montant</span><span>Statut</span><span className="text-right">Document</span></div>
      {!liste.length ? <p className="p-8 text-center text-sm text-muted-foreground">Aucun devis dans cette vue.</p> : <ul className="divide-y divide-border">{liste.map((d) => <li key={d.id} className="grid grid-cols-2 items-center gap-3 px-4 py-5 sm:px-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_120px_100px_160px] xl:gap-4">
        <div className="min-w-0"><p className="break-words text-sm font-medium">{d.client_nom || 'Client non renseigné'}</p><p className="mt-1 text-xs text-muted-foreground">{d.numero}</p><p className="mt-1 text-xs tabular-nums text-muted-foreground">{formatDate(d.date_devis)}</p></div>
        <p className="min-w-0 break-words text-xs leading-5 text-muted-foreground">{d.objet || 'Objet non renseigné'}</p>
        <p className="text-sm font-medium tabular-nums xl:text-right">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(d.total || 0)}</p>
        <p className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground xl:justify-start"><span className={cn('size-1.5 rounded-full', d.statut === 'envoye' ? 'bg-emerald-600' : 'bg-muted-foreground/50')} aria-hidden />{d.statut === 'envoye' ? 'Envoyé' : ['en_cours', 'incertain', 'confirme'].includes(d.envoi_etat ?? '') ? 'Envoi à vérifier' : 'Brouillon'}</p>
        <div className="col-span-2 flex flex-wrap justify-end gap-2 xl:col-span-1">{d.statut !== 'envoye' && ['en_cours', 'incertain', 'confirme'].includes(d.envoi_etat ?? '') && <a className="text-xs text-primary underline underline-offset-4" href={`/artisan/${encodeURIComponent(token)}?vue=aide`}>Contacter Celexia</a>}{modifiable && d.statut === 'brouillon' && !['en_cours', 'incertain', 'confirme'].includes(d.envoi_etat ?? '') && <Button size="sm" variant="outline" disabled={reprendre.isPending} aria-label={`Reprendre le devis ${d.numero}`} onClick={() => reprendre.mutate(d.id, { onSuccess: onReprendre, onError: (e) => toast.error(e instanceof Error ? e.message : 'Brouillon indisponible') })}>{reprendre.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}Reprendre</Button>}{d.pdf_url ? <Button asChild size="sm" variant="outline"><a href={d.pdf_url} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir le PDF du devis ${d.numero}`}><Download className="size-3.5" aria-hidden />PDF</a></Button> : <span className="text-xs text-muted-foreground">PDF non disponible</span>}</div>
      </li>)}</ul>}
    </section>
  )
}

// Liste filtrable par statut (chips « Tous » + statuts présents avec compteur).

function ListeChantiers({
  projets,
  signe,
  onChange,
  onCreerDevis,
  onMesurer,
  filtreDemande,
  onFiltreApplique,
}: {
  projets: ProjetEspace[]
  signe: boolean
  onChange: () => void
  onCreerDevis?: (p: ProjetEspace) => void
  onMesurer?: (p: ProjetEspace) => void
  filtreDemande?: 'urgents' | null
  onFiltreApplique?: () => void
}) {
  const [filtreLocal, setFiltreLocal] = useState<'tous' | 'en_cours' | 'urgents' | StatutProjet>('tous')
  const [recherche, setRecherche] = useState('')
  const [vue, setVue] = useState<'liste' | 'kanban'>('liste')
  const [ouvertDrawer, setOuvertDrawer] = useState<ProjetEspace | null>(null)

  // Filtre poussé par le tableau de bord : valeur DÉRIVÉE plutôt qu'un
  // setState dans un effet, qui déclencherait un rendu en cascade.
  const filtre = filtreDemande ?? filtreLocal
  const setFiltre = (f: typeof filtreLocal) => {
    setFiltreLocal(f)
    onFiltreApplique?.()
  }

  const compte = (s: StatutProjet) => projets.filter((p) => p.statut === s).length
  const nbEnCours = projets.filter((p) => !estClos(p)).length
  const statutsPresents = STATUTS_ORDRE.filter((s) => compte(s) > 0 || filtre === s)

  // Urgence calculée une fois par chantier : sert au filtre, au tri et au badge.
  const urgences = useMemo(
    () => new Map(projets.map((p) => [p.id, urgenceChantier(p)])),
    [projets],
  )
  // « À traiter » se fonde sur le NIVEAU, pas sur un seuil de score : le score
  // sert au classement interne d'un groupe et bouge quand une règle change.
  // Un seuil numérique laissait entrer « Reçu récemment » (900), qui n'est
  // pas une action en retard.
  const estUrgent = (id: string) => {
    const n = urgences.get(id)?.niveau
    return n === 'critique' || n === 'haute'
  }
  const nbUrgents = projets.filter((p) => estUrgent(p.id)).length

  const filtres: { cle: 'tous' | 'en_cours' | 'urgents' | StatutProjet; label: string; n: number }[] = [
    { cle: 'tous', label: 'Tous', n: projets.length },
    ...(nbUrgents > 0 || filtre === 'urgents' ? [{ cle: 'urgents' as const, label: 'À traiter', n: nbUrgents }] : []),
    { cle: 'en_cours', label: 'Avant signature', n: nbEnCours },
    ...statutsPresents.map((s) => ({ cle: s, label: s === 'artisan_assigne' ? 'À contacter' : statutInfo(s).label, n: compte(s) })),
  ]

  // ORDRE CHRONOLOGIQUE, du plus récent au plus ancien : l'ordre de dépôt dans
  // le pipe. Le tri par urgence testé avant déplaçait les dossiers d'un jour à
  // l'autre selon des scores invisibles pour l'artisan, qui ne retrouvait plus
  // ses chantiers là où il les avait laissés. Une liste qui bouge toute seule
  // se relit entièrement à chaque fois.
  //
  // Seule exception : un chantier tranché (gagné ou perdu) n'a plus rien à
  // faire en haut de pile, il descend.
  const liste = useMemo(
    () =>
      projets
        .filter((p) =>
          filtre === 'tous'
            ? true
            : filtre === 'urgents'
              ? estUrgent(p.id)
              : filtre === 'en_cours'
                ? !estClos(p)
                : p.statut === filtre,
        )
        .filter((p) => correspond(p, recherche))
        .sort((a, b) => {
          const groupe = (p: ProjetEspace) => p.issue === 'perdu' || p.statut === 'termine' ? 2 : p.issue === 'gagne' ? 1 : 0
          const ecart = groupe(a) - groupe(b)
          if (ecart !== 0) return ecart
          return dateReception(b) - dateReception(a)
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- estUrgent dérive de `urgences`
    [projets, filtre, recherche, urgences],
  )

  return (
    <section id="mes-chantiers" className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionTitre compte={projets.length}>Vos chantiers</SectionTitre>
        {/* Une liste plate ne montre pas où le flux se bloque (audit §6). */}
        <div role="tablist" aria-label="Affichage" className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {(['liste', 'kanban'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              id={`affichage-${v}`}
              aria-controls="chantiers-affichage"
              tabIndex={vue === v ? 0 : -1}
              aria-selected={vue === v}
              onClick={() => setVue(v)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const suivant = event.key === 'Home' ? 'liste' : event.key === 'End' ? 'kanban' : vue === 'liste' ? 'kanban' : 'liste'
                setVue(suivant)
                document.getElementById(`affichage-${suivant}`)?.focus()
              }}
              className={cn(
                'flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors md:min-h-8',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                vue === v ? 'bg-muted text-foreground' : 'text-muted-foreground',
              )}
            >
              {v === 'liste' ? <Rows3 className="size-3.5" /> : <Columns3 className="size-3.5" />}
              {v === 'liste' ? 'Liste' : 'Par étape'}
            </button>
          ))}
        </div>
      </div>

      {/* Recherche : 65 cartes sans moyen de retrouver un client (audit §6). */}
      <div className="relative mb-3 max-w-2xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un client, une ville, un métier…"
          className="h-11 pl-9"
          aria-label="Rechercher un chantier"
        />
      </div>

      {/* Filtres par statut */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border pb-1">
        {filtres.map((f) => (
          <button
            key={f.cle}
            type="button"
            onClick={() => setFiltre(f.cle)}
            aria-pressed={filtre === f.cle}
            className={cn(
              'flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-xs transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              filtre === f.cle
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
            <span
              className={cn(
                'text-[11px] tabular-nums text-muted-foreground',
                filtre === f.cle && 'text-foreground',
              )}
            >
              {f.n}
            </span>
          </button>
        ))}
      </div>

      <div id="chantiers-affichage" role="tabpanel" aria-labelledby={`affichage-${vue}`}>
      {vue === 'kanban' ? (
        <KanbanChantiers projets={liste} signe={signe} onOuvrir={setOuvertDrawer} />
      ) : liste.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <FileText className="size-5" />
          </span>
          <p className="text-sm text-muted-foreground">
            {recherche ? 'Aucun chantier ne correspond à cette recherche.' : 'Aucun chantier dans ce filtre.'}
          </p>
        </div>
      ) : (
        // Liste simple, dans l'ordre où les chantiers ont été déposés. Le
        // regroupement par nature d'action testé avant réordonnait tout : un
        // chantier changeait de section selon son urgence calculée, et
        // l'artisan ne le retrouvait plus où il l'avait laissé.
        <div className="space-y-3">
          {liste.map((p, i) => {
            // Trait de séparation au premier chantier tranché. Le tri place
            // déjà les dossiers clos en bas ; la barre rend la frontière
            // visible, entre ce qui demande du travail et ce qui est acquis.
            //
            // « Clos » et non « terminés » : la section regroupe les dossiers
            // tranchés, gagnés COMME perdus — 34 perdus pour 13 gagnés
            // aujourd'hui. « Terminé » désigne par ailleurs l'étape finale du
            // parcours, et laissait croire que les travaux étaient faits.
            const groupe = (p: ProjetEspace) => p.issue === 'perdu' || p.statut === 'termine' ? 'clos' : p.issue === 'gagne' ? 'travaux' : 'commercial'
            const categorie = groupe(p)
            const premierClos = categorie !== 'commercial' && (i === 0 || groupe(liste[i - 1]) !== categorie)
            return (
              <div key={p.id} className={premierClos ? 'space-y-3 pt-3' : undefined}>
                {premierClos && (
                  <div className="flex items-center gap-3 pb-1">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {categorie === 'travaux' ? 'Travaux à suivre' : 'Terminés ou perdus'}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                <Card className="group relative gap-0 overflow-hidden rounded-lg py-0">
                  <LisereStatut statut={p.statut} />
                  <EnteteChantier projet={p} signe={signe} onToggle={() => setOuvertDrawer(p)} />
                  {signe && <ApercuDernierSuivi projet={p} variante="inline" />}
                </Card>
              </div>
            )
          })}
        </div>
      )}

      </div>
      {/* Détail en panneau latéral : la liste reste visible derrière. */}
      <DrawerChantier
        projet={projets.find((p) => p.id === ouvertDrawer?.id) ?? null}
        signe={signe}
        onClose={() => setOuvertDrawer(null)}
        onChange={onChange}
        onCreerDevis={onCreerDevis}
        onMesurer={onMesurer}
      />
    </section>
  )
}

// -------------------- Bloc signature du contrat --------------------
function SignatureContrat({
  engagement,
  onSigne,
}: {
  engagement: EspaceArtisan['engagement']
  onSigne: () => void
}) {
  const padRef = useRef<SignaturePadHandle>(null)
  const [nom, setNom] = useState('')
  const [accepte, setAccepte] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const signatureEnCours = useRef(false)

  async function signer() {
    if (signatureEnCours.current) return
    if (!nom.trim()) return toast.error('Indiquez votre nom')
    if (!accepte) return toast.error('Vous devez cocher « Lu et approuvé »')
    if (!padRef.current || padRef.current.isEmpty()) return toast.error('Signez dans le cadre')
    signatureEnCours.current = true
    setEnvoi(true)
    try {
      const signature = padRef.current!.toDataURL()
      const { data, error } = await supabase.rpc('signer_contrat', {
        p_token: engagement.token,
        p_signataire: nom.trim(),
        p_signature: signature,
      })
      const ok = (data as { ok?: boolean } | null)?.ok
      if (error) throw new Error('Connexion impossible : réessayez dans un instant.')
      if (!ok) throw new Error(raisonRefusSignature(data as { ok?: boolean; error?: string } | null))
      toast.success('Contrat signé. Merci !')
      onSigne()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur')
    } finally {
      signatureEnCours.current = false
      setEnvoi(false)
    }
  }

  return (
    <section id="contrat" className="mb-6 scroll-mt-20 overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="contrat-titre">
      <div className="border-b border-border px-5 py-5 sm:px-6"><p className="mb-2 text-xs font-medium text-muted-foreground">Bienvenue chez Celexia</p><h2 id="contrat-titre" className="text-xl font-medium">Votre contrat d’engagement</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Signez-le une seule fois pour accéder aux coordonnées de vos clients et aux outils de votre espace. Il couvre vos chantiers présents et à venir.</p></div>
      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0"><h3 className="mb-3 text-sm font-medium">01 · Lire les conditions</h3><div tabIndex={0} role="region" aria-label="Conditions du contrat, document défilant" className="max-h-[55dvh] overflow-y-auto rounded-lg border border-border bg-white"><ContratFormate contenu={finaliserContenu(engagement.contenu, engagement.signed_at)} apporteurSignature={engagement.apporteur_signature} /></div></div>
        <div className="min-w-0 space-y-5"><h3 className="text-sm font-medium">02 · Signer votre engagement</h3>
          <div className="space-y-2"><Label htmlFor="nom">Nom du signataire</Label><Input id="nom" className="h-11" autoComplete="name" value={nom} onChange={(e) => setNom(e.target.value)} /></div>
          <div className="space-y-2"><div className="flex items-center justify-between"><span className="text-sm font-medium">Signature</span><Button type="button" variant="ghost" size="sm" onClick={() => padRef.current?.clear()}>Effacer</Button></div><SignaturePad ref={padRef} className="h-40 w-full rounded-lg border border-input bg-white" /><p className="text-xs text-muted-foreground">Dessinez votre signature dans le cadre.</p></div>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-6"><Checkbox checked={accepte} onCheckedChange={(v) => setAccepte(v === true)} className="mt-1" /><span>J’ai lu et j’approuve l’intégralité des conditions du présent contrat.</span></label>
          <Button onClick={signer} disabled={envoi} className="h-11 w-full">{envoi && <Loader2 className="size-4 animate-spin" aria-hidden />}Signer le contrat</Button>
        </div>
      </div>
    </section>
  )
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      {children}
    </div>
  )
}
