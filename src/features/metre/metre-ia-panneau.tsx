import { useEffect } from 'react'
import { AlertTriangle, Check, Loader2, Sparkles } from 'lucide-react'
import { MapContainer, Polygon, TileLayer, useMap } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Point } from './geometrie'
import { LIBELLES_VOLUME } from './scene-ia'
import type { ReponseMetreIA } from './use-metre-ia'

/** Ce que dit la fonction quand la lecture n'a pas abouti, avec les mots de l'écran. */
const MOTIFS: Record<string, string> = {
  quota_atteint: 'Vous avez atteint le nombre de lectures par IA de la journée. Reprenez demain.',
  vision_occupee: 'L’IA est occupée. Réessayez dans une minute.',
  vision_indisponible: 'L’IA n’est pas branchée sur ce serveur.',
  vision_refus: 'L’IA a décliné cette lecture.',
  photo_ign_indisponible: 'La photo aérienne de l’IGN ne répond pas. Réessayez dans un moment.',
  nuage_absent: 'Les points LiDAR de cette maison ne sont plus gardés : relancez le relevé de la maison.',
  releve_hors_couverture: 'L’IGN n’a pas encore survolé cette commune en LiDAR : pas de lecture possible ici.',
}
const motif = (m?: string | null) => (m ? (MOTIFS[m] ?? (m.startsWith('releve_') ? 'Le relevé LiDAR de cette maison n’a pas abouti.' : 'La lecture n’a pas abouti.')) : 'La lecture n’a pas abouti.')

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
function CarteMaison({ contour }: { contour: Point[] }) {
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

/**
 * « Mesurer avec l'IA » : la maison à confirmer, puis la lecture — ses étapes, ce
 * que l'IA a compris (volumes, terrasses, escaliers), ce qu'elle n'a pas pu
 * trancher. Le lancement est un appui : la lecture est payante à l'usage.
 */
export function PanneauMetreIA({
  etat,
  enCours,
  onLancer,
  erreur,
  contour,
  adresse,
}: {
  etat: ReponseMetreIA | undefined
  enCours: boolean
  onLancer: () => void
  erreur: string | null
  /** Le contour de la maison retenue, pour la reconnaître sur la photo. */
  contour: Point[] | null
  adresse: string | null
}) {
  const fait = etat?.statut === 'fait' && etat.scene
  const echec = etat?.statut === 'echec' || !!erreur

  return (
    <div className="space-y-3 border-b border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          Mesurer avec l’IA
        </h3>
        {fait && etat.modele && <span className="text-[11px] text-muted-foreground">Lu par {etat.modele}{etat.cout?.duree_ms ? ` en ${Math.round(etat.cout.duree_ms / 1000)} s` : ''}</span>}
      </div>

      {!fait && !enCours && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            L’IA lit la maison avec tout ce dont on dispose&nbsp;: points LiDAR, photo aérienne à 5–20 cm, photos de rue. Elle reconnaît la maison, ses annexes, ses
            terrasses et leurs escaliers, et lit les fenêtres&nbsp;; <strong className="text-foreground">les hauteurs restent celles du laser</strong>, elle ne les invente pas.
          </p>
          {contour && contour.length >= 3 ? (
            <>
              <p className="text-sm font-medium">Est-ce bien la maison{adresse ? ` de ${adresse}` : ''}&nbsp;?</p>
              <CarteMaison contour={contour} />
            </>
          ) : (
            <p className="text-sm text-[#B45309]">Aucune maison n’est retenue pour ce dossier : choisissez d’abord l’adresse.</p>
          )}
          {echec && (
            <p className="flex items-start gap-1.5 text-sm text-[#B45309]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {erreur ? motif(erreur) : motif(etat?.motif)}
            </p>
          )}
          <Button className="min-h-11 w-full sm:w-auto" onClick={onLancer} disabled={!contour}>
            <Sparkles className="size-4" />
            {echec ? 'Réessayer' : 'Oui, c’est cette maison : mesurer avec l’IA'}
          </Button>
        </div>
      )}

      {enCours && (
        <div className="space-y-1.5">
          <ul className="space-y-1 text-sm">
            {(etat?.etapes ?? []).map((e) => (
              <li key={e.cle} className="flex items-center gap-2 text-muted-foreground">
                <Check className="size-3.5 text-[#16A34A]" />
                {e.libelle}
                <span className="text-[11px]">{(e.ms / 1000).toFixed(e.ms < 10_000 ? 1 : 0).replace('.', ',')} s</span>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin text-primary" />
              {etat?.etape ?? 'Démarrage'}…
            </li>
          </ul>
          <p className="text-[11px] text-muted-foreground">Une à deux minutes la première fois. Vous pouvez quitter l’écran : la lecture est gardée.</p>
        </div>
      )}

      {fait && etat.scene && (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {etat.scene.volumes.map((v) => (
              <li key={v.ref} className="rounded-lg border border-border px-2.5 py-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{LIBELLES_VOLUME[v.genre]}</span>
                  <span className={cn('text-[11px]', v.confiance === 'haute' ? 'text-[#16A34A]' : v.confiance === 'moyenne' ? 'text-[#B45309]' : 'text-destructive')}>
                    confiance {v.confiance}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{v.remarque}</p>
              </li>
            ))}
          </ul>
          {etat.verif && etat.verif.a_verifier.length > 0 && (
            <div className="space-y-1 rounded-xl bg-[#F59E0B]/10 p-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[#B45309]">
                <AlertTriangle className="size-3.5" />À vérifier sur place
              </p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-[#92400E]">
                {etat.verif.a_verifier.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
