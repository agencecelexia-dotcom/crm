import { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CARTE_CENTRE, CARTE_ZOOM } from '@/lib/constants'
import type { StatutCouverture } from '@/types/database'
import { useCouvertureCarte, CIBLE_COUVERTURE, STATUT_COULEUR } from './use-couverture'

function pin(color: string) {
  return L.divIcon({
    className: 'couv-pin',
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  })
}

const LABELS: Record<StatutCouverture, string> = {
  vide: 'Trou (0)',
  partiel: `Partiel (1-${CIBLE_COUVERTURE - 1})`,
  couvert: `Couvert (${CIBLE_COUVERTURE}+)`,
}

export function CouvertureCarte({
  metier,
  sousMetier,
  onDrill,
}: {
  metier: string
  sousMetier: string | null
  onDrill: (z: { lat: number; lon: number; nom: string }) => void
}) {
  const { data: zones, isLoading } = useCouvertureCarte(metier, sousMetier)
  const icons = useMemo(
    () =>
      ({
        vide: pin(STATUT_COULEUR.vide),
        partiel: pin(STATUT_COULEUR.partiel),
        couvert: pin(STATUT_COULEUR.couvert),
      }) as Record<StatutCouverture, L.DivIcon>,
    [],
  )

  return (
    <div className="space-y-2">
      <div className="relative h-[62vh] w-full overflow-hidden rounded-xl border border-border">
        {isLoading && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/60">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        )}
        <MapContainer center={CARTE_CENTRE} zoom={CARTE_ZOOM} scrollWheelZoom className="size-full">
          <TileLayer
            detectRetina
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
          />
          {(zones ?? []).map((z) => (
            <Marker key={z.id} position={[z.lat, z.lon]} icon={icons[z.statut]}>
              <Popup>
                <p className="font-medium">{z.nom}</p>
                <p className="text-xs text-muted-foreground">
                  {z.n}/{CIBLE_COUVERTURE} artisan{z.n > 1 ? 's' : ''} couvrant cette zone
                </p>
                <Button
                  size="sm"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => onDrill({ lat: z.lat, lon: z.lon, nom: z.nom })}
                >
                  Démarcher ici →
                </Button>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs">
        {(['vide', 'partiel', 'couvert'] as StatutCouverture[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className="inline-block size-3 rounded-full border-2 border-white shadow"
              style={{ background: STATUT_COULEUR[s] }}
            />
            {LABELS[s]}
          </span>
        ))}
      </div>
    </div>
  )
}
