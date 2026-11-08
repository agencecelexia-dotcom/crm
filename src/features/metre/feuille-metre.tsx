import { lazy, Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  Box,
  Check,
  Crosshair,
  Layers,
  Loader2,
  MapPin,
  Mountain,
  Pencil,
  Ruler,
  Search,
  Undo2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { batimentsAutour, type Batiment } from './bati-ign'
import { PanneauBatiment, type MesureAEnregistrer } from './panneau-batiment'
import { CarteMetre, type FondCarte, type ModeCarte } from './carte-metre'
import {
  aire,
  centre as centreContour,
  formatM,
  formatM2,
  longueur,
  type Facade,
  type Point,
} from './geometrie'
import { useQuery } from '@tanstack/react-query'
import {
  chercherAdresse,
  messageMetre,
  useContexteMetre,
  useCorrigerPosition,
  useEnregistrerMetre,
  useSupprimerMetre,
  useModifierTrace,
  type Adresse,
  type Metre,
} from './use-metres'
import { situerChantier } from './position'
import { CarnetTrace } from './carnet-trace'
import { traceManuelAffichable, traceModifie } from './edition-trace'
import { BandeauMaison } from './bandeau-maison'
import { vueDuChantier } from './vue-par-metier'
import { PanneauCloture } from './panneau-cloture'
import { facadeRetenue, releveUtilisable, useReleve } from './use-releve'
import { ecartesParDefaut, facadeDuReleve } from './affichage-releve'
import { FicheFace3D } from './fiche-face-3d'
import { modeleDuReleve, type Face3D } from './modele3d'
import { PanneauMetreIA } from './metre-ia-panneau'
import { useMetreIA } from './use-metre-ia'
import { photoDeLaFacade } from './ouvertures'
import { useMateriauxToit, usePhotosFacade } from './use-photos-facade'
import type { OutilsVue3D } from './vue-3d'
import { parcelleSous, troncons } from './parcelle'
import {
  maisonDeLAdresse,
  useMaisonChantier,
  useRetenirMaison,
  type MaisonChantier,
} from './use-batiment-chantier'

// La 3D (Three.js, ~150 Ko) ne se charge qu'à l'ouverture de la vue.
const Vue3D = lazy(() => import('./vue-3d'))

/**
 * Prendre un métré sans se déplacer.
 *
 * Le parcours tient en un geste dans le cas courant : la carte s'ouvre cadrée
 * sur le chantier, le bâtiment est déjà tracé par l'IGN, l'artisan le touche et
 * lit ses mesures. Le dessin n'est qu'un recours — pour un terrain, une
 * terrasse, une clôture.
 */
export function FeuilleMetre({
  token,
  affectationToken,
  titre,
  onClose,
  verifierFermeture,
}: {
  token: string
  affectationToken: string
  titre?: string | null
  onClose: () => void
  verifierFermeture?: RefObject<() => boolean>
}) {
  function fermerFeuille() {
    if (!verifierFermeture && !quitterTrace()) return
    onClose()
  }

  const contexte = useContexteMetre(token, affectationToken)
  const ctx = contexte.data
  const enregistrer = useEnregistrerMetre(token)
  const supprimer = useSupprimerMetre(token)
  const modifierTrace = useModifierTrace(token)
  const corriger = useCorrigerPosition(token)

  const [fond, setFond] = useState<FondCarte>('ortho')
  const [cadastre, setCadastre] = useState(false)
  const [mode, setMode] = useState<ModeCarte>('apercu')
  const [trace, setTrace] = useState<Point[]>([])
  const [traceOuvert, setTraceOuvert] = useState<Metre | null>(null)
  const [editionTrace, setEditionTrace] = useState(false)
  const [sommetADeplacer, setSommetADeplacer] = useState<number | null>(null)
  const [batiments, setBatiments] = useState<Batiment[]>([])
  // Le choix de l'artisan : un bâtiment touché, ou « aucun » quand il a écarté
  // la maison proposée. Tant qu'il n'a rien choisi, c'est la maison du
  // chantier qui est sélectionnée.
  const [choix, setChoix] = useState<Batiment | 'aucun' | null>(null)
  // La façade en cours de chiffrage, surlignée sur la carte.
  const [murChoisi, setMurChoisi] = useState<Facade | null>(null)
  const [nom, setNom] = useState('')
  const panneau = useRef<HTMLDivElement | null>(null)
  const [recherche, setRecherche] = useState('')
  const [resultats, setResultats] = useState<Adresse[]>([])
  const [etatRecherche, setEtatRecherche] = useState<'repos' | 'chargement' | 'erreur' | 'vide'>('repos')
  const [essaiRecherche, setEssaiRecherche] = useState(0)
  const [chercheOuverte, setChercheOuverte] = useState(false)
  const centreCarte = useRef<Point | null>(null)

  // QUELLE EST LA MAISON ? Le serveur la désigne : le Référentiel national des
  // bâtiments relie officiellement l'adresse à son bâtiment. L'ancienne règle
  // — le bâtiment dont le centre est le plus proche du point d'adresse —
  // prenait la maison d'en face dès que le point tombait sur la chaussée.
  const maisonServeur = useMaisonChantier(token, affectationToken, !!ctx?.ok)
  const vue = vueDuChantier(ctx?.metiers?.length ? ctx.metiers : [ctx?.metier])
  const retenir = useRetenirMaison(token, affectationToken)
  // Une adresse cherchée à la main, et la maison trouvée à cette adresse.
  const [manuelle, setManuelle] = useState<{
    point: Point
    maison: MaisonChantier | null
    enCours: boolean
  } | null>(null)
  // La maison confirmée pendant cette visite, par « Oui » ou par une mesure.
  const [retenue, setRetenue] = useState<string | null>(null)

  const maison = manuelle ? manuelle.maison : (maisonServeur.data ?? null)
  // Serveur injoignable : on lit l'adresse dans le navigateur, pour cadrer la
  // carte — mais sans rien présélectionner.
  const secours = !manuelle && maisonServeur.isError
  const { data: situation } = useQuery({
    // La position fait partie de la clé : après « Le chantier est ici », le
    // bandeau d'alerte restait affiché toute la session, faute de recalcul.
    queryKey: ['situer', ctx?.projet_id, ctx?.client_adresse, ctx?.client_ville, ctx?.latitude, ctx?.longitude],
    enabled: !!ctx?.ok && secours,
    staleTime: 1000 * 60 * 30,
    queryFn: ({ signal }) =>
      situerChantier(
        {
          adresse: ctx?.client_adresse,
          codePostal: ctx?.client_code_postal,
          ville: ctx?.client_ville,
          latitude: ctx?.latitude,
          longitude: ctx?.longitude,
        },
        signal,
      ),
  })

  // La carte se centre sur LA MAISON — pas sur le point d'adresse, qui tombe
  // souvent dans la rue, à vingt ou trente mètres.
  const surMaison = maison?.principal ? centreContour(maison.principal.contour) : null
  const cadre: Point | null =
    surMaison ?? maison?.point ?? manuelle?.point ?? (secours ? (situation?.point ?? null) : null)
  // Les coordonnées vivent en SCALAIRES, pas en tableau : un tableau est
  // recréé à chaque rendu, et l'effet qui charge le bâti se relançait alors
  // sans fin — des centaines d'appels à l'IGN pour une seule ouverture.
  const lon = cadre?.[0] ?? null
  const lat = cadre?.[1] ?? null
  const centre: Point | null = lon != null && lat != null ? [lon, lat] : null
  const cible = maison?.principal?.cleabs ?? null
  // 19 quand on sait quelle maison c'est ; 18 sinon, pour montrer le
  // voisinage : à 19 l'écran ne couvre que 82 m.
  const zoom = cible ? 19 : 18
  const enRecherche = manuelle ? manuelle.enCours : maisonServeur.isLoading

  useEffect(() => {
    if (lon == null || lat == null) return
    const ctrl = new AbortController()
    void (async () => {
      let bats = await batimentsAutour(lat, lon, 150, ctrl.signal)
      // En ville, deux cents bâtiments ne couvrent pas toujours la fenêtre :
      // la maison désignée doit y être, on la cherche au plus près.
      if (cible && !bats.some((b) => b.cleabs === cible)) {
        const pres = await batimentsAutour(lat, lon, 30, ctrl.signal).catch(() => [])
        bats = [...bats, ...pres.filter((p) => !bats.some((b) => b.id === p.id))]
      }
      setBatiments(bats)
    })().catch(() => undefined)
    return () => ctrl.abort()
  }, [lon, lat, cible])

  // La maison du chantier est sélectionnée d'office : l'artisan ouvre l'écran
  // et lit ses mesures sans rien toucher. C'est tout l'objet de l'outil.
  const preselection = useMemo(
    () => (cible ? (batiments.find((b) => b.cleabs === cible) ?? null) : null),
    [batiments, cible],
  )
  const choisi = choix === 'aucun' ? null : (choix ?? preselection)
  // Le relevé LiDAR de la maison choisie, pour la carte : même requête que le
  // panneau (le cache la partage), et les pans que l'artisan y écarte.
  const { data: repReleve } = useReleve(token, choisi?.cleabs ?? null, choisi?.centre ?? null)
  const releveCarte = releveUtilisable(repReleve?.releve) ? repReleve!.releve! : null

  // LA MAISON EN 3D : tirée du relevé (version 5 : plans des pans, sol des
  // murs), avec les ouvertures lues sur les photos de ses façades.
  const [vue3d, setVue3d] = useState(false)
  // Une fois ouverte, la vue 3D reste montée (cachée sous la carte) : son image va au rapport.
  const [vu3d, setVu3d] = useState(false)
  const [pret3d, setPret3d] = useState(false)
  if (vue3d && !vu3d) setVu3d(true)
  const [faceChoisie, setFaceChoisie] = useState<Face3D | null>(null)
  // Une autre maison : la face touchée sur la précédente ne vaut plus.
  const [faceDe, setFaceDe] = useState(choisi?.cleabs ?? null)
  if (faceDe !== (choisi?.cleabs ?? null)) {
    setFaceDe(choisi?.cleabs ?? null)
    setFaceChoisie(null)
  }
  const outils3d = useRef<OutilsVue3D | null>(null)
  const modelable = !!releveCarte?.origine && releveCarte.pans.every((p) => p.plan)
  const { data: photos3d } = usePhotosFacade(token, choisi?.cleabs ?? null, vue3d && modelable)
  const { data: materiaux } = useMateriauxToit(token, choisi?.cleabs ?? null, vue3d && modelable)
  // « Mesurer avec l'IA » : ce que l'IA a compris de la maison choisie (terrasses, escaliers…).
  const ia = useMetreIA(token, choisi?.cleabs ?? null, choisi?.centre ?? null)
  const relirePhotosIA = ia.refaire
  // À la fin de la lecture par l'IA, la maison s'affiche en 3D d'elle-même.
  const iaEtaitEnCours = useRef(false)
  useEffect(() => {
    if (ia.statut === 'en_cours') iaEtaitEnCours.current = true
    if (ia.statut === 'fait') {
      relirePhotosIA()
      if (iaEtaitEnCours.current) {
        iaEtaitEnCours.current = false
        setVue3d(true)
      }
    }
  }, [ia.statut, relirePhotosIA])
  const donneesIA = ia.etat.data
  const lectureIA = useMemo(
    () => (donneesIA?.statut === 'fait' && donneesIA.scene && donneesIA.niveaux ? { scene: donneesIA.scene, niveaux: donneesIA.niveaux } : null),
    [donneesIA],
  )
  const modele = useMemo(() => {
    if (!releveCarte || !modelable) return null
    // Par façade, la photo qui compte (celle de l'artisan d'abord), comme au panneau.
    const vues = [...new Set((photos3d ?? []).map((p) => p.orientation))]
      .map((o) => photoDeLaFacade(photos3d ?? [], o))
      .filter((p) => p?.lecture && p.lecture.resultat.motif !== 'autre_batiment')
      .map((p) => ({ orientation: p!.orientation, lecture: p!.lecture!.vision, photo: p!.id, ecartees: p!.ecartees }))
    return modeleDuReleve(releveCarte, vues, lectureIA)
  }, [releveCarte, modelable, photos3d, lectureIA])
  // La feuille s'ouvre sur la maison en 3D dès que son relevé est prêt : une
  // fois, pour la maison du chantier. Pas pour la clôture, qui vit sur la carte.
  const [auto3d, setAuto3d] = useState(false)
  if (!auto3d && modele && vue !== 'terrain') {
    setAuto3d(true)
    setVue3d(true)
  }
  // Toucher un mur le montre aussi sur la carte, comme depuis le panneau.
  function choisirFace(f: Face3D | null) {
    setFaceChoisie(f)
    if (f && f.type !== 'pan' && !f.complement && releveCarte) setMurChoisi(facadeDuReleve(f.orientation, facadeRetenue(releveCarte, f.orientation).murs))
  }
  const [ecartes, setEcartes] = useState<{ cleabs: string; pans: Set<number> } | null>(null)

  // Les autres bâtiments chargés : ils disent quels murs de la maison sont accolés.
  const voisins = useMemo(
    () => batiments.filter((b) => b.id !== choisi?.id).map((b) => b.contour),
    [batiments, choisi?.id],
  )

  // LA CLÔTURE : pour les métiers du terrain, la parcelle de la maison et ses
  // côtés à cocher. Les côtés cochés sont gardés par maison : changer de
  // maison ne reporte pas les choix de l'autre.
  const terrain = vue === 'terrain'
  const { data: parcelle, isLoading: parcelleEnCours, isError: parcelleErreur, refetch: rechargerParcelle } = useQuery({
    queryKey: ['parcelle', choisi?.id],
    enabled: terrain && !!choisi?.centre,
    staleTime: 1000 * 60 * 60,
    retry: 1,
    queryFn: ({ signal }) => parcelleSous(choisi!.centre!, signal),
  })
  const [cotesPar, setCotesPar] = useState<Record<string, number[]>>({})
  const cotesChoisis = useMemo(() => new Set(choisi ? (cotesPar[choisi.id] ?? []) : []), [cotesPar, choisi])
  function basculerCote(i: number) {
    if (!choisi) return
    setCotesPar((avant) => {
      const liste = avant[choisi.id] ?? []
      return { ...avant, [choisi.id]: liste.includes(i) ? liste.filter((x) => x !== i) : [...liste, i] }
    })
  }
  function enregistrerCloture() {
    if (!parcelle || !choisi) return
    const morceaux = troncons(parcelle, cotesChoisis)
    let restants = morceaux.length
    for (const t of morceaux) {
      enregistrer.mutate(
        {
          affectation_token: affectationToken,
          nom: `Clôture ${t.cotes.map((c) => c.orientation).join(', ')}`,
          type: 'longueur',
          geometrie: t.ligne,
          source: 'dessin',
        },
        {
          onSuccess: () => {
            restants--
            if (restants === 0) {
              toast.success('Clôture enregistrée', {
                description: formatM(morceaux.reduce((s, x) => s + x.cotes.reduce((a, c) => a + c.longueur, 0), 0)),
              })
              confirmerParLaMesure(choisi)
            }
          },
          onError: (e) =>
            toast.error('Clôture non enregistrée', { description: e instanceof Error ? e.message : undefined }),
        },
      )
    }
  }
  // La maison proposée attend un « Oui » : le bandeau offre déjà d'en choisir une autre.
  const aConfirmer =
    !!choisi?.cleabs && choisi.cleabs === cible && choisi.cleabs !== retenue && maison?.confiance === 'a_confirmer'

  /** Cette maison est celle du chantier : on la garde, pour l'agence et pour la suite. */
  function retenirMaison(b: Batiment, apres?: () => void) {
    if (!b.cleabs) return
    const cleabs = b.cleabs
    retenir.mutate(
      { cleabs, point: b.centre, contour: b.contour, aire: b.emprise },
      {
        onSuccess: () => {
          setRetenue(cleabs)
          apres?.()
        },
        onError: (e) =>
          apres &&
          toast.error('Maison non retenue', { description: e instanceof Error ? e.message : undefined }),
      },
    )
  }

  /** Une mesure prise sur une maison vaut confirmation que c'est la bonne. */
  function confirmerParLaMesure(b: Batiment) {
    if (!b.cleabs || b.cleabs === retenue) return
    if (!manuelle && b.cleabs === cible && maison?.confiance === 'confirmee') return
    retenirMaison(b)
  }

  function allerA(a: Adresse) {
    // Sans remise à zéro, l'emprise, la pente et l'alerte ABF de l'ancien
    // bâtiment restaient à l'écran.
    setTrace([])
    setMurChoisi(null)
    setMode('apercu')
    setNom('')
    setChoix(null)
    setChercheOuverte(false)
    setRecherche('')
    const point: Point = [a.lon, a.lat]
    const enCours = a.precise && !!a.id
    setManuelle({ point, maison: null, enCours })
    if (!enCours) return
    const suite = (m: MaisonChantier | null) =>
      setManuelle((x) => (x?.point === point ? { point, maison: m, enCours: false } : x))
    maisonDeLAdresse(token, affectationToken, a).then(suite, () => suite(null))
  }

  useEffect(() => {
    const q = recherche.trim()
    const ctrl = new AbortController()
    // Tout passe par le délai, y compris l'effacement : écrire l'état
    // directement dans l'effet déclencherait un rendu en cascade.
    const t = setTimeout(() => {
      if (q.length < 3) { setResultats([]); setEtatRecherche('repos'); return }
      setResultats([])
      setEtatRecherche('chargement')
      void chercherAdresse(q, ctrl.signal).then((adresses) => {
        if (ctrl.signal.aborted) return
        setResultats(adresses)
        setEtatRecherche(adresses.length ? 'repos' : 'vide')
      }).catch(() => {
        if (!ctrl.signal.aborted) setEtatRecherche('erreur')
      })
    }, 300)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [recherche, essaiRecherche])

  // Le tracé à main levée — le recours, quand il n'y a pas de bâtiment : un
  // terrain, une terrasse, une clôture.
  const dessin = useMemo(() => {
    if (trace.length < 2) return null
    const estSurface = mode === 'surface' && trace.length >= 3
    return {
      surface: estSurface ? aire(trace) : null,
      perimetre: estSurface ? longueur(trace, true) : null,
      longueur: estSurface ? null : longueur(trace, false),
    }
  }, [trace, mode])

  function recommencer() {
    if (!quitterTrace()) return
    setTraceOuvert(null)
    setEditionTrace(false)
    setSommetADeplacer(null)
    setTrace([])
    setChoix('aucun')
    setMurChoisi(null)
    setMode('apercu')
    setNom('')
  }

  function quitterTrace() {
    if (modifierTrace.isPending) return false
    return !editionTrace || !traceModifie(traceOuvert, nom, trace) || window.confirm('Quitter sans enregistrer les modifications de ce tracé ?')
  }

  function voirTrace(m: Metre) {
    if (!quitterTrace()) return
    if (!traceOuvert && trace.length && !window.confirm('Remplacer le dessin en cours par ce tracé enregistré ?')) return
    setTraceOuvert(m)
    setEditionTrace(false)
    setSommetADeplacer(null)
    setTrace(m.geometrie.map((p) => [...p] as Point))
    setNom(m.nom)
    setChoix('aucun')
    setMurChoisi(null)
    setVue3d(false)
    setMode(m.type === 'surface' ? 'surface' : 'longueur')
    modifierTrace.reset()
    panneau.current?.scrollTo({ top: 0 })
  }

  function poserPoint(p: Point) {
    if (traceOuvert && (!editionTrace || modifierTrace.isPending)) return
    setTrace((t) => sommetADeplacer == null ? [...t, p] : t.map((s, i) => i === sommetADeplacer ? p : s))
    setSommetADeplacer(null)
  }

  useEffect(() => {
    if (!verifierFermeture) return
    verifierFermeture.current = quitterTrace
    return () => { verifierFermeture.current = () => true }
  })

  useEffect(() => {
    if (!editionTrace || !traceModifie(traceOuvert, nom, trace)) return
    const proteger = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', proteger)
    return () => window.removeEventListener('beforeunload', proteger)
  }, [editionTrace, traceOuvert, nom, trace])

  function garder(m: MesureAEnregistrer) {
    const surQuelle = choisi
    enregistrer.mutate(
      { affectation_token: affectationToken, source: 'bati', ...m },
      {
        onSuccess: (r) => {
          if (surQuelle) confirmerParLaMesure(surQuelle)
          // La surface RÉELLE quand elle existe : annoncer l'emprise au sol
          // après avoir affiché la toiture prêtait à confusion.
          const surface = r.surface_reelle_m2 ?? r.surface_m2
          toast.success('Métré enregistré', {
            description: surface != null ? formatM2(Number(surface)) : undefined,
          })
          // On RESTE sur la maison : l'artisan enchaîne souvent toit puis
          // façades. Tout réinitialiser l'obligeait à la re-toucher et à
          // refaire ses réglages.
        },
        onError: (e) =>
          toast.error('Mesure non enregistrée', {
            description: e instanceof Error ? e.message : undefined,
          }),
      },
    )
  }

  // Ne jamais transformer une panne ou un refus d'accès en carte vide.
  // Les hooks restent dans un ordre constant ; les outils ne sont montés
  // qu'une fois le contexte du chantier réellement disponible.
  if (contexte.isPending || contexte.isError || !ctx?.ok) {
    return (
      <Sheet open onOpenChange={(o) => !o && fermerFeuille()}>
        <SheetContent side="bottom" className="flex h-[95dvh] flex-col p-5 sm:p-8">
          <SheetHeader className="pr-8">
            <SheetTitle>{titre || 'Métré'}</SheetTitle>
            <SheetDescription>Les mesures de votre chantier</SheetDescription>
          </SheetHeader>
          <div className="m-auto w-full max-w-md space-y-4 text-center" role={contexte.isPending ? 'status' : 'alert'}>
            {contexte.isPending ? (
              <><Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" /><p>Chargement du chantier…</p></>
            ) : (
              <>
                <p className="font-medium">{contexte.isError ? 'Impossible de charger les mesures du chantier.' : messageMetre(ctx?.error)}</p>
                {contexte.isError && <p className="text-sm text-muted-foreground">Vérifiez votre connexion puis réessayez. Aucune donnée n’a été modifiée.</p>}
                <div className="flex flex-wrap justify-center gap-2">
                  {contexte.isError && <Button onClick={() => void contexte.refetch()} disabled={contexte.isFetching}>Réessayer</Button>}
                  <Button variant="outline" onClick={fermerFeuille}>Fermer</Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  // LA CLÉ N'EST PAS DÉCORATIVE. Sans elle, React réutilise le même panneau
  // d'un bâtiment à l'autre et garde son état : la pente saisie pour la maison
  // A restait affichée sur la maison B, ainsi que le débord, le mur choisi et
  // le versant retenu. Des chiffres justes sur la mauvaise maison — exactement
  // ce que l'audit avait trouvé ailleurs.
  const panneauMaison = choisi ? (
    <PanneauBatiment
      key={choisi.id}
      token={token}
      batiment={choisi}
      enCours={enregistrer.isPending}
      onEnregistrer={garder}
      onMurChoisi={setMurChoisi}
      onPansEcartes={(e) => choisi?.cleabs && setEcartes({ cleabs: choisi.cleabs, pans: e })}
      faceChoisie={faceChoisie}
      outils3d={pret3d ? outils3d : undefined}
      voisins={voisins}
      vue={vue}
      titre={titre}
      adresse={maison?.adresse_retrouvee ?? ctx?.client_adresse ?? null}
      affectationToken={affectationToken}
    />
  ) : null

  return (
    <Sheet open onOpenChange={(o) => !o && fermerFeuille()}>
      <SheetContent side="bottom" className="flex h-[95dvh] max-h-[95dvh] flex-col gap-0 p-0">
        <SheetHeader className="shrink-0 border-b border-border p-3">
          <SheetTitle className="truncate text-base">{titre || 'Métré'}</SheetTitle>
          <SheetDescription className="truncate text-xs">
            {ctx?.client_adresse || ctx?.client_ville || 'Cherchez l’adresse ci-dessous'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Carte et mesures restent visibles ensemble sur grand écran. */}
        <div className="relative min-h-0 min-w-0 flex-1">
          <CarteMetre
            centre={centre}
            zoom={zoom}
            fond={fond}
            cadastre={cadastre}
            mode={mode}
            batiments={batiments}
            batimentChoisi={choisi?.id ?? null}
            murChoisi={murChoisi}
            onChoisirBatiment={(b) => {
              setChoix(b)
              setNom(b.nature && b.nature !== 'Indifférenciée' ? b.nature : 'Bâtiment')
            }}
            trace={trace}
            traceCadre={traceOuvert?.geometrie}
            traceLectureSeule={!!traceOuvert && (!editionTrace || modifierTrace.isPending)}
            sommetChoisi={sommetADeplacer}
            onPoserSommet={poserPoint}
            onBouger={(p) => {
              centreCarte.current = p
            }}
            parcelle={terrain ? (parcelle ?? null) : null}
            cotesChoisis={cotesChoisis}
            onBasculerCote={basculerCote}
            releve={releveCarte}
            pansEcartes={ecartes?.cleabs === choisi?.cleabs ? ecartes?.pans : ecartesParDefaut(releveCarte)}
          />

          {/* La maison en 3D, par-dessus la carte (qui garde son état dessous). */}
          {vu3d && modele && (
            <div className={cn('absolute inset-0 z-[1000] bg-background', !vue3d && 'hidden')}>
              <Suspense
                fallback={
                  <div className="grid size-full place-items-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <Vue3D
                  modele={modele}
                  pansEcartes={ecartes?.cleabs === choisi?.cleabs ? ecartes?.pans : ecartesParDefaut(releveCarte)}
                  choisie={faceChoisie}
                  onChoisir={choisirFace}
                  onPret={(o) => {
                    outils3d.current = o
                    setPret3d(!!o)
                  }}
                />
              </Suspense>
              {vue3d && faceChoisie && releveCarte && (
                <FicheFace3D
                  // La face telle que le modèle la montre maintenant (une ouverture retirée change).
                  face={modele.faces.find((f) => f.type === faceChoisie.type && f.ref === faceChoisie.ref) ?? faceChoisie}
                  releve={releveCarte}
                  photos={photos3d ?? []}
                  materiaux={materiaux ?? null}
                  token={token}
                  cleabs={choisi?.cleabs ?? null}
                  onFermer={() => setFaceChoisie(null)}
                />
              )}
            </div>
          )}

          {enRecherche && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] flex justify-center">
              <span className="flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs shadow-card">
                <Loader2 className="size-3.5 animate-spin" />
                On cherche la maison…
              </span>
            </div>
          )}

          {/* Mire de visée : elle désigne le point que « Recadrer » enregistrera. */}
          {((mode === 'apercu' && !choisi) || (traceOuvert && editionTrace)) && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 z-[400] -translate-x-1/2 -translate-y-1/2"
            >
              <Crosshair className="size-7 text-primary drop-shadow-[0_0_3px_rgba(255,255,255,.9)]" />
            </div>
          )}

          {/* Fonds de plan */}
          <div className="absolute right-2 top-2 z-[1010] flex flex-col gap-1.5">
            <Button
              size="icon"
              variant="secondary"
              className={cn('size-11 shadow-card', vue3d && modele && 'hidden')}
              aria-label={fond === 'plan' ? 'Passer à la photo' : 'Passer au plan'}
              onClick={() => setFond((f) => (f === 'plan' ? 'ortho' : 'plan'))}
            >
              <Layers className="size-4" />
            </Button>
            <Button
              size="icon"
              variant={cadastre ? 'default' : 'secondary'}
              className={cn('size-11 shadow-card', vue3d && modele && 'hidden')}
              aria-label="Limites de parcelle"
              onClick={() => setCadastre((c) => !c)}
            >
              <span className="text-[10px] font-bold">CAD</span>
            </Button>
            {/* Le relief LiDAR : les toits vus à la verticale, sans le penché
                de la photo — c'est sur lui que le relevé se vérifie. */}
            <Button
              size="icon"
              variant={fond === 'relief' ? 'default' : 'secondary'}
              className={cn('size-11 shadow-card', vue3d && modele && 'hidden')}
              aria-label="Relief des toits (LiDAR)"
              onClick={() => setFond((f) => (f === 'relief' ? 'ortho' : 'relief'))}
            >
              <Mountain className="size-4" />
            </Button>
            {/* La maison en 3D : dès que le relevé est prêt. */}
            {modele && (
              <Button
                size="icon"
                variant={vue3d ? 'default' : 'secondary'}
                className="size-11 shadow-card"
                aria-label={vue3d ? 'Revenir à la carte' : 'Voir la maison en 3D'}
                aria-pressed={vue3d}
                onClick={() => {
                  setVue3d((v) => !v)
                  setFaceChoisie(null)
                }}
              >
                <Box className="size-4" />
              </Button>
            )}
          </div>

          {/* Recherche d'adresse : le recours quand le chantier n'est pas
              géolocalisé. Décalée à gauche pour laisser les boutons de zoom de
              Leaflet, qui occupent le coin haut-gauche. */}
          <div className={cn('absolute left-14 right-14 top-2 z-[500]', (traceOuvert || (vue3d && modele)) && 'hidden')}>
            {chercheOuverte ? (
              <div className="space-y-1 rounded-xl bg-card p-2 shadow-card">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    className="h-9 pl-8"
                    placeholder="Adresse du chantier…"
                    aria-label="Rechercher une adresse"
                    value={recherche}
                    onChange={(e) => { setRecherche(e.target.value); setResultats([]); setEtatRecherche('repos') }}
                  />
                </div>
                {etatRecherche === 'chargement' && <p role="status" className="p-2 text-xs">Recherche en cours…</p>}
                {etatRecherche === 'vide' && <p role="status" className="p-2 text-xs">Aucune adresse trouvée. Précisez le numéro et la commune.</p>}
                {etatRecherche === 'erreur' && <div role="alert" className="space-y-1 p-2 text-xs"><p>La recherche d’adresse est indisponible.</p><Button variant="outline" size="sm" onClick={() => setEssaiRecherche((n) => n + 1)}>Réessayer la recherche</Button></div>}
                {resultats.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => allerA(a)}
                    className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs hover:bg-accent"
                  >
                    <MapPin
                      className={cn('size-3.5 shrink-0', a.precise ? 'text-primary' : 'text-muted-foreground')}
                    />
                    <span className="min-w-0 flex-1 truncate">{a.label}</span>
                    {!a.precise && <span className="shrink-0 text-muted-foreground">approx.</span>}
                  </button>
                ))}
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="shadow-card"
                onClick={() => setChercheOuverte(true)}
              >
                <Search className="size-4" />
                {cible ? 'Autre adresse' : 'Chercher l’adresse'}
              </Button>
            )}
          </div>
        </div>

        {/* Le panneau de mesure */}
        {/* Le panneau DÉFILE, et laisse au moins un tiers de l'écran à la carte :
            sans défilement, sur un téléphone, le bas du panneau — et le bouton
            d'enregistrement — sortait de l'écran sans qu'on puisse l'atteindre. */}
        <div
          ref={panneau}
          className={cn(
            'shrink-0 space-y-3 overflow-y-auto overscroll-contain border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:w-[460px] lg:max-h-none lg:border-l lg:border-t-0 lg:p-5',
            // En 3D, la maison prend plus de place : on la tourne, on la touche.
            vue3d && modele ? 'max-h-[42dvh]' : 'max-h-[62dvh]',
          )}
        >
          {/* Ce qu'on sait — ou pas — de l'endroit où l'on est. */}
          {secours && situation?.message && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-xl border p-2.5',
                situation.fiabilite === 'discordante'
                  ? 'border-destructive/40 bg-destructive/5'
                  : 'border-[#F59E0B]/30 bg-[#F59E0B]/5',
              )}
            >
              <MapPin
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  situation.fiabilite === 'discordante' ? 'text-destructive' : 'text-[#B45309]',
                )}
              />
              <p
                className={cn(
                  'text-xs',
                  situation.fiabilite === 'discordante' ? 'text-destructive' : 'text-[#B45309]',
                )}
              >
                {situation.message}
              </p>
            </div>
          )}
          {/* La maison : reliée à l'adresse, confirmée, ou « C'est bien elle ? ». */}
          {!traceOuvert && <BandeauMaison
            maison={maison}
            choisi={choisi}
            retenue={retenue}
            cherchee={!!manuelle}
            enCours={retenir.isPending}
            onOui={() => choisi && retenirMaison(choisi, () => toast.success('Maison confirmée'))}
            onAutre={recommencer}
          />}
          {traceOuvert ? <CarnetTrace
            metre={traceOuvert} edition={editionTrace} trace={trace} nom={nom} sommet={sommetADeplacer}
            enCours={modifierTrace.isPending} erreur={modifierTrace.isError ? modifierTrace.error.message : null}
            onNom={setNom} onTrace={setTrace} onSommet={setSommetADeplacer}
            onEdition={() => { setEditionTrace(true); modifierTrace.reset() }}
            onCentre={() => { if (centreCarte.current) poserPoint(centreCarte.current) }}
            onAnnuler={() => { setTrace(traceOuvert.geometrie.map((p) => [...p] as Point)); setNom(traceOuvert.nom); setEditionTrace(false); setSommetADeplacer(null); modifierTrace.reset() }}
            onFermer={recommencer}
            onSauver={() => modifierTrace.mutate({ affectationToken, initial: traceOuvert, nom, geometrie: trace }, {
              onSuccess: (m) => { setTraceOuvert(m); setTrace(m.geometrie); setNom(m.nom); setEditionTrace(false); setSommetADeplacer(null); toast.success('Tracé modifié') },
            })}
          /> : choisi ? (
            <>
              {!aConfirmer && (
                <button
                  type="button"
                  onClick={recommencer}
                  className="flex min-h-11 w-full items-center text-left text-xs text-muted-foreground underline underline-offset-2"
                >
                  Ce n’est pas le bon bâtiment — en choisir un autre
                </button>
              )}
            {/* Le poseur de clôture chiffre le TERRAIN : sa parcelle passe
                devant, la maison se replie. */}
            {terrain && (
              <PanneauCloture
                parcelle={parcelle}
                enCours={parcelleEnCours}
                erreur={parcelleErreur}
                reessayer={() => void rechargerParcelle()}
                adresse={maison && maison.confiance !== 'confirmee' ? maison.point : null}
                choisis={cotesChoisis}
                onBasculer={basculerCote}
                onEnregistrer={enregistrerCloture}
                enregistrement={enregistrer.isPending}
              />
            )}
            {terrain ? (
              <details className="rounded-xl border border-border px-3 py-2">
                <summary className="min-h-11 cursor-pointer select-none content-center text-sm font-medium">
                  La maison : toit, façades
                </summary>
                <div className="mt-2 space-y-3">{panneauMaison}</div>
              </details>
            ) : (
              panneauMaison
            )}
            </>
          ) : dessin ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Chiffre
                  titre={dessin.surface != null ? 'Surface' : 'Longueur'}
                  valeur={
                    dessin.surface != null
                      ? formatM2(dessin.surface)
                      : formatM(dessin.longueur ?? 0)
                  }
                  fort
                />
                {dessin.perimetre != null && (
                  <Chiffre titre="Périmètre" valeur={formatM(dessin.perimetre)} />
                )}
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setTrace((t) => t.slice(0, -1))}
              >
                <Undo2 className="size-4" />
                Défaire le dernier point
              </Button>
              <div className="flex gap-2">
                <Input
                  className="h-10 flex-1"
                  placeholder={dessin.surface != null ? 'Terrain, terrasse…' : 'Clôture, gouttière…'}
                  aria-label="Nom du métré"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                />
                <Button
                  disabled={enregistrer.isPending}
                  onClick={() =>
                    enregistrer.mutate(
                      {
                        affectation_token: affectationToken,
                        nom: nom.trim() || (dessin.surface != null ? 'Surface' : 'Longueur'),
                        type: dessin.surface != null ? 'surface' : 'longueur',
                        geometrie: trace,
                        source: 'dessin',
                      },
                      {
                        onSuccess: () => {
                          toast.success('Métré enregistré')
                          recommencer()
                        },
                        onError: (e) =>
                          toast.error('Mesure non enregistrée', {
                            description: e instanceof Error ? e.message : undefined,
                          }),
                      },
                    )
                  }
                >
                  {enregistrer.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Garder
                </Button>
                <Button size="icon" variant="ghost" aria-label="Recommencer" onClick={recommencer}>
                  <X className="size-4" />
                </Button>
              </div>
            </>
          ) : mode === 'apercu' ? (
            <>
              <p className="text-center text-sm text-muted-foreground">
                {batiments.length > 0
                  ? 'Touchez la maison du chantier pour lire ses mesures.'
                  : 'Aucun bâtiment ici — dessinez, ou cherchez l’adresse.'}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => setMode('surface')}>
                  <Pencil className="size-4" />
                  Dessiner une surface
                </Button>
                <Button variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => setMode('longueur')}>
                  <Ruler className="size-4" />
                  Mesurer une longueur
                </Button>
              </div>
              {/* Recadrer répare la donnée du CRM, pas seulement l'écran. */}
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                disabled={corriger.isPending}
                onClick={() => {
                  const p = centreCarte.current
                  if (!p) return
                  corriger.mutate(
                    { affectation_token: affectationToken, lat: p[1], lon: p[0] },
                    {
                      onSuccess: () => toast.success('Position du chantier corrigée'),
                      onError: (e) =>
                        toast.error('Échec', {
                          description: e instanceof Error ? e.message : undefined,
                        }),
                    },
                  )
                }}
              >
                <Crosshair className="size-4" />
                Le chantier est ici
              </Button>
            </>
          ) : (
            <>
              <p className="text-center text-sm text-muted-foreground">
                {trace.length === 0
                  ? 'Touchez chaque coin, l’un après l’autre.'
                  : `${trace.length} point${trace.length > 1 ? 's' : ''} posé${trace.length > 1 ? 's' : ''}.`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  disabled={!trace.length}
                  onClick={() => setTrace((t) => t.slice(0, -1))}
                >
                  <Undo2 className="size-4" />
                  Défaire
                </Button>
                <Button variant="ghost" onClick={recommencer}>
                  Annuler
                </Button>
              </div>
            </>
          )}

          {/* « Mesurer avec l'IA » : confirmer la maison, lancer, lire ce que l'IA a compris. */}
          {choisi?.cleabs && (
            <details open={!!ia.statut} className="rounded-xl border border-border">
              <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-medium">Analyse IA de la maison<span className="mt-1 block text-xs font-normal text-muted-foreground">Optionnelle · aide à lire les photos et les volumes</span></summary>
              <PanneauMetreIA
                etat={ia.etat.data}
                enCours={ia.enCours}
                erreurEtat={ia.etat.isError}
                onVerifierEtat={() => void ia.reprendre()}
                onLancer={() => {
                  if (manuelle || choisi.cleabs !== cible) retenirMaison(choisi, () => ia.lancer.mutate())
                  else ia.lancer.mutate()
                }}
                erreur={ia.lancer.data?.ok === false ? (ia.lancer.data.error ?? 'echec') : ia.lancer.isError ? 'echec' : null}
                contour={choisi.contour}
                adresse={null}
              />
            </details>
          )}

          {/* Les métrés déjà pris sur ce chantier — TOUJOURS visibles : ils
              étaient masqués dès qu'une maison était sélectionnée, c'est-à-dire
              à chaque ouverture. */}
          {!!ctx?.metres?.length && (
            <details className="rounded-xl border border-border px-3 py-2">
              <summary className="cursor-pointer select-none py-1 text-sm font-medium">
                Déjà enregistré ({ctx.metres.length})
              </summary>
              <ul className="mt-1 divide-y divide-border">
                {ctx.metres.map((m) => (
                  <li key={m.id} className="flex min-h-11 items-center gap-2 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                    <span className="block break-words">
                      {m.nom}
                      <span className="text-muted-foreground">
                        {' · '}
                        {m.type === 'longueur'
                          ? formatM(Number(m.longueur_m ?? 0))
                          : formatM2(Number(m.surface_reelle_m2 ?? m.surface_m2 ?? 0))}
                      </span>
                    </span>
                    {traceManuelAffichable(m) && m.geometrie?.length >= 2 && <Button variant="link" size="sm" className="min-h-11 px-0 text-xs" aria-label={`Voir sur la carte : ${m.nom}`} onClick={() => voirTrace(m)}>Voir sur la carte</Button>}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-11 shrink-0 text-muted-foreground"
                      aria-label={`Supprimer ${m.nom}`}
                      disabled={supprimer.isPending || modifierTrace.isPending || (editionTrace && traceOuvert?.id === m.id)}
                      onClick={() => {
                        // Une suppression sans confirmation, à côté d'un doigt de chantier…
                        if (!window.confirm(`Supprimer « ${m.nom} » ?`)) return
                        supprimer.mutate(m.id, {
                          onSuccess: () => { if (traceOuvert?.id === m.id) recommencer(); toast.success('Mesure supprimée') },
                          onError: () => toast.error('Suppression impossible'),
                        })
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className="text-center text-[11px] leading-snug text-muted-foreground">
            Les tracés, relevés LiDAR et lectures IA sont des estimations à distance.
            Vérifiez les dimensions sur place avant commande et renseignez les valeurs confirmées.
          </p>
        </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Chiffre({ titre, valeur, fort }: { titre: string; valeur: string; fort?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-border p-2.5', fort && 'bg-primary/5')}>
      <p className="truncate text-xs text-muted-foreground">{titre}</p>
      <p className={cn('montant truncate', fort ? 'text-lg font-semibold text-primary' : 'text-sm')}>
        {valeur}
      </p>
    </div>
  )
}
