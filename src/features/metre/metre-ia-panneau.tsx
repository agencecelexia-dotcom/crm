import { lazy, Suspense } from 'react'
import { AlertTriangle, Check, Circle, Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Point } from './geometrie'
import { ETAPES_PREVUES, PHASES_IA } from './phases-ia'
import { LIBELLES_VOLUME } from './scene-ia'
import type { ReponseMetreIA } from './use-metre-ia'

// Leaflet (≈ 155 Ko) ne se charge qu'à l'ouverture du panneau : la fiche du client, elle, s'affiche sans lui.
const CarteMaison = lazy(() => import('./carte-maison-ia'))

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

/**
 * Le déroulé, en quatre phases : les photos se prennent, l'IA les analyse (et
 * écarte les mauvaises), elle mesure, la 3D se construit. Chaque étape montre où
 * elle en est : faite, en cours, ou à venir.
 */
function Progression({ etapes }: { etapes: ReponseMetreIA['etapes'] }) {
  const faites = new Map((etapes ?? []).map((e) => [e.cle, e]))
  // La phase en cours : celle de la première étape qui n'est pas finie.
  const prochaine = ETAPES_PREVUES.find((e) => !faites.get(e.cle) || faites.get(e.cle)!.en_cours)
  const phaseCourante = prochaine?.phase ?? 4
  return (
    <ol className="space-y-3">
      {PHASES_IA.map((ph) => {
        const etapesPhase = ETAPES_PREVUES.filter((e) => e.phase === ph.numero)
        const finie = ph.numero < phaseCourante || etapesPhase.every((e) => faites.get(e.cle) && !faites.get(e.cle)!.en_cours)
        const courante = ph.numero === phaseCourante && !finie
        return (
          <li key={ph.numero} className={cn('space-y-1', !finie && !courante && 'opacity-50')}>
            <p className="flex items-center gap-2 text-sm font-medium">
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full text-[11px]',
                  finie ? 'bg-[#16A34A] text-white' : courante ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {finie ? <Check className="size-3" /> : ph.numero}
              </span>
              {ph.titre}
              {courante && <Loader2 className="size-3.5 animate-spin text-primary" />}
            </p>
            {courante && <p className="pl-7 text-xs text-muted-foreground">{ph.attente}</p>}
            {(courante || finie) && (
              <ul className="space-y-0.5 pl-7">
                {etapesPhase.map((e) => {
                  const f = faites.get(e.cle)
                  const enCours = !!f?.en_cours
                  return (
                    <li key={e.cle} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {f && !enCours ? <Check className="size-3 text-[#16A34A]" /> : enCours ? <Loader2 className="size-3 animate-spin" /> : <Circle className="size-3" />}
                      {e.libelle}
                      {f && !enCours && <span className="text-[11px]">{(f.ms / 1000).toFixed(f.ms < 10_000 ? 1 : 0).replace('.', ',')} s</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        )
      })}
      <li className="pl-7 text-[11px] text-muted-foreground">Une à deux minutes la première fois. Vous pouvez quitter l’écran : la lecture est gardée et la 3D apparaît à la fin.</li>
    </ol>
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
              <Suspense fallback={<div className="grid h-52 place-items-center rounded-xl border border-border"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}>
                <CarteMaison contour={contour} />
              </Suspense>
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

      {enCours && <Progression etapes={etat?.etapes ?? []} />}

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
          {etat.verif?.releve_ia && <p className="text-xs text-muted-foreground">{etat.verif.releve_ia}</p>}
          {etat.verif?.photos_ecartees && etat.verif.photos_ecartees.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {etat.verif.photos_ecartees.length} photo{etat.verif.photos_ecartees.length > 1 ? 's' : ''} de la rue écartée{etat.verif.photos_ecartees.length > 1 ? 's' : ''} :{' '}
              {etat.verif.photos_ecartees.map((p) => `façade ${p.orientation} (${p.raison})`).join(' ; ')}.
            </p>
          )}
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
