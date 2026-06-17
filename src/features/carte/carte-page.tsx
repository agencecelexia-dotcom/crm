import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
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

// Crée une pastille colorée (DivIcon) pour un marqueur.
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

export function CartePage() {
  const { data: artisans } = useArtisans()
  const { data: projets } = useProjets()
  const [metier, setMetier] = useState('tous')
  const [statut, setStatut] = useState('tous')
  const [fond, setFond] = useState<'plan' | 'satellite'>('plan')

  // Icône artisan (constante) + cache des icônes statut.
  const iconArtisan = useMemo(() => pinIcon(COULEUR_ARTISAN), [])
  const iconsStatut = useMemo(() => {
    const m: Record<string, L.DivIcon> = {}
    for (const s of STATUTS_ORDRE) m[s] = pinIcon(STATUTS[s].color)
    return m
  }, [])

  const artisansAffiches = useMemo(
    () =>
      (artisans ?? []).filter(
        (a) =>
          a.latitude != null &&
          a.longitude != null &&
          (metier === 'tous' || a.metiers.includes(metier)),
      ),
    [artisans, metier],
  )

  const projetsAffiches = useMemo(
    () =>
      (projets ?? []).filter(
        (p) =>
          p.latitude != null &&
          p.longitude != null &&
          (metier === 'tous' || p.metiers.includes(metier)) &&
          (statut === 'tous' || p.statut === statut),
      ),
    [projets, metier, statut],
  )

  return (
    <div className="-mx-4 -mt-4">
      {/* Filtres */}
      <div className="grid grid-cols-2 gap-2 px-4 pb-3 pt-1">
        <Select value={metier} onValueChange={setMetier}>
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
        <Select value={statut} onValueChange={setStatut}>
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

      {/* Carte — `isolate` crée un contexte d'empilement pour confiner les z-index
          internes de Leaflet (sinon ils passent au-dessus des menus déroulants des filtres) */}
      <div className="relative isolate h-[calc(100dvh-16rem)] w-full">
        {/* Bascule fond de carte : Plan (CARTO Voyager) / Satellite (Esri) */}
        <div className="absolute right-3 top-3 z-[1000] flex overflow-hidden rounded-lg border border-border bg-card shadow-card">
          {(['plan', 'satellite'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFond(f)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                fond === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {f === 'plan' ? 'Plan' : 'Satellite'}
            </button>
          ))}
        </div>

        <MapContainer
          center={CARTE_CENTRE}
          zoom={CARTE_ZOOM}
          scrollWheelZoom
          className="size-full"
        >
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

          {/* Pins artisans (violet) */}
          {artisansAffiches.map((a) => (
            <Marker
              key={`a-${a.id}`}
              position={[a.latitude!, a.longitude!]}
              icon={iconArtisan}
            >
              <Popup>
                <p className="font-medium">
                  {a.nom} {a.prenom}
                </p>
                {a.societe && <p className="text-xs">{a.societe}</p>}
                <p className="text-xs text-muted-foreground">{a.metiers.join(', ')}</p>
                <Button asChild size="sm" variant="link" className="h-auto p-0">
                  <Link to={`/artisans/${a.id}`}>Voir la fiche →</Link>
                </Button>
              </Popup>
            </Marker>
          ))}

          {/* Pins projets (couleur = statut) */}
          {projetsAffiches.map((p) => (
            <Marker
              key={`p-${p.id}`}
              position={[p.latitude!, p.longitude!]}
              icon={iconsStatut[p.statut]}
            >
              <Popup>
                <p className="font-medium">{p.client_nom}</p>
                <p className="text-xs">
                  {p.metiers.join(', ')} · {STATUTS[p.statut].label}
                </p>
                {p.montant_devis_signe != null && (
                  <p className="text-xs">Signé : {formatEuros(p.montant_devis_signe)}</p>
                )}
                <Button asChild size="sm" variant="link" className="h-auto p-0">
                  <Link to={`/projets/${p.id}`}>Voir le projet →</Link>
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
