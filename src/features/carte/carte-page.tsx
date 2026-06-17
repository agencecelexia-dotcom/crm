import { useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { X } from 'lucide-react'
import L from 'leaflet'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  METIERS,
  STATUTS,
  STATUTS_ORDRE,
  COULEUR_ARTISAN,
  CARTE_CENTRE,
  CARTE_ZOOM,
} from '@/lib/constants'
import { formatEuros } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useArtisans } from '@/features/artisans/hooks/use-artisans'
import { useProjets } from '@/features/projets/hooks/use-projets'
import { artisansCompatibles } from '@/features/projets/lib/artisans-compatibles'

function pinIcon(color: string) {
  return L.divIcon({
    className: 'celexia-pin',
    html: `<span style="
      display:block;width:20px;height:20px;border-radius:50%;
      background:${color};border:3px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,.35);"></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10],
  })
}

// Recentre la carte quand on entre/sort du mode focus.
function Recentrer({ lat, lon, zoom }: { lat: number; lon: number; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo([lat, lon], zoom, { duration: 0.8 })
  }, [lat, lon, zoom, map])
  return null
}

export function CartePage() {
  const { data: artisans } = useArtisans()
  const { data: projets } = useProjets()
  const [params, setParams] = useSearchParams()
  const metier = params.get('metier') ?? 'tous'
  const statut = params.get('statut') ?? 'tous'
  const fond = (params.get('fond') as 'plan' | 'satellite') || 'plan'
  const focusId = params.get('projet')

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

  const iconArtisan = useMemo(() => pinIcon(COULEUR_ARTISAN), [])
  const iconsStatut = useMemo(() => {
    const m: Record<string, L.DivIcon> = {}
    for (const s of STATUTS_ORDRE) m[s] = pinIcon(STATUTS[s].color)
    return m
  }, [])

  // Projet en focus (cliqué ou ouvert via « Voir sur la carte »).
  const focusProjet = useMemo(
    () => (focusId ? (projets ?? []).find((p) => p.id === focusId) ?? null : null),
    [projets, focusId],
  )

  // Projet en focus : on affiche TOUS les artisans du même métier (placés sur la
  // carte), sans filtre de distance — c'est l'agence qui juge qui est trop loin.
  const autour = useMemo(() => {
    if (!focusProjet) return []
    return artisansCompatibles(focusProjet, artisans ?? [])
      .filter((c) => c.metierMatch && c.artisan.latitude != null && c.artisan.longitude != null)
      .sort((a, b) => {
        if (a.distance == null) return 1
        if (b.distance == null) return -1
        return a.distance - b.distance
      })
  }, [focusProjet, artisans])

  const artisansAffiches = useMemo(() => {
    if (focusProjet) return autour.map((c) => ({ a: c.artisan, distance: c.distance }))
    return (artisans ?? [])
      .filter(
        (a) =>
          a.latitude != null &&
          a.longitude != null &&
          (metier === 'tous' || a.metiers.includes(metier)),
      )
      .map((a) => ({ a, distance: null as number | null }))
  }, [focusProjet, autour, artisans, metier])

  const projetsAffiches = useMemo(() => {
    if (focusProjet)
      return focusProjet.latitude != null && focusProjet.longitude != null ? [focusProjet] : []
    return (projets ?? []).filter(
      (p) =>
        p.latitude != null &&
        p.longitude != null &&
        (metier === 'tous' || p.metiers.includes(metier)) &&
        (statut === 'tous' || p.statut === statut),
    )
  }, [focusProjet, projets, metier, statut])

  return (
    <div className="-mx-4 -mt-4">
      {/* Barre : filtres OU bandeau focus */}
      {focusProjet ? (
        <div className="flex items-center justify-between gap-2 bg-primary/5 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {focusProjet.client_nom}
              <span className="text-muted-foreground"> · {focusProjet.metiers.join(', ')}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {autour.length} artisan{autour.length > 1 ? 's' : ''} {focusProjet.metiers[0] || ''} sur
              la carte — à vous de juger la distance
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setParam('projet', '', '')}>
            <X className="size-4" />
            Voir tout
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 px-4 pb-3 pt-1">
          <Select value={metier} onValueChange={(v) => setParam('metier', v, 'tous')}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder="Métier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">Tous métiers</SelectItem>
              {METIERS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statut} onValueChange={(v) => setParam('statut', v, 'tous')}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder="Statut projet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">Tous statuts</SelectItem>
              {STATUTS_ORDRE.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUTS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="relative isolate h-[calc(100dvh-16rem)] w-full">
        {/* Bascule fond de carte */}
        <div className="absolute right-3 top-3 z-[1000] flex overflow-hidden rounded-lg border border-border bg-card shadow-card">
          {(['plan', 'satellite'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setParam('fond', f, 'plan')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                fond === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {f === 'plan' ? 'Plan' : 'Satellite'}
            </button>
          ))}
        </div>

        <MapContainer center={CARTE_CENTRE} zoom={CARTE_ZOOM} scrollWheelZoom className="size-full">
          {fond === 'plan' ? (
            <TileLayer
              key="plan"
              detectRetina
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              subdomains="abcd"
            />
          ) : (
            <TileLayer
              key="satellite"
              attribution='&copy; <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          )}

          {focusProjet && focusProjet.latitude != null && focusProjet.longitude != null && (
            <Recentrer lat={focusProjet.latitude} lon={focusProjet.longitude} zoom={10} />
          )}

          {/* Pins artisans (violet) */}
          {artisansAffiches.map(({ a, distance }) => (
            <Marker key={`a-${a.id}`} position={[a.latitude!, a.longitude!]} icon={iconArtisan}>
              <Popup>
                <p className="font-medium">
                  {a.nom} {a.prenom}
                </p>
                {a.societe && <p className="text-xs">{a.societe}</p>}
                <p className="text-xs text-muted-foreground">{a.metiers.join(', ')}</p>
                {distance != null && (
                  <p className="text-xs font-medium text-primary">~{Math.round(distance)} km du projet</p>
                )}
                <Button asChild size="sm" variant="link" className="h-auto p-0">
                  <Link to={`/artisans/${a.id}`}>Voir la fiche →</Link>
                </Button>
              </Popup>
            </Marker>
          ))}

          {/* Pins projets (couleur = statut) — clic = focus */}
          {projetsAffiches.map((p) => (
            <Marker
              key={`p-${p.id}`}
              position={[p.latitude!, p.longitude!]}
              icon={iconsStatut[p.statut]}
              eventHandlers={{ click: () => setParam('projet', p.id, '') }}
            >
              <Popup>
                <p className="font-medium">{p.client_nom}</p>
                <p className="text-xs">
                  {p.metiers.join(', ')} · {STATUTS[p.statut].label}
                </p>
                {p.montant_devis_signe != null && (
                  <p className="text-xs">Signé : {formatEuros(p.montant_devis_signe)}</p>
                )}
                {!focusProjet && (
                  <Button
                    size="sm"
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => setParam('projet', p.id, '')}
                  >
                    Voir les artisans autour →
                  </Button>
                )}
                <br />
                <Button asChild size="sm" variant="link" className="h-auto p-0">
                  <Link to={`/projets/${p.id}`}>Ouvrir le projet →</Link>
                </Button>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Légende */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-full border-2 border-white shadow"
            style={{ background: COULEUR_ARTISAN }}
          />
          Artisan
        </span>
        {STATUTS_ORDRE.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className="inline-block size-3 rounded-full border-2 border-white shadow"
              style={{ background: STATUTS[s].color }}
            />
            {STATUTS[s].label}
          </span>
        ))}
      </div>
    </div>
  )
}
