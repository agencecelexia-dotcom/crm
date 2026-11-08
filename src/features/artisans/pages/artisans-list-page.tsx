import { useMemo, useState } from 'react'
import { useDroits } from '@/lib/auth/use-droits'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Plus,
  AlertCircle,
  X,
  Search,
  Users,
  ChevronRight,
  Phone,
  BadgeCheck,
  BarChart3,
  ShieldOff,
  MapPinned,
  Star,
  MoreHorizontal,
  SlidersHorizontal,
} from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { METIERS } from '@/lib/constants'
import { formatTel } from '@/lib/format'
import { useArtisansSignes } from '@/features/contrats/use-contrats'
import { useArtisans } from '../hooks/use-artisans'
import { useStatsArtisans } from '../hooks/use-stats-artisans'
import { useDossiersEnvoyes } from '../hooks/use-dossiers-envoyes'
import { LienInscriptionButton } from '../components/lien-inscription-button'

type Vue = 'artisans' | 'partenaires'
type Tri = 'nom' | 'envoyes'

// Liste des artisans, en deux populations :
//  - « Artisans » : le statut général, sollicité ponctuellement ;
//  - « Partenaires » : ceux qui absorbent des dizaines de dossiers par mois.
// Le tri est fait ICI et nulle part ailleurs : `useArtisans()` alimente aussi
// la carte et le sélecteur d'attribution, où un partenaire doit rester présent.
export function ArtisansListPage() {
  const { data: artisans, isLoading, isError, refetch } = useArtisans()
  const [filtresOuverts, setFiltresOuverts] = useState(false)
  const { data: signes } = useArtisansSignes()
  const { data: stats } = useStatsArtisans()
  const { data: envoyes } = useDossiersEnvoyes()
  // Masquer plutôt que laisser échouer : la RLS refuse déjà l'insertion, mais
  // seulement après que la personne a rempli tout le formulaire.
  const { peutCreerArtisan } = useDroits()

  // L'onglet vit dans l'URL : le retour arrière depuis une fiche partenaire
  // ramène sur l'onglet Partenaires, et le lien se partage.
  const [params, setParams] = useSearchParams()
  const recherche = params.get('q') ?? ''
  const metier = params.get('metier') ?? 'tous'
  const source = params.get('source') ?? 'tous'
  const filtresActifs = Boolean(recherche || metier !== 'tous' || source !== 'tous')
  function setFiltre(cle: string, valeur: string, defaut: string) {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (!valeur || valeur === defaut) next.delete(cle)
      else next.set(cle, valeur)
      return next
    }, { replace: true })
  }
  function reinitialiser() {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const key of ['q', 'metier', 'source']) next.delete(key)
      return next
    }, { replace: true })
  }
  const vue: Vue = params.get('vue') === 'partenaires' ? 'partenaires' : 'artisans'
  function setVue(v: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v === 'partenaires') next.set('vue', v)
        else next.delete('vue')
        return next
      },
      { replace: true },
    )
  }
  // Le tri vit aussi dans l'URL : il survit au retour depuis une fiche.
  const tri: Tri = params.get('tri') === 'envoyes' ? 'envoyes' : 'nom'
  function setTri(t: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (t === 'envoyes') next.set('tri', t)
        else next.delete('tri')
        return next
      },
      { replace: true },
    )
  }

  // Chantiers en cours par artisan — déjà calculés en base par `stats_artisans`.
  const enCours = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of stats ?? []) m.set(s.id, s.en_cours)
    return m
  }, [stats])

  // Provenances présentes dans la base (null → 'agence').
  const sources = useMemo(() => {
    const set = new Set<string>()
    for (const a of artisans ?? []) set.add(a.source || 'agence')
    return [...set].sort()
  }, [artisans])
  const aDesAuto = sources.some((s) => s.startsWith('auto:'))

  // Filtres communs aux deux onglets. Le partage par population vient après :
  // les compteurs des onglets reflètent ainsi la recherche en cours.
  const filtres = useMemo(() => {
    if (!artisans) return []
    const q = recherche.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '') // pour la recherche par numéro
    return artisans.filter((a) => {
      const matchMetier = metier === 'tous' || a.metiers.includes(metier)
      const src = a.source || 'agence'
      const matchSource =
        source === 'tous' ||
        (source === 'auto' ? src.startsWith('auto:') : src === source)
      const telDigits = (a.telephone ?? '').replace(/\D/g, '')
      const matchTel = qDigits.length >= 2 && telDigits.includes(qDigits)
      const matchTexte =
        !q ||
        matchTel ||
        [a.nom, a.prenom, a.societe, a.ville]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q))
      return matchMetier && matchSource && matchTexte
    })
  }, [artisans, recherche, metier, source])

  const partenaires = useMemo(() => filtres.filter((a) => a.partenaire_at != null), [filtres])
  const classiques = useMemo(() => filtres.filter((a) => a.partenaire_at == null), [filtres])
  const parVue = vue === 'partenaires' ? partenaires : classiques
  // Du plus au moins de dossiers envoyés ; à égalité, l'ordre par nom de la liste
  // est gardé (le tri de JavaScript est stable).
  const resultats = useMemo(
    () =>
      tri === 'envoyes'
        ? [...parVue].sort((a, b) => (envoyes?.get(b.id) ?? 0) - (envoyes?.get(a.id) ?? 0))
        : parVue,
    [parVue, tri, envoyes],
  )

  const labelSource = (s: string) =>
    s === 'agence'
      ? "Ajoutés par l'agence"
      : s.startsWith('auto:')
        ? 'Lien — ' + (s.slice(5).charAt(0).toUpperCase() + s.slice(6))
        : s

  return (
    <div>
      <PageHeader
        titre="Artisans"
        sousTitre="L’annuaire de l’agence : contacts, spécialités et collaboration"
        action={
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild><Button variant="outline" className="h-10 gap-2 bg-card" aria-label="Actions des artisans"><MoreHorizontal className="size-4" aria-hidden />Actions</Button></PopoverTrigger>
              <PopoverContent align="end" className="w-64 rounded-[10px] p-1.5" aria-label="Actions des artisans">
                <nav className="grid text-sm" aria-label="Outils des artisans">
                  <Link to="/artisans/stats" className="flex min-h-10 items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"><BarChart3 className="size-4 text-muted-foreground" />Performance du réseau</Link>
                  <Link to="/artisans/zones" className="flex min-h-10 items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"><MapPinned className="size-4 text-muted-foreground" />Zones à vérifier</Link>
                  <Link to="/artisans/ecartes" className="flex min-h-10 items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"><ShieldOff className="size-4 text-muted-foreground" />Artisans écartés</Link>
                </nav>
              </PopoverContent>
            </Popover>
            {peutCreerArtisan && <LienInscriptionButton />}
            {peutCreerArtisan && <Button asChild className="h-10 px-4"><Link to="/artisans/new"><Plus className="size-4" aria-hidden />Nouvel artisan</Link></Button>}
          </div>
        }
      />

      <section className="overflow-hidden rounded-[10px] border border-border bg-card" aria-label="Annuaire et filtres des artisans">
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex w-full min-w-0 items-center gap-2 xl:w-auto xl:flex-1">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input className="h-10 bg-card pl-9" placeholder="Rechercher un nom, une société, une ville…" aria-label="Rechercher un artisan" value={recherche} onChange={(e) => setFiltre('q', e.target.value, '')} />
              </div>
              <Button variant="outline" size="sm" className="h-10 gap-2 bg-card px-3 xl:hidden" aria-expanded={filtresOuverts} aria-controls="filtres-artisans" onClick={() => setFiltresOuverts((ouvert) => !ouvert)}>
                <span className="relative"><SlidersHorizontal className="size-4" aria-hidden />{filtresActifs && <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary" aria-hidden />}</span>
                Filtres{filtresActifs && <span className="sr-only"> actifs</span>}
              </Button>
            </div>
            <Tabs value={vue} onValueChange={setVue}>
              <TabsList className="h-10 border border-border bg-muted/50" aria-label="Population des artisans">
                <TabsTrigger value="artisans" className="px-2 text-xs sm:px-3 sm:text-sm">Artisans{!isLoading && !isError && <span className="ml-1 text-xs tabular-nums text-muted-foreground">{classiques.length}</span>}</TabsTrigger>
                <TabsTrigger value="partenaires" className="gap-1.5 px-2 text-xs sm:gap-2 sm:px-3 sm:text-sm"><Star className="size-3.5" aria-hidden />Partenaires{!isLoading && !isError && <span className="text-xs tabular-nums text-muted-foreground">{partenaires.length}</span>}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div id="filtres-artisans" className={`${filtresOuverts ? 'grid' : 'hidden'} grid-cols-1 gap-2 min-[400px]:grid-cols-2 xl:flex xl:flex-wrap xl:items-center`}>
            <div className="min-w-0 xl:w-48">
              <Select value={metier} onValueChange={(v) => setFiltre('metier', v, 'tous')}>
                <SelectTrigger className="h-9 w-full bg-card" aria-label="Filtrer par métier"><SelectValue placeholder="Métier" /></SelectTrigger>
                <SelectContent><SelectItem value="tous">Tous les métiers</SelectItem>{METIERS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-0 xl:w-52">
              <Select value={source} onValueChange={(v) => setFiltre('source', v, 'tous')}>
                <SelectTrigger className="h-9 w-full bg-card" aria-label="Filtrer par provenance"><SelectValue placeholder="Provenance" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tous">Toutes provenances</SelectItem>
                  {aDesAuto && <SelectItem value="auto">Tous auto-inscrits (lien)</SelectItem>}
                  {sources.map((s) => <SelectItem key={s} value={s}>{labelSource(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 xl:w-56">
              <Select value={tri} onValueChange={setTri}>
                <SelectTrigger className="h-9 w-full bg-card" aria-label="Trier les artisans"><SelectValue placeholder="Trier par" /></SelectTrigger>
                <SelectContent><SelectItem value="nom">Par nom</SelectItem><SelectItem value="envoyes">Dossiers envoyés décroissants</SelectItem></SelectContent>
              </Select>
            </div>
            {filtresActifs && <Button variant="ghost" size="sm" className="justify-start px-2 text-muted-foreground xl:ml-auto" onClick={reinitialiser}><X className="size-3.5" aria-hidden />Effacer les filtres</Button>}
          </div>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3 text-xs text-muted-foreground">
          <p>{vue === 'partenaires' ? 'Partenaires réguliers · collaboration récurrente' : 'Artisans · interventions ponctuelles'}</p>
          {!isLoading && !isError && <p role="status"><span className="font-medium tabular-nums text-foreground">{resultats.length}</span> contact{resultats.length > 1 ? 's' : ''}</p>}
        </div>

        {isLoading ? (
          <div className="divide-y divide-border" aria-label="Chargement des artisans">{Array.from({ length: 5 }, (_, i) => <div key={i} className="px-5 py-5"><Skeleton className="h-10 w-full rounded-md" /></div>)}</div>
        ) : isError ? (
          <div className="p-4"><EmptyState icon={AlertCircle} titre="Impossible de charger les artisans" description="Le réseau n’est pas disponible. Réessaie pour retrouver les fiches." action={<Button variant="outline" onClick={() => void refetch()}>Réessayer</Button>} /></div>
        ) : resultats.length === 0 && filtresActifs ? (
          <div className="p-4"><EmptyState icon={Search} titre="Aucun résultat avec ces filtres" description="Modifie ta recherche ou efface les filtres pour retrouver les artisans de cet onglet." action={<Button variant="outline" onClick={reinitialiser}>Effacer les filtres</Button>} /></div>
        ) : resultats.length === 0 ? (
          <div className="p-4">{vue === 'partenaires' ? <EmptyState icon={Star} titre="Aucun partenaire" description="Ouvre la fiche d’un artisan et choisis « Passer en partenaire » pour le classer ici." /> : <EmptyState icon={Users} titre="Aucun artisan" description="Ajoute ton premier artisan pour commencer à enrichir la base." action={peutCreerArtisan ? <Button asChild><Link to="/artisans/new"><Plus className="size-4" />Nouvel artisan</Link></Button> : undefined} />}</div>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1.75fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,1fr)_16px] gap-5 border-b border-border bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground xl:grid" aria-hidden>
              <span>Artisan · société</span><span>Spécialités</span><span>Localisation</span><span>Dossiers envoyés</span><span>Contrat</span><span />
            </div>
            <ul className="divide-y divide-border" aria-label="Annuaire des artisans">
              {resultats.map((a) => (
                <li key={a.id}>
                  <Link to={`/artisans/${a.id}`} className="group grid grid-cols-2 items-start gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-muted/35 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:px-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,1fr)_16px] xl:gap-5 xl:py-5">
                    <div className="col-span-2 flex min-w-0 items-start gap-3 xl:col-span-1">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-xs font-medium text-muted-foreground" aria-hidden>{[a.prenom, a.nom].filter(Boolean).map((n) => n?.charAt(0)).join('').slice(0, 2).toUpperCase()}</span>
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold leading-5">{[a.prenom, a.nom].filter(Boolean).join(' ')}</p>
                        {a.societe && <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{a.societe}</p>}
                        {a.telephone && <p className="mt-2 flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground"><Phone className="size-3 shrink-0" aria-hidden /><span>{formatTel(a.telephone)}</span></p>}
                      </div>
                    </div>
                    <div className="col-span-2 min-w-0 xl:col-span-1">
                      <p className="mb-1 text-[11px] text-muted-foreground xl:sr-only">Spécialités</p>
                      <p className="break-words text-sm leading-5">{a.metiers.length ? a.metiers.join(' · ') : 'Métier non renseigné'}</p>
                      {a.partenaire_at && <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Star className="size-3" aria-hidden />Partenaire régulier</p>}
                    </div>
                    <div className="min-w-0"><p className="mb-1 text-[11px] text-muted-foreground xl:sr-only">Localisation</p><p className="break-words text-sm leading-5">{a.ville || 'Ville non renseignée'}</p></div>
                    <div className="min-w-0"><p className="mb-1 text-[11px] text-muted-foreground xl:sr-only">Dossiers envoyés</p><p className="text-sm font-medium tabular-nums">{envoyes ? (envoyes.get(a.id) ?? 0) : '…'}<span className="ml-1 font-normal text-muted-foreground xl:sr-only">envoyé{(envoyes?.get(a.id) ?? 0) > 1 ? 's' : ''}</span></p>{a.partenaire_at && enCours.has(a.id) && <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">{enCours.get(a.id)} en cours</p>}</div>
                    <div className="col-span-2 min-w-0 border-t border-border/70 pt-3 xl:col-span-1 xl:border-0 xl:pt-0">
                      <p className="flex items-center gap-1.5 text-xs">{signes?.has(a.id) ? <><BadgeCheck className="size-4 shrink-0 text-emerald-700" aria-hidden /><span>Contrat signé</span></> : <><span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden /><span className="text-muted-foreground">{signes ? 'Contrat non signé' : 'Contrat à vérifier'}</span></>}</p>
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
