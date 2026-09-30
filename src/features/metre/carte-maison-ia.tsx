import { useEffect } from 'react'
import { MapContainer, Polygon, TileLayer, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'

import type { Point } from './geometrie'

const ATTRIB_IGN = '&copy; <a href="https://www.ign.fr">IGN</a> — Géoplateforme'

function Cadrer({ contour }: { contour: Point[] }) {
  const carte = useMap()
  useEffect(() => {
    const ll = contour.map(([lon, lat]) => [lat, lon] as [number, number])
    const lats = ll.map((p) => p[0]), lons = ll.map((p) => p[1])
    const b: LatLngBoundsExpression = [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]]
    carte.fitBounds(b, { padding: [40, 40], maxZoom: 20 })
  }, [carte, contour])
  return null
}

/** La maison à confirmer : la photo aérienne de l'IGN et son contour. Le contour ne sert qu'à la reconnaître. */
export default function CarteMaison({ contour }: { contour: Point[] }) {
  return (
    <div className="h-52 overflow-hidden rounded-xl border border-border">
      <MapContainer center={[contour[0][1], contour[0][0]]} zoom={19} className="size-full" scrollWheelZoom={false} attributionControl>
        <TileLayer
          attribution={ATTRIB_IGN}
          url="https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
          maxNativeZoom={19}
          maxZoom={21}
        />
        <Polygon positions={contour.map(([lon, lat]) => [lat, lon] as [number, number])} pathOptions={{ color: '#7C3AED', weight: 3, fillOpacity: 0.08, dashArray: '6 4' }} />
        <Cadrer contour={contour} />
      </MapContainer>
    </div>
  )
}
