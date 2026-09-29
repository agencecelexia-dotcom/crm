import { Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatM, formatM2 } from './geometrie'
import { LIBELLES_TOIT, type MateriauxGardes } from './materiaux'
import type { Face3D } from './modele3d'
import { photoDeLaFacade, resultatRetenu } from './ouvertures'
import { facadeRetenue, type Releve } from './releve'
import { useEcarterOuverture, type PhotoFacade } from './use-photos-facade'

const TYPES_OUVERTURE: Record<string, string> = {
  fenetre: 'Fenêtre',
  porte_fenetre: 'Porte-fenêtre',
  porte: 'Porte',
  garage: 'Porte de garage',
  baie: 'Baie',
  soupirail: 'Soupirail',
  autre: 'Ouverture',
}

const hauteur = (n: number) => `${n.toFixed(1).replace('.', ',')} m`

/**
 * La fiche d'une face touchée dans la vue 3D : ce qu'elle mesure, et d'où ça
 * vient. Une ouverture lue sur une photo se retire (ou se remet) d'ici.
 */
export function FicheFace3D({
  face,
  releve,
  photos,
  materiaux,
  token,
  cleabs,
  onFermer,
}: {
  face: Face3D
  releve: Releve
  photos: PhotoFacade[]
  materiaux: MateriauxGardes | null
  token: string
  cleabs: string | null
  onFermer: () => void
}) {
  const ecarter = useEcarterOuverture(token, cleabs)
  let titre = '', detail = '', note: string | null = null
  let action: { libelle: string; faire: () => void } | null = null

  if (face.type === 'pan') {
    const p = releve.pans.find((x) => String(x.id) === face.ref)
    titre = p?.terrasse ? 'Terrasse' : p?.orientation === 'plat' ? 'Partie plate' : `Pan ${face.orientation}`
    detail = `${p ? formatM2(p.aireVraie) : ''}${p && !p.terrasse ? ` · pente ${Math.round(p.pente)} %` : ''}`
    const lu = materiaux?.toit?.meme_batiment && materiaux.toit.materiau !== 'indetermine' ? materiaux.toit : null
    note = p?.terrasse
      ? 'Plus basse que les égouts : hors du toit par défaut.'
      : `Surface vraie, pente comprise, mesurée dans les points LiDAR.${lu ? ` ${LIBELLES_TOIT[lu.materiau]} (${lu.couleur}), lu sur la photo aérienne.` : ''}`
  } else if (face.type === 'mur') {
    const f = releve.facades.find((x) => String(x.index) === face.ref)
    titre = `Façade ${face.orientation}${f?.retrait ? ', en retrait' : ''}`
    detail = f
      ? `${formatM2(f.surfaceLibre)} · ${formatM(f.longueur)} · ${f.hauteurHaute - f.hauteurBasse < 0.3 ? hauteur(f.hauteurBasse) : `${hauteur(f.hauteurBasse)} à ${hauteur(f.hauteurHaute)}`}`
      : ''
    // Les ouvertures lues sur la photo de cette façade, sans celles retirées.
    const photo = photoDeLaFacade(photos, face.orientation)
    const r = photo ? resultatRetenu(photo) : null
    const brute = facadeRetenue(releve, face.orientation).surface
    const ouvertures =
      r?.utilisable && r.surface != null
        ? `${r.nombre} ouverture${r.nombre > 1 ? 's' : ''} lue${r.nombre > 1 ? 's' : ''} (${formatM2(r.surface)}) : façade ${face.orientation} nette ${formatM2(Math.max(0, brute - r.surface))}.`
        : null
    const materiau = photo?.lecture?.vision.materiau ? ` ${photo.lecture.vision.materiau}.` : ''
    note = f?.retrait
      ? 'Mur déduit de l’égout au-dessus d’une terrasse : à vérifier sur place.'
      : face.mitoyen
        ? 'Mur mitoyen : hors surface.'
        : `${ouvertures ?? 'Ouvertures non déduites : photographiez la façade.'}${materiau}`
  } else {
    titre = TYPES_OUVERTURE[face.type_ouverture ?? 'autre'] ?? 'Ouverture'
    detail = `≈ ${formatM2(face.surface)} · façade ${face.orientation}`
    note = face.ecartee ? 'Retirée : elle n’est pas déduite de la façade.' : 'Lue sur la photo de la façade, déduite de sa surface.'
    if (face.photo && face.rang != null) {
      const { photo, rang } = face
      action = {
        libelle: face.ecartee ? 'La remettre' : 'Ce n’est pas une ouverture',
        faire: () => ecarter.mutate({ id: photo, rang, ecartee: !face.ecartee }),
      }
    }
  }
  return (
    <div className="absolute inset-x-3 bottom-3 z-[460] flex items-start gap-3 rounded-xl bg-card/95 p-3 shadow-card backdrop-blur">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{titre}</p>
        <p className="montant text-base font-semibold text-primary">{detail}</p>
        {note && <p className="text-[11px] leading-snug text-muted-foreground">{note}</p>}
        {action && (
          <Button size="sm" variant="outline" className="mt-1 min-h-9" disabled={ecarter.isPending} onClick={action.faire}>
            {ecarter.isPending && <Loader2 className="size-4 animate-spin" />}
            {action.libelle}
          </Button>
        )}
      </div>
      <button type="button" onClick={onFermer} aria-label="Fermer" className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-accent">
        <X className="size-4" />
      </button>
    </div>
  )
}
