import { useRef } from 'react'
import { Camera, Loader2, ScanSearch } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatM, formatM2 } from './geometrie'
import { moisDuVol } from './affichage-releve'
import { photoDeLaFacade, resultatRetenu } from './ouvertures'
import {
  MESSAGES_PHOTO,
  useDeposerPhoto,
  useEcarterOuverture,
  useLirePhoto,
  usePhotosFacade,
  type PhotoFacade,
} from './use-photos-facade'

const TYPES: Record<string, [string, string]> = {
  fenetre: ['fenêtre', 'fenêtres'],
  porte_fenetre: ['porte-fenêtre', 'portes-fenêtres'],
  porte: ['porte', 'portes'],
  garage: ['porte de garage', 'portes de garage'],
  baie: ['baie', 'baies'],
  soupirail: ['soupirail', 'soupiraux'],
  autre: ['autre', 'autres'],
}

const SOURCE: Record<PhotoFacade['source'], string> = {
  panoramax: 'Photo Panoramax',
  mapillary: 'Photo Mapillary',
  artisan: 'Votre photo',
}

/**
 * La façade en photo : la meilleure photo de rue qui la montre, ou celle que
 * l'artisan prend. La vision y repère la façade et ses ouvertures ; leur
 * surface se déduit d'un appui — jamais sans l'artisan.
 */
export function PhotosFacade({
  token,
  cleabs,
  orientation,
  hauteurReleve,
  onDeduire,
}: {
  token: string
  cleabs: string
  orientation: string
  hauteurReleve: number | null
  onDeduire: (m2: number) => void
}) {
  const { data: photos, isLoading } = usePhotosFacade(token, cleabs, true)
  const lireP = useLirePhoto(token, cleabs)
  const deposer = useDeposerPhoto(token, cleabs)
  const ecarter = useEcarterOuverture(token, cleabs)
  const fichier = useRef<HTMLInputElement>(null)
  // La photo de l'artisan d'abord (il l'a prise pour ça), sinon celle de la rue.
  const photo = photoDeLaFacade(photos ?? [], orientation)
  const lecture = photo?.lecture ?? null
  const erreur = lireP.error ?? deposer.error ?? ecarter.error
  // Sans les ouvertures que l'artisan a retirées.
  const r = photo ? resultatRetenu(photo) : null
  const ecartees = new Set(photo?.ecartees ?? [])

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium">Photo de la façade</p>
        {photo && (
          <p className="truncate text-[11px] text-muted-foreground">
            {SOURCE[photo.source]}
            {photo.distance_m ? ` · à ${Math.round(photo.distance_m)} m` : ''}
          </p>
        )}
      </div>

      {isLoading ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Recherche des photos de rue…
        </p>
      ) : photo?.url ? (
        <figure className="space-y-1">
          <div className="relative overflow-hidden rounded-xl border border-border bg-muted">
            <img src={photo.url} alt={`Façade ${orientation}`} className="block h-auto w-full" loading="lazy" />
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
              {/* Toucher une ouverture la retire (un reflet, une grille), ou la remet. */}
              {lecture?.vision.cadre ? (
                <>
                  <rect
                    x={lecture.vision.cadre.gauche}
                    y={lecture.vision.cadre.haut}
                    width={lecture.vision.cadre.droite - lecture.vision.cadre.gauche}
                    height={lecture.vision.cadre.bas - lecture.vision.cadre.haut}
                    fill="none"
                    stroke="#EA580C"
                    strokeWidth={4}
                    vectorEffect="non-scaling-stroke"
                  />
                  {lecture.vision.ouvertures.map((o, i) => {
                    const retiree = ecartees.has(i)
                    return (
                      <rect
                        key={i}
                        x={o.gauche}
                        y={o.haut}
                        width={o.droite - o.gauche}
                        height={o.bas - o.haut}
                        fill={retiree ? '#64748B' : '#2563EB'}
                        fillOpacity={retiree ? 0.08 : 0.25}
                        stroke={retiree ? '#64748B' : '#2563EB'}
                        strokeDasharray={retiree ? '4 4' : undefined}
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                        className="pointer-events-auto cursor-pointer"
                        role="button"
                        aria-label={retiree ? 'Remettre cette ouverture' : 'Retirer cette ouverture'}
                        onClick={() => !ecarter.isPending && ecarter.mutate({ id: photo.id, rang: i, ecartee: !retiree })}
                      />
                    )
                  })}
                </>
              ) : photo.colonnes?.length === 2 ? (
                // Avant lecture : là où la façade devrait être, d'après la position de l'appareil.
                <rect
                  x={photo.colonnes[0]}
                  y={0}
                  width={Math.max(8, photo.colonnes[1] - photo.colonnes[0])}
                  height={1000}
                  fill="#EA580C"
                  fillOpacity={0.12}
                  stroke="#EA580C"
                  strokeDasharray="6 6"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
          </div>
          <figcaption className="text-[11px] text-muted-foreground">
            {photo.source === 'artisan' ? (
              'Votre photo'
            ) : (
              <>
                {photo.auteur ?? 'Anonyme'} · {photo.licence === 'CC-BY-SA-4.0' ? 'CC BY-SA 4.0' : photo.licence}
                {photo.pris_le && ` · ${moisDuVol(photo.pris_le.slice(0, 10))}`}
                {photo.page && (
                  <>
                    {' · '}
                    <a href={photo.page} target="_blank" rel="noreferrer" className="underline">
                      voir la photo
                    </a>
                  </>
                )}
              </>
            )}
          </figcaption>
        </figure>
      ) : (
        <p className="text-xs text-muted-foreground">
          Aucune photo de rue ne montre cette façade (les photos ouvertes sont souvent prises dans
          l’axe de la rue). Prenez-la vous-même : la lecture fait le reste.
        </p>
      )}

      {r && (
        <div className="space-y-1.5 rounded-xl border border-border p-2.5 text-xs">
          {r.utilisable || r.motif === 'facade_partielle' ? (
            <p>
              <strong className="text-foreground">
                {r.nombre} ouverture{r.nombre > 1 ? 's' : ''}
              </strong>
              {r.nombre > 0 &&
                ` (${Object.entries(r.parType)
                  .map(([t, n]) => `${n} ${TYPES[t]?.[n! > 1 ? 1 : 0] ?? t}`)
                  .join(', ')})`}
              {r.surface != null && (
                <>
                  {' '}≈ <strong className="text-foreground">{formatM2(r.surface)}</strong>
                  {r.methode === 'forfait'
                    ? ' (surfaces types : la façade est trop petite sur la photo pour les mesurer)'
                    : ' (mesurées sur la photo, à l’échelle du mur relevé)'}
                </>
              )}
              {lecture?.vision.niveaux ? ` · ${lecture.vision.niveaux} niveau${lecture.vision.niveaux > 1 ? 'x' : ''}` : ''}
              {lecture?.vision.materiau ? ` · ${lecture.vision.materiau}` : ''}
            </p>
          ) : (
            <p className="text-[#B45309]">
              {r.motif === 'autre_batiment'
                ? 'Cette photo semble montrer une autre maison : prenez-en une vous-même.'
                : 'La façade ne se voit pas assez sur cette photo : prenez-en une vous-même.'}
            </p>
          )}
          {ecartees.size > 0 && (
            <p className="text-muted-foreground">
              {ecartees.size} ouverture{ecartees.size > 1 ? 's' : ''} retirée{ecartees.size > 1 ? 's' : ''} par vous (en pointillé).
              Touchez-la sur la photo pour la remettre.
            </p>
          )}
          {lecture && lecture.vision.ouvertures.length > 0 && ecartees.size === 0 && (
            <p className="text-muted-foreground">Une ouverture en trop ? Touchez-la sur la photo pour la retirer.</p>
          )}
          {r.motif === 'facade_partielle' && (
            <p className="text-[#B45309]">
              Une partie de la façade est cachée ou hors de l’image : des ouvertures peuvent manquer.
            </p>
          )}
          {r.hauteurPhoto != null && hauteurReleve != null && (
            <p className="text-muted-foreground">
              Hauteur vue sur la photo : {formatM(r.hauteurPhoto)} (relevé LiDAR : {formatM(hauteurReleve)}).
            </p>
          )}
          {r.surface != null && r.surface > 0 && r.motif !== 'autre_batiment' && (
            <Button size="sm" variant="outline" className="min-h-9" onClick={() => onDeduire(r.surface!)}>
              Déduire {formatM2(r.surface)} d’ouvertures
            </Button>
          )}
        </div>
      )}

      {erreur && (
        <p className="text-xs text-[#B45309]">
          {MESSAGES_PHOTO[erreur instanceof Error ? erreur.message : ''] ?? 'La photo n’a pas pu être traitée : réessayez.'}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {photo && !lecture && (
          <Button
            size="sm"
            className="min-h-10"
            disabled={lireP.isPending}
            onClick={() => lireP.mutate(photo.id)}
          >
            {lireP.isPending ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
            Repérer les ouvertures
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="min-h-10"
          disabled={deposer.isPending}
          onClick={() => fichier.current?.click()}
        >
          {deposer.isPending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          {deposer.isPending ? 'Envoi et lecture…' : 'Prendre une photo'}
        </Button>
        <input
          ref={fichier}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) deposer.mutate({ fichier: f, orientation })
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
