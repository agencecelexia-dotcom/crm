import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Search, FolderKanban, ChevronRight, Phone, BadgeCheck, Clock, Trash2, AlertCircle, X, LockKeyhole, MoreHorizontal, List, Columns3, SlidersHorizontal } from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { Box, Mic, RotateCcw, UserCheck } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { StatutBadge } from '@/components/statut-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAuth } from '@/lib/auth/use-auth'
import { useDroits } from '@/lib/auth/use-droits'
import { METIERS, relegueEnBas, STATUTS, STATUTS_ORDRE } from '@/lib/constants'
import { formatEuros, formatDate, formatTel } from '@/lib/format'
import { useProjets, useRepreneurs } from '../hooks/use-projets'
import { useAffectationsCounts } from '../hooks/use-affectations'
import { BadgePerduPar } from '../components/badge-perdu-par'
import { useArtisansSignes } from '@/features/contrats/use-contrats'
import { QuickProspectDialog } from '../components/quick-prospect-dialog'
import { KanbanProjets } from '../components/kanban-projets'

// Liste des projets : recherche + filtres statut / métier / ville.
export function ProjetsListPage() {
  const { data: projets, isLoading, isError, refetch } = useProjets()
  const [filtresOuverts, setFiltresOuverts] = useState(false)
  const { data: repreneurs } = useRepreneurs()
  // Masquer plutôt que laisser échouer : la RLS (0112) refuserait l'insertion,
  // mais après que la personne a rempli tout le formulaire.
  const { peutCreerLead } = useDroits()
  const { session } = useAuth()
  const { data: artisansSignes } = useArtisansSignes()
  const { data: affectationsCounts } = useAffectationsCounts()
  // Filtres conservés dans l'URL (?q=…&statut=…&metier=…&tri=…&vue=…) : ils
  // survivent au bouton « retour » du navigateur et sont partageables/favoris.
  const [params, setParams] = useSearchParams()
  const recherche = params.get('q') ?? ''
  const statut = params.get('statut') ?? 'tous'
  const metier = params.get('metier') ?? 'tous'
  const tri = params.get('tri') ?? 'recent'
  const vue = params.get('vue') === 'pipeline' ? 'pipeline' : 'liste'

  // Met à jour un paramètre (valeur par défaut → on le retire pour garder l'URL propre).
  function setParam(cle: string, valeur: string, defaut: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!valeur || valeur === defaut) next.delete(cle)
        else next.set(cle, valeur)
        return next
      },
      { replace: true },
    )
  }
  const setRecherche = (v: string) => setParam('q', v, '')
  const setStatut = (v: string) => setParam('statut', v, 'tous')
  const setMetier = (v: string) => setParam('metier', v, 'tous')
  const setTri = (v: string) => setParam('tri', v, 'recent')
  const setVue = (v: string) => setParam('vue', v, 'liste')
  // Le pipe d'origine : c'est LA distinction économique du CRM. Le commercial
  // n'est commissionné que sur « reprise » ; confondre les deux lui ferait
  // travailler des dossiers qui ne lui rapportent rien.
  const pipe = params.get('pipe') ?? 'tous'
  const aAttribuer = params.get('file') === 'attribution'
  const setPipe = (v: string) => setParam('pipe', v, 'tous')

  const filtresActifs = Boolean(recherche || statut !== 'tous' || metier !== 'tous' || pipe !== 'tous' || aAttribuer)
  function reinitialiser() {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const key of ['q', 'statut', 'metier', 'pipe', 'file']) next.delete(key)
      return next
    }, { replace: true })
  }

  // Filet de sécurité : on garde les derniers filtres en sessionStorage. Si on
  // revient sur une liste « nue » (flèche logiciel, menu, retour navigateur qui
  // perd la query…), on les ré-applique automatiquement.
  const stockageFiltres = `projets-filtres:${session?.user.id ?? 'sans-session'}`
  const restaure = useRef(false)
  useEffect(() => {
    if (restaure.current) return
    restaure.current = true
    if (params.toString() === '') {
      try {
        const saved = sessionStorage.getItem(stockageFiltres)
        if (saved) setParams(new URLSearchParams(saved), { replace: true })
      } catch { /* Les filtres URL fonctionnent même si le stockage est bloqué. */ }
    }
  }, [params, setParams, stockageFiltres])
  useEffect(() => {
    try { sessionStorage.setItem(stockageFiltres, params.toString()) } catch { /* Stockage facultatif. */ }
  }, [params, stockageFiltres])

  // Recherche + métier (communs aux 2 vues)
  const base = useMemo(() => {
    if (!projets) return []
    const q = recherche.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '') // pour la recherche par numéro
    return projets.filter((p) => {
      const matchPipe = pipe === 'tous' || p.origine === pipe
      // Même périmètre que a_traiter(), migration 0173.
      const matchAttribution = !aAttribuer || (p.origine === 'neuf' && !['mort', 'devis_signe', 'termine', 'artisan_demarche', 'demarchage'].includes(p.statut))
      const matchMetier = metier === 'tous' || p.metiers.includes(metier)
      const telDigits = (p.client_telephone ?? '').replace(/\D/g, '')
      const matchTel = qDigits.length >= 2 && telDigits.includes(qDigits)
      const matchTexte =
        !q ||
        matchTel ||
        [p.client_nom, p.client_ville, p.metiers.join(' '), p.artisan?.societe, p.artisan?.nom]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))
      return matchAttribution && matchPipe && matchMetier && matchTexte
    })
  }, [projets, recherche, metier, pipe, aAttribuer])

  // Vue liste : on applique aussi le filtre statut, puis le tri choisi.
  const resultats = useMemo(() => {
    const filtres = base.filter((p) => statut === 'tous' || p.statut === statut)
    const rangStatut = (s: string) => {
      const i = STATUTS_ORDRE.indexOf(s as (typeof STATUTS_ORDRE)[number])
      return i === -1 ? 99 : i
    }
    const dateDesc = (a: (typeof filtres)[number], b: (typeof filtres)[number]) =>
      b.created_at.localeCompare(a.created_at)
    const arr = [...filtres]
    if (tri === 'statut') {
      // Regroupe par statut (ordre du pipeline), puis par date
      arr.sort((a, b) => rangStatut(a.statut) - rangStatut(b.statut) || dateDesc(a, b))
    } else if (tri === 'a_signer') {
      // D'abord les projets dont l'artisan assigné n'a PAS signé son contrat
      const aSigner = (p: (typeof filtres)[number]) =>
        p.artisan_id && !artisansSignes?.has(p.artisan_id) ? 0 : 1
      arr.sort((a, b) => aSigner(a) - aSigner(b) || dateDesc(a, b))
    } else if (tri === 'gros') {
      // Plus gros projets d'abord (estimation interne décroissante, sans estim. en dernier)
      const estim = (p: (typeof filtres)[number]) => p.estimation_interne ?? -1
      arr.sort((a, b) => estim(b) - estim(a) || dateDesc(a, b))
    }
    // 'recent' : on garde l'ordre d'origine (déjà du plus récent au plus ancien)

    // Les fiches hors pipeline (artisan démarché) passent TOUJOURS en dernier,
    // quel que soit le tri. Ce ne sont pas des prospects : les laisser remonter
    // avec les leads récents pollue la liste qu'on ouvre pour savoir qui
    // rappeler. Elles restent visibles — donc retrouvables — mais en bas.
    // Sauf si on a explicitement filtré sur ce statut, auquel cas c'est
    // précisément ce qu'on cherche.
    // Sauf si on a filtré explicitement dessus : c'est alors ce qu'on cherche.
    if (!relegueEnBas(statut)) {
      // Morts, artisans démarchés et démarchage passent en dernier, quel que
      // soit le tri : on ouvre cette liste pour savoir qui rappeler.
      arr.sort((a, b) => Number(relegueEnBas(a.statut)) - Number(relegueEnBas(b.statut)))
    }
    return arr
  }, [base, statut, tri, artisansSignes])

  return (
    <div>
      <PageHeader
        titre="Projets"
        sousTitre="Les dossiers clients, de la première demande au chantier signé"
        action={
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 gap-2 bg-card" aria-label="Actions des projets">
                  <MoreHorizontal className="size-4" aria-hidden /> Actions
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 rounded-[10px] p-1.5" aria-label="Actions des projets">
                <nav className="grid text-sm" aria-label="Outils des projets">
                  <Link to="/projets/a-reattribuer" className="flex min-h-10 items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"><RotateCcw className="size-4 text-muted-foreground" />À réattribuer</Link>
                  <Link to="/maison-3d" className="flex min-h-10 items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"><Box className="size-4 text-muted-foreground" />Maison 3D</Link>
                  {peutCreerLead && <Link to="/appel" className="flex min-h-10 items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"><Mic className="size-4 text-muted-foreground" />Prendre un appel</Link>}
                  <div className="my-1 border-t border-border" />
                  <Link to="/projets/corbeille" className="flex min-h-10 items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"><Trash2 className="size-4 text-muted-foreground" />Corbeille</Link>
                </nav>
              </PopoverContent>
            </Popover>
            {peutCreerLead && <div className="[&>button]:h-10 [&>button]:px-4"><QuickProspectDialog /></div>}
          </div>
        }
      />

      <section className="overflow-hidden rounded-[10px] border border-border bg-card" aria-label="Liste et filtres des projets">
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-full min-w-0 items-center gap-2 xl:w-auto xl:flex-1">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input className="h-10 bg-card pl-9" placeholder="Rechercher un client, une ville, un artisan…" aria-label="Rechercher un projet" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
              </div>
              <Button variant="outline" size="sm" className="h-10 gap-2 bg-card px-3 xl:hidden" aria-expanded={filtresOuverts} aria-controls="filtres-projets" onClick={() => setFiltresOuverts((ouvert) => !ouvert)}>
                <span className="relative"><SlidersHorizontal className="size-4" aria-hidden />{filtresActifs && <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary" aria-hidden />}</span>
                Filtres{filtresActifs && <span className="sr-only"> actifs</span>}
              </Button>
            </div>
            <Tabs value={vue} onValueChange={setVue}>
              <TabsList className="h-10 border border-border bg-muted/50" aria-label="Présentation des projets">
                <TabsTrigger value="liste" className="gap-2 px-3"><List className="size-4" aria-hidden />Liste</TabsTrigger>
                <TabsTrigger value="pipeline" className="gap-2 px-3"><Columns3 className="size-4" aria-hidden />Par étape</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div id="filtres-projets" className={`${filtresOuverts ? 'grid' : 'hidden'} grid-cols-1 gap-2 min-[400px]:grid-cols-2 xl:flex xl:flex-wrap xl:items-center`}>
            <div className="min-w-0 xl:w-48">
              <Select value={pipe} onValueChange={setPipe}>
                <SelectTrigger className="h-9 w-full bg-card" aria-label="Filtrer par origine"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous">Toutes les origines</SelectItem>
                  <SelectItem value="neuf">Nouveaux dossiers</SelectItem>
                  <SelectItem value="reprise">Issus d’une reprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {vue === 'liste' && <div className="min-w-0 xl:w-44">
              <Select value={statut} onValueChange={setStatut}>
                <SelectTrigger className="h-9 w-full bg-card" aria-label="Filtrer par statut"><SelectValue placeholder="Statut" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous">Tous statuts</SelectItem>
                  {STATUTS_ORDRE.map((s) => <SelectItem key={s} value={s}>{STATUTS[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>}
            <div className="min-w-0 xl:w-48">
              <Select value={metier} onValueChange={setMetier}>
                <SelectTrigger className="h-9 w-full bg-card" aria-label="Filtrer par métier"><SelectValue placeholder="Métier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous">Tous métiers</SelectItem>
                  {METIERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {vue === 'liste' && <div className="min-w-0 xl:w-60">
              <Select value={tri} onValueChange={setTri}>
                <SelectTrigger className="h-9 w-full bg-card" aria-label="Trier les projets"><SelectValue placeholder="Trier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Plus récents</SelectItem>
                  <SelectItem value="gros">Plus gros projets (€)</SelectItem>
                  <SelectItem value="statut">Par statut</SelectItem>
                  <SelectItem value="a_signer">Contrat à signer d’abord</SelectItem>
                </SelectContent>
              </Select>
            </div>}
            {filtresActifs && <Button variant="ghost" size="sm" className="justify-start px-2 text-muted-foreground xl:ml-auto" onClick={reinitialiser}><X className="size-3.5" aria-hidden />Effacer les filtres</Button>}
          </div>
        </div>

        {aAttribuer && <p className="border-b border-border bg-muted/30 px-5 py-3 text-xs text-muted-foreground">File d’attribution · nouveaux dossiers ouverts, hors projets clos et démarchage</p>}
        {!isLoading && !isError && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3 text-xs text-muted-foreground" role="status">
          <span><span className="font-medium tabular-nums text-foreground">{vue === 'liste' ? resultats.length : base.length}</span> projet{(vue === 'liste' ? resultats.length : base.length) > 1 ? 's' : ''}</span>
          {vue === 'liste' && resultats.length > 0 && <span className="flex items-center gap-1.5"><LockKeyhole className="size-3" aria-hidden />Potentiel estimé <span className="font-medium tabular-nums text-foreground">{formatEuros(resultats.reduce((s, p) => s + (p.estimation_interne ?? 0), 0))}</span></span>}
        </div>}

        {isLoading ? (
          <div className="divide-y divide-border" aria-label="Chargement des projets">{Array.from({ length: 5 }, (_, i) => <div key={i} className="px-5 py-5"><Skeleton className="h-10 w-full rounded-md" /></div>)}</div>
        ) : isError ? (
          <div className="p-4"><EmptyState icon={AlertCircle} titre="Impossible de charger les projets" description="La liste n’est pas disponible. Réessaie pour récupérer les dossiers." action={<Button variant="outline" onClick={() => void refetch()}>Réessayer</Button>} /></div>
        ) : (vue === 'pipeline' ? base.length : resultats.length) === 0 && filtresActifs ? (
          <div className="p-4"><EmptyState icon={Search} titre="Aucun résultat avec ces filtres" description="Modifie ta recherche ou efface les filtres pour retrouver tous les projets." action={<Button variant="outline" onClick={reinitialiser}>Effacer les filtres</Button>} /></div>
        ) : vue === 'pipeline' ? (
          <div className="p-4"><KanbanProjets projets={base} /></div>
        ) : resultats.length === 0 ? (
          <div className="p-4"><EmptyState icon={FolderKanban} titre="Aucun projet" description="Crée un projet pendant l'appel pour démarrer le suivi." action={peutCreerLead ? <Button asChild><Link to="/projets/new"><Plus className="size-4" />Nouveau projet</Link></Button> : undefined} /></div>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.15fr)_minmax(0,1fr)_16px] gap-5 border-b border-border bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground xl:grid" aria-hidden>
              <span>Client</span><span>Métier</span><span>Artisan</span><span>Avancement</span><span className="text-right">Montant · création</span><span />
            </div>
            <ul className="divide-y divide-border" aria-label="Projets">
              {resultats.map((p) => (
                <li key={p.id}>
                  <Link to={`/projets/${p.id}`} className="group grid grid-cols-2 items-start gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-muted/35 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:px-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.15fr)_minmax(0,1fr)_16px] xl:gap-5 xl:py-5">
                    <div className="col-span-2 min-w-0 xl:col-span-1">
                      <p className="break-words text-sm font-semibold leading-5">{p.client_nom}</p>
                      <p className="mt-1 break-words text-xs text-muted-foreground">{p.client_ville || 'Ville non renseignée'}</p>
                      {p.client_telephone && <p className="mt-2 flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground"><Phone className="size-3 shrink-0" aria-hidden /><span>{formatTel(p.client_telephone)}</span></p>}
                    </div>
                    <div className="min-w-0"><p className="mb-1 text-[11px] text-muted-foreground xl:sr-only">Métier</p><p className="break-words text-sm leading-5">{p.metiers.join(', ') || 'Métier à préciser'}</p></div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[11px] text-muted-foreground xl:sr-only">Artisan</p>
                      {p.artisan ? <>
                        <p className="break-words text-sm leading-5">{p.artisan.societe ?? p.artisan.nom}{(affectationsCounts?.[p.id]?.total ?? 0) > 1 && <span className="ml-1 text-xs text-muted-foreground">+{(affectationsCounts?.[p.id]?.total ?? 0) - 1}</span>}</p>
                        <p className="mt-1.5 flex items-start gap-1 text-xs text-muted-foreground">{artisansSignes?.has(p.artisan_id ?? '') ? <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-700" aria-hidden /> : <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />}<span>{artisansSignes?.has(p.artisan_id ?? '') ? 'Contrat signé' : 'Contrat à signer'}</span></p>
                      </> : <span className="text-sm text-muted-foreground">Non attribué</span>}
                      {p.assigne_a && repreneurs?.[p.assigne_a] && <p className="mt-2 flex items-start gap-1 text-xs text-muted-foreground"><UserCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span>Repris par {repreneurs[p.assigne_a]}</span></p>}
                    </div>
                    <div className="col-span-2 flex min-w-0 flex-wrap items-start gap-2 xl:col-span-1 xl:flex-col [&_[data-slot=badge]]:whitespace-normal [&_[data-slot=badge]]:text-left">
                      <StatutBadge statut={p.statut} />
                      <BadgePerduPar nb={affectationsCounts?.[p.id]?.perdus ?? 0} className="max-w-full shrink whitespace-normal rounded-md border-transparent bg-transparent px-0 font-normal" />
                    </div>
                    <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs xl:col-span-1 xl:block xl:border-0 xl:pt-0 xl:text-right">
                      <div>{p.montant_devis_signe != null && <p className="font-medium tabular-nums text-foreground">{formatEuros(p.montant_devis_signe)} <span className="font-normal text-muted-foreground">signés</span></p>}{p.estimation_interne != null && <p className="mt-1 tabular-nums text-muted-foreground">Est. {formatEuros(p.estimation_interne)}</p>}{p.montant_devis_signe == null && p.estimation_interne == null && <p className="text-muted-foreground">Non chiffré</p>}</div>
                      <p className="mt-1.5 tabular-nums text-muted-foreground"><span className="xl:sr-only">Créé le </span>{formatDate(p.created_at)}</p>
                    </div>
                    <ChevronRight className="hidden size-4 self-center text-muted-foreground/60 xl:block" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
