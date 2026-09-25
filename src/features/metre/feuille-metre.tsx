import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Crosshair,
  Layers,
  Loader2,
  MapPin,
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
  useContexteMetre,
  useCorrigerPosition,
  useEnregistrerMetre,
  useSupprimerMetre,
  type Adresse,
} from './use-metres'
import { situerChantier } from './position'
import { BandeauMaison } from './bandeau-maison'
import { vueDuChantier } from './vue-par-metier'
import { PanneauCloture } from './panneau-cloture'
import { parcelleSous, troncons } from './parcelle'
import {
  maisonDeLAdresse,
  useMaisonChantier,
  useRetenirMaison,
  type MaisonChantier,
} from './use-batiment-chantier'

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
}: {
  token: string
  affectationToken: string
  titre?: string | null
  onClose: () => void
}) {
  // LE BOUTON RETOUR DU TÉLÉPHONE FERME LA FEUILLE. Sans entrée d'historique,
  // il changeait d'écran — voire quittait l'espace — en laissant la feuille
  // ouverte par-dessus. On en pose une à l'ouverture ; « retour » la consomme
  // et ferme. Fermer par la croix la retire, pour ne pas laisser d'entrée morte.
  const fermer = useRef(onClose)
  useEffect(() => {
    fermer.current = onClose
  })
  useEffect(() => {
    window.history.pushState({ feuilleMetre: true }, '')
    const surRetour = () => fermer.current()
    window.addEventListener('popstate', surRetour)
    return () => window.removeEventListener('popstate', surRetour)
  }, [])
  function fermerFeuille() {
    if (window.history.state?.feuilleMetre) window.history.back()
    else onClose()
  }

  const { data: ctx } = useContexteMetre(token, affectationToken)
  const enregistrer = useEnregistrerMetre(token)
  const supprimer = useSupprimerMetre(token)
  const corriger = useCorrigerPosition(token)

  const [fond, setFond] = useState<FondCarte>('ortho')
  const [cadastre, setCadastre] = useState(false)
  const [mode, setMode] = useState<ModeCarte>('apercu')
  const [trace, setTrace] = useState<Point[]>([])
  const [batiments, setBatiments] = useState<Batiment[]>([])
  // Le choix de l'artisan : un bâtiment touché, ou « aucun » quand il a écarté
  // la maison proposée. Tant qu'il n'a rien choisi, c'est la maison du
  // chantier qui est sélectionnée.
  const [choix, setChoix] = useState<Batiment | 'aucun' | null>(null)
  // La façade en cours de chiffrage, surlignée sur la carte.
  const [murChoisi, setMurChoisi] = useState<Facade | null>(null)
  const [nom, setNom] = useState('')
  const [recherche, setRecherche] = useState('')
  const [resultats, setResultats] = useState<Adresse[]>([])
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
  // Les autres bâtiments chargés : ils disent quels murs de la maison sont accolés.
  const voisins = useMemo(
    () => batiments.filter((b) => b.id !== choisi?.id).map((b) => b.contour),
    [batiments, choisi?.id],
  )

  // LA CLÔTURE : pour les métiers du terrain, la parcelle de la maison et ses
  // côtés à cocher. Les côtés cochés sont gardés par maison : changer de
  // maison ne reporte pas les choix de l'autre.
  const terrain = vue === 'terrain'
  const { data: parcelle, isLoading: parcelleEnCours } = useQuery({
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
      if (q.length < 3) return setResultats([])
      void chercherAdresse(q, ctrl.signal).then(setResultats).catch(() => undefined)
    }, 300)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [recherche])

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
    setTrace([])
    setChoix('aucun')
    setMurChoisi(null)
    setMode('apercu')
    setNom('')
  }

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

        {/* La carte occupe tout ce qui reste au-dessus du panneau. */}
        <div className="relative min-h-0 flex-1">
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
            onPoserSommet={(p) => setTrace((t) => [...t, p])}
            onBouger={(p) => {
              centreCarte.current = p
            }}
            parcelle={terrain ? (parcelle ?? null) : null}
            cotesChoisis={cotesChoisis}
            onBasculerCote={basculerCote}
          />

          {enRecherche && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] flex justify-center">
              <span className="flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs shadow-card">
                <Loader2 className="size-3.5 animate-spin" />
                On cherche la maison…
              </span>
            </div>
          )}

          {/* Mire de visée : elle désigne le point que « Recadrer » enregistrera. */}
          {mode === 'apercu' && !choisi && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 z-[400] -translate-x-1/2 -translate-y-1/2"
            >
              <Crosshair className="size-7 text-primary drop-shadow-[0_0_3px_rgba(255,255,255,.9)]" />
            </div>
          )}

          {/* Fonds de plan */}
          <div className="absolute right-2 top-2 z-[500] flex flex-col gap-1.5">
            <Button
              size="icon"
              variant="secondary"
              className="size-9 shadow-card"
              aria-label={fond === 'ortho' ? 'Passer au plan' : 'Passer à la photo'}
              onClick={() => setFond((f) => (f === 'ortho' ? 'plan' : 'ortho'))}
            >
              <Layers className="size-4" />
            </Button>
            <Button
              size="icon"
              variant={cadastre ? 'default' : 'secondary'}
              className="size-9 shadow-card"
              aria-label="Limites de parcelle"
              onClick={() => setCadastre((c) => !c)}
            >
              <span className="text-[10px] font-bold">CAD</span>
            </Button>
          </div>

          {/* Recherche d'adresse : le recours quand le chantier n'est pas
              géolocalisé. Décalée à gauche pour laisser les boutons de zoom de
              Leaflet, qui occupent le coin haut-gauche. */}
          <div className="absolute left-14 right-14 top-2 z-[500]">
            {chercheOuverte ? (
              <div className="space-y-1 rounded-xl bg-card p-2 shadow-card">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    className="h-9 pl-8"
                    placeholder="Adresse du chantier…"
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                  />
                </div>
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
        <div className="max-h-[62dvh] shrink-0 space-y-3 overflow-y-auto overscroll-contain border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
          <BandeauMaison
            maison={maison}
            choisi={choisi}
            retenue={retenue}
            cherchee={!!manuelle}
            enCours={retenir.isPending}
            onOui={() => choisi && retenirMaison(choisi, () => toast.success('Maison confirmée'))}
            onAutre={recommencer}
          />
          {choisi ? (
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
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setMode('surface')}>
                  <Pencil className="size-4" />
                  Dessiner une surface
                </Button>
                <Button variant="outline" onClick={() => setMode('longueur')}>
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
                  <li key={m.id} className="flex min-h-11 items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {m.nom}
                      <span className="text-muted-foreground">
                        {' · '}
                        {m.type === 'longueur'
                          ? formatM(Number(m.longueur_m ?? 0))
                          : formatM2(Number(m.surface_reelle_m2 ?? m.surface_m2 ?? 0))}
                      </span>
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-11 shrink-0 text-muted-foreground"
                      aria-label={`Supprimer ${m.nom}`}
                      disabled={supprimer.isPending}
                      onClick={() => {
                        // Une suppression sans confirmation, à côté d'un doigt de chantier…
                        if (!window.confirm(`Supprimer « ${m.nom} » ?`)) return
                        supprimer.mutate(m.id, {
                          onSuccess: () => toast.success('Mesure supprimée'),
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
            Mesures relevées sur photo aérienne : bonnes pour chiffrer, pas pour commander du
            sur-mesure.
          </p>
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
