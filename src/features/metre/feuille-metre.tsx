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
  distance,
  formatM,
  formatM2,
  longueur,
  plusProche,
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
  const { data: ctx } = useContexteMetre(token, affectationToken)
  const enregistrer = useEnregistrerMetre(token)
  const supprimer = useSupprimerMetre(token)
  const corriger = useCorrigerPosition(token)

  const [fond, setFond] = useState<FondCarte>('ortho')
  const [cadastre, setCadastre] = useState(false)
  const [mode, setMode] = useState<ModeCarte>('apercu')
  const [trace, setTrace] = useState<Point[]>([])
  const [batiments, setBatiments] = useState<Batiment[]>([])
  const [choisi, setChoisi] = useState<Batiment | null>(null)
  // La façade en cours de chiffrage, surlignée sur la carte.
  const [murChoisi, setMurChoisi] = useState<Facade | null>(null)
  const [nom, setNom] = useState('')
  const [recherche, setRecherche] = useState('')
  const [resultats, setResultats] = useState<Adresse[]>([])
  const [chercheOuverte, setChercheOuverte] = useState(false)
  // Zoom d'ouverture. 19 quand on sait quelle maison c'est ; 18 sinon, pour
  // montrer le voisinage : à 19 l'écran ne couvre que 82 m, et un bâtiment
  // géocodé à 40 m de la rue tombe au bord.
  const [zoom, setZoom] = useState(19)
  // Le recadrage choisi par l'artisan l'emporte ; à défaut, la position du
  // chantier. Le centre est DÉRIVÉ plutôt que recopié dans un état : le
  // synchroniser par un effet provoquait un rendu en cascade dès que la
  // position arrivait.
  const [recadrage, setRecadrage] = useState<Point | null>(null)
  const centreCarte = useRef<Point | null>(null)

  // Où est vraiment ce chantier ? La position enregistrée vient d'un géocodage
  // fait à la création, qui retombe sur la ville faute d'adresse — sur
  // trente-quatre chantiers, deux seulement tombaient à moins de quatre-vingts
  // mètres. On confronte donc la position à l'adresse avant toute mesure.
  const { data: situation } = useQuery({
    queryKey: ['situer', ctx?.projet_id, ctx?.client_adresse, ctx?.client_ville],
    enabled: !!ctx?.ok,
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

  // Les coordonnées vivent en SCALAIRES, pas en tableau : un tableau est
  // recréé à chaque rendu, et l'effet qui charge le bâti se relançait alors
  // sans fin — des centaines d'appels à l'IGN pour une seule ouverture.
  const lon = recadrage?.[0] ?? situation?.point?.[0] ?? null
  const lat = recadrage?.[1] ?? situation?.point?.[1] ?? null
  const centre: Point | null = lon != null && lat != null ? [lon, lat] : null

  // Le bâti se recharge autour du centre à chaque déplacement.
  //
  // À la PREMIÈRE arrivée sur un chantier, le bâtiment le plus proche de sa
  // position est présélectionné : l'artisan ouvre l'écran et lit ses mesures
  // sans toucher à rien. C'est tout l'objet de l'outil.
  const premierCadrage = useRef(true)
  const fiable = situation?.fiable === true
  useEffect(() => {
    if (lon == null || lat == null) return
    const p: Point = [lon, lat]
    const ctrl = new AbortController()
    batimentsAutour(lat, lon, 150, ctrl.signal)
      .then((bats) => {
        setBatiments(bats)
        if (!premierCadrage.current) return
        premierCadrage.current = false
        const proche = plusProche(bats, p, (b) => b.centre)
        // Présélectionner suppose de savoir SUR QUELLE MAISON on est. Tant que
        // la position n'est pas confirmée par l'adresse, on ne désigne rien :
        // des chiffres justes sur la maison d'un autre sont pires que pas de
        // chiffres, et c'est précisément ce que faisait l'outil.
        if (!fiable) {
          setZoom(18)
          return
        }
        if (proche?.centre && distance(proche.centre, p) < 25) {
          setChoisi(proche)
          setNom(proche.nature && proche.nature !== 'Indifférenciée' ? proche.nature : 'Bâtiment')
        } else if (bats.length) {
          setZoom(18)
        }
      })
      .catch(() => undefined)
    return () => ctrl.abort()
  }, [lon, lat, fiable])

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
    setChoisi(null)
    setMurChoisi(null)
    setMode('apercu')
    setNom('')
  }

  function garder(m: MesureAEnregistrer) {
    enregistrer.mutate(
      { affectation_token: affectationToken, source: 'bati', ...m },
      {
        onSuccess: (r) => {
          // La surface RÉELLE quand elle existe : annoncer l'emprise au sol
          // après avoir affiché la toiture prêtait à confusion.
          const retenue = r.surface_reelle_m2 ?? r.surface_m2
          toast.success('Métré enregistré', {
            description: retenue != null ? formatM2(Number(retenue)) : undefined,
          })
          recommencer()
        },
        onError: (e) =>
          toast.error('Échec', { description: e instanceof Error ? e.message : undefined }),
      },
    )
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
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
              setChoisi(b)
              setNom(b.nature && b.nature !== 'Indifférenciée' ? b.nature : 'Bâtiment')
            }}
            trace={trace}
            onPoserSommet={(p) => setTrace((t) => [...t, p])}
            onBouger={(p) => {
              centreCarte.current = p
            }}
          />

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
                    onClick={() => {
                      // Sans remise à zéro, l'emprise, la pente et l'alerte
                      // ABF de l'ancien bâtiment restaient à l'écran.
                      recommencer()
                      premierCadrage.current = true
                      setRecadrage([a.lon, a.lat])
                      setChercheOuverte(false)
                      setRecherche('')
                    }}
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
                {fiable ? 'Autre adresse' : 'Chercher l’adresse'}
              </Button>
            )}
          </div>
        </div>

        {/* Le panneau de mesure */}
        <div className="shrink-0 space-y-3 border-t border-border p-3">
          {/* Ce qu'on sait — ou pas — de l'endroit où l'on est. */}
          {situation?.message && (
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
          {choisi ? (
            <>
              <button
                type="button"
                onClick={recommencer}
                className="w-full text-left text-xs text-muted-foreground underline underline-offset-2"
              >
                Ce n’est pas le bon bâtiment — en choisir un autre
              </button>
            <PanneauBatiment
              token={token}
              batiment={choisi}
              enCours={enregistrer.isPending}
              onEnregistrer={garder}
              onMurChoisi={setMurChoisi}
            />
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
                          toast.error('Échec', {
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
                  ? zoom === 18
                    ? 'L’adresse est approximative : touchez le bon bâtiment.'
                    : 'Touchez le bâtiment pour lire ses mesures.'
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

          {/* Les métrés déjà pris sur ce chantier */}
          {!!ctx?.metres?.length && !choisi && !dessin && (
            <div className="space-y-1 border-t border-border pt-2">
              {ctx.metres.map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-xs">
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
                    className="size-7 shrink-0 text-muted-foreground"
                    aria-label={`Supprimer ${m.nom}`}
                    onClick={() => supprimer.mutate(m.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
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
