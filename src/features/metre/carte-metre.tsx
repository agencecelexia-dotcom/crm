import { useEffect } from 'react'
import { MapContainer, Polygon, Polyline, CircleMarker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'

import { cn } from '@/lib/utils'
import type { Batiment } from './bati-ign'
import type { Mur, Point } from './geometrie'

/**
 * La carte de métré.
 *
 * Fond : les orthophotos de l'IGN, gratuites et sans clé, 20 cm par pixel.
 * Elles s'arrêtent au zoom 19 ; on autorise l'affichage jusqu'à 21 en image
 * agrandie, non pour voir plus net mais pour POINTER plus finement — au zoom
 * 19 un pixel vaut 21 cm, et le doigt en couvre facilement dix.
 *
 * Leaflet travaille en [latitude, longitude], le GeoJSON en [longitude,
 * latitude]. Toute la conversion est faite ici, une fois, par `versLeaflet` :
 * partout ailleurs dans `features/metre`, un Point est un [lon, lat].
 */

const ATTRIB_IGN =
  '&copy; <a href="https://www.ign.fr">IGN</a> — Géoplateforme'

export type FondCarte = 'ortho' | 'plan'
export type ModeCarte = 'apercu' | 'surface' | 'longueur'

const versLeaflet = (p: Point): LatLngExpression => [p[1], p[0]]

/** Recadre la carte quand le chantier change, sans l'arracher à l'artisan. */
function Recadrer({ centre, zoom }: { centre: Point | null; zoom?: number }) {
  const map = useMap()
  // Les coordonnées sont extraites : dépendre du tableau lui-même relancerait
  // le recadrage à chaque rendu, et arracherait la carte des mains de
  // l'artisan en plein tracé.
  const lon = centre?.[0]
  const lat = centre?.[1]
  useEffect(() => {
    if (lon != null && lat != null) {
      map.setView([lat, lon], zoom ?? map.getZoom(), { animate: true })
    }
  }, [lon, lat, zoom, map])
  return null
}

/** Remonte le centre de la carte : c'est lui qui corrige la position du chantier. */
function SuivreCentre({ onBouger }: { onBouger?: (p: Point) => void }) {
  useMapEvents({
    moveend(e) {
      const c = e.target.getCenter()
      onBouger?.([c.lng, c.lat])
    },
  })
  return null
}

/** En mode dessin, chaque appui pose un sommet. */
function PoserSommet({ actif, onPoser }: { actif: boolean; onPoser: (p: Point) => void }) {
  useMapEvents({
    click(e) {
      if (actif) onPoser([e.latlng.lng, e.latlng.lat])
    },
  })
  return null
}

export function CarteMetre({
  centre,
  zoom = 19,
  fond,
  mode,
  batiments,
  batimentChoisi,
  murChoisi,
  onChoisirBatiment,
  trace,
  onPoserSommet,
  onBouger,
  cadastre,
}: {
  centre: Point | null
  zoom?: number
  fond: FondCarte
  mode: ModeCarte
  batiments: Batiment[]
  batimentChoisi: string | null
  murChoisi?: Mur | null
  onChoisirBatiment: (b: Batiment) => void
  trace: Point[]
  onPoserSommet: (p: Point) => void
  onBouger?: (p: Point) => void
  cadastre: boolean
}) {
  const dessine = mode !== 'apercu'

  return (
    <MapContainer
      center={centre ? versLeaflet(centre) : [46.6, 2.5]}
      zoom={centre ? zoom : 6}
      // L'échelle du tracé se lit mal à la molette ; on garde le zoom au doigt
      // et aux boutons, qui ne se déclenchent pas par accident en dessinant.
      scrollWheelZoom
      maxZoom={21}
      className={cn('size-full', dessine && 'cursor-crosshair')}
    >
      {fond === 'ortho' ? (
        <TileLayer
          key="ortho"
          attribution={ATTRIB_IGN}
          url="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
          // Au-delà de 19 l'IGN n'a plus de tuile : Leaflet agrandit la
          // dernière, ce qui laisse pointer au décimètre.
          maxNativeZoom={19}
          maxZoom={21}
        />
      ) : (
        <TileLayer
          key="plan"
          attribution={ATTRIB_IGN}
          url="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
          maxNativeZoom={19}
          maxZoom={21}
        />
      )}

      {/* Les limites de parcelle aident à distinguer le terrain du voisin. */}
      {cadastre && (
        <TileLayer
          key="cadastre"
          // Sans rang explicite, la bascule photo/plan recrée le fond APRÈS le
          // cadastre, qui disparaît alors sous lui.
          zIndex={400}
          opacity={0.7}
          attribution={ATTRIB_IGN}
          url="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
          maxNativeZoom={19}
          maxZoom={21}
        />
      )}

      <Recadrer centre={centre} zoom={centre ? zoom : undefined} />
      <SuivreCentre onBouger={onBouger} />
      <PoserSommet actif={dessine} onPoser={onPoserSommet} />

      {/* Le bâti déjà tracé : c'est lui qui évite de dessiner. */}
      {!dessine &&
        batiments.map((b) => {
          const choisi = b.id === batimentChoisi
          return (
            <Polygon
              key={b.id}
              positions={b.contour.map(versLeaflet)}
              eventHandlers={{ click: () => onChoisirBatiment(b) }}
              pathOptions={{
                color: choisi ? '#7C3AED' : '#FFFFFF',
                weight: choisi ? 3 : 2,
                opacity: choisi ? 1 : 0.85,
                fillColor: choisi ? '#7C3AED' : '#FFFFFF',
                fillOpacity: choisi ? 0.3 : 0.12,
              }}
            />
          )
        })}

      {/* La façade en cours de chiffrage : un trait épais sur son côté. */}
      {murChoisi && (
        <Polyline
          positions={[versLeaflet(murChoisi.a), versLeaflet(murChoisi.b)]}
          pathOptions={{ color: '#EA580C', weight: 6, opacity: 0.95 }}
        />
      )}

      {/* Le tracé en cours */}
      {trace.length >= 2 &&
        (mode === 'surface' ? (
          <Polygon
            positions={trace.map(versLeaflet)}
            pathOptions={{ color: '#7C3AED', weight: 3, fillColor: '#7C3AED', fillOpacity: 0.3 }}
          />
        ) : (
          <Polyline
            positions={trace.map(versLeaflet)}
            pathOptions={{ color: '#7C3AED', weight: 4 }}
          />
        ))}

      {/* Les sommets posés, pour voir où l'on en est et ce qu'on peut défaire. */}
      {dessine &&
        trace.map((p, i) => (
          <CircleMarker
            key={i}
            center={versLeaflet(p)}
            radius={i === trace.length - 1 ? 7 : 5}
            pathOptions={{
              color: '#FFFFFF',
              weight: 2,
              fillColor: '#7C3AED',
              fillOpacity: 1,
            }}
          />
        ))}
    </MapContainer>
  )
}
