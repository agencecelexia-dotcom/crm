import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Loader2, MapPinOff } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ecartesParDefaut, moisDuVol } from './affichage-releve'
import { ExportsMetre } from './exports-metre'
import { FicheFace3D } from './fiche-face-3d'
import { formatM, formatM2 } from './geometrie'
import { MateriauToit } from './materiau-toit'
import { PanneauMetreIA } from './metre-ia-panneau'
import { modeleDuReleve, type Face3D } from './modele3d'
import { photoDeLaFacade } from './ouvertures'
import { PhotosFacade } from './photo-facade'
import { rapportMetre } from './rapport-metre'
import type { Point } from './geometrie'
import { useMetreIA } from './use-metre-ia'
import { useMateriauxToit, usePhotosFacade } from './use-photos-facade'
import { JETON_AGENCE, releveUtilisable, useReleve } from './use-releve'
import type { OutilsVue3D } from './vue-3d'

// La 3D (Three.js, ~150 Ko) ne se charge qu'ici.
const Vue3D = lazy(() => import('./vue-3d'))

const pct = (n: number) => `${String(Math.round(n * 10) / 10).replace('.', ',')} %`

/**
 * LA MAISON EN 3D, VUE DE L'AGENCE : le relevé LiDAR de l'IGN mis en volume,
 * ses pans, ses murs, ses ouvertures lues sur les photos, et tous ses métrés
 * à côté — sans artisan, depuis la fiche du client ou une simple adresse.
 * Toucher une face donne sa fiche ; le rapport part en PDF ou en tableau.
 */
export function Maison3D({
  cleabs,
  point,
  titre,
  adresse,
  contour = null,
}: {
  cleabs: string
  point: Point | null
  titre: string | null
  adresse: string | null
  /** Le contour de la maison retenue : pour la reconnaître sur la photo avant de lancer l'IA. */
  contour?: Point[] | null
}) {
  const t = JETON_AGENCE
  const { data: rep, isLoading, error } = useReleve(t, cleabs, point)
  const releve = releveUtilisable(rep?.releve) ? rep!.releve! : null
  const { data: photos } = usePhotosFacade(t, cleabs, !!releve)
  const { data: materiaux } = useMateriauxToit(t, cleabs, !!releve)
  const ia = useMetreIA(t, cleabs, point)
  // Les façades lues par l'IA sont en base quand sa lecture finit : les photos se relisent alors.
  const statutIA = ia.statut
  const relirePhotos = ia.refaire
  // La 3D n'apparaît qu'une fois la lecture par l'IA finie (ou si l'on demande l'aperçu sans l'IA) ; à la fin, l'écran y descend.
  const [apercu, setApercu] = useState(false)
  const zone3d = useRef<HTMLDivElement>(null)
  const etaitEnCours = useRef(false)
  useEffect(() => {
    if (statutIA === 'en_cours') etaitEnCours.current = true
    if (statutIA === 'fait') {
      relirePhotos()
      if (etaitEnCours.current) {
        etaitEnCours.current = false
        setTimeout(() => zone3d.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
      }
    }
  }, [statutIA, relirePhotos])
  const montrer3d = statutIA === 'fait' || apercu
  const donneesIA = ia.etat.data
  const lectureIA = useMemo(
    () => (donneesIA?.statut === 'fait' && donneesIA.scene && donneesIA.niveaux ? { scene: donneesIA.scene, niveaux: donneesIA.niveaux } : null),
    [donneesIA],
  )
  const [face, setFace] = useState<Face3D | null>(null)
  const [facade, setFacade] = useState<string | null>(null)
  const [pret3d, setPret3d] = useState(false)
  const [cotes, setCotes] = useState(true)
  const outils3d = useRef<OutilsVue3D | null>(null)

  const modele = useMemo(() => {
    if (!releve?.origine || !releve.pans.every((p) => p.plan)) return null
    const vues = [...new Set((photos ?? []).map((p) => p.orientation))]
      .map((o) => photoDeLaFacade(photos ?? [], o))
      .filter((p) => p?.lecture && p.lecture.resultat.motif !== 'autre_batiment')
      .map((p) => ({ orientation: p!.orientation, lecture: p!.lecture!.vision, photo: p!.id, ecartees: p!.ecartees }))
    return modeleDuReleve(releve, vues, lectureIA)
  }, [releve, photos, lectureIA])
  const rapport = useMemo(
    () => (releve ? rapportMetre({ titre, adresse, date: new Date(), releve, pans: null, photos: photos ?? [], materiaux: materiaux ?? null }) : null),
    [releve, photos, materiaux, titre, adresse],
  )

  const enCours = isLoading || rep?.statut === 'en_cours' || (rep?.trouve === false && !error)
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 font-medium">
          <Box className="size-4 text-primary" />
          La maison en 3D
        </h2>
        {releve && (
          <span className="text-xs text-muted-foreground">
            Relevé LiDAR de l’IGN{releve.vol ? `, vol de ${moisDuVol(releve.vol)}` : ''} · mesuré à distance, à confirmer sur place
          </span>
        )}
      </div>

      <PanneauMetreIA
        etat={ia.etat.data}
        enCours={ia.enCours}
        onLancer={() => ia.lancer.mutate()}
        erreur={ia.lancer.data?.ok === false ? (ia.lancer.data.error ?? 'echec') : ia.lancer.isError ? 'echec' : null}
        contour={contour}
        adresse={adresse}
      />

      <div ref={zone3d} />
      {!montrer3d ? (
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm text-muted-foreground">
          <span>La maison apparaîtra en 3D dès que l’IA aura fini sa lecture.</span>
          {releve && (
            <button type="button" className="text-xs underline underline-offset-2 hover:text-foreground" onClick={() => setApercu(true)}>
              Voir l’aperçu sans l’IA
            </button>
          )}
        </div>
      ) : !releve ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          {enCours ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Relevé de la maison dans les points LiDAR de l’IGN, une à deux minutes la première fois…
            </>
          ) : (
            <>
              <MapPinOff className="size-4" />
              {rep?.statut === 'hors_couverture'
                ? 'L’IGN n’a pas encore survolé cette commune en LiDAR : pas de 3D ici pour l’instant.'
                : 'Le relevé de cette maison n’a pas abouti.'}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-[minmax(0,1fr)_300px]">
            <div className="relative h-[340px] bg-background md:h-[460px]">
              {modele ? (
                <Suspense
                  fallback={
                    <div className="grid size-full place-items-center">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <Vue3D
                    modele={modele}
                    cotes={cotes}
                    pansEcartes={ecartesParDefaut(releve)}
                    choisie={face}
                    onChoisir={(f) => {
                      setFace(f)
                      if (f && f.type !== 'pan' && !f.complement) setFacade(f.orientation)
                    }}
                    onPret={(o) => {
                      outils3d.current = o
                      setPret3d(!!o)
                    }}
                  />
                </Suspense>
              ) : (
                <p className="grid size-full place-items-center p-6 text-center text-sm text-muted-foreground">
                  Relevé ancien : la 3D arrive au prochain relevé de la maison.
                </p>
              )}
              {modele && (
                <button
                  type="button"
                  onClick={() => setCotes((v) => !v)}
                  aria-pressed={cotes}
                  className={cn(
                    'absolute right-3 top-3 z-[450] min-h-9 rounded-full border px-3 text-xs shadow-card backdrop-blur',
                    cotes ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-card/90',
                  )}
                >
                  Cotes
                </button>
              )}
              {face && modele && (
                <FicheFace3D
                  face={modele.faces.find((f) => f.type === face.type && f.ref === face.ref) ?? face}
                  releve={releve}
                  photos={photos ?? []}
                  materiaux={materiaux ?? null}
                  token={t}
                  cleabs={cleabs}
                  onFermer={() => setFace(null)}
                />
              )}
              {!face && modele && (
                <p className="pointer-events-none absolute inset-x-3 bottom-3 text-center text-[11px] text-muted-foreground">
                  Un doigt tourne, deux doigts zooment. Touchez un pan, un mur ou une fenêtre.
                </p>
              )}
            </div>

            {rapport && (
              <div className="space-y-3 border-t border-border p-4 md:border-l md:border-t-0">
                <div className="grid grid-cols-2 gap-2">
                  <Chiffre titre="Toiture" valeur={formatM2(rapport.toiture.surface)} detail={`${rapport.toiture.nombre} pans, pente ${pct(rapport.toiture.penteDesPans)}`} fort />
                  <Chiffre
                    titre={rapport.totalFacades.nette != null ? 'Façades nettes' : 'Façades brutes'}
                    valeur={formatM2(rapport.totalFacades.nette ?? rapport.totalFacades.brute)}
                    detail={rapport.totalFacades.nette != null ? `brutes ${formatM2(rapport.totalFacades.brute)}` : 'ouvertures non déduites'}
                    fort
                  />
                  <Chiffre titre="Gouttière" valeur={rapport.hauteurs.gouttiere != null ? formatM(rapport.hauteurs.gouttiere) : '—'} />
                  <Chiffre titre="Faîtage" valeur={rapport.hauteurs.faitage != null ? formatM(rapport.hauteurs.faitage) : '—'} />
                </div>
                {rapport.toiture.debord && <p className="text-xs text-muted-foreground">Débord mesuré : {rapport.toiture.debord}.</p>}

                {rapport.lineaires.length > 0 && (
                  <dl className="space-y-1 text-sm">
                    {rapport.lineaires.map((l) => (
                      <div key={l.type} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{l.libelle}</dt>
                        <dd className="montant">{formatM(l.longueur)}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <dl className="space-y-1 border-t border-border pt-2 text-sm">
                  {rapport.facades.map((f) => (
                    <div key={f.orientation} className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">
                        Façade {f.orientation}
                        {f.rue ? ' (rue)' : ''}
                      </dt>
                      <dd className="montant">
                        {f.brute > 0 ? (f.nette != null ? `${formatM2(f.nette)} nette` : formatM2(f.brute)) : 'mitoyenne'}
                      </dd>
                    </div>
                  ))}
                </dl>

                <MateriauToit token={t} cleabs={cleabs} bdnb={null} />
                <ExportsMetre
                  token={t}
                  cleabs={cleabs}
                  releve={releve}
                  pans={null}
                  titre={titre}
                  adresse={adresse}
                  bdnb={null}
                  outils3d={pret3d ? outils3d : undefined}
                />
              </div>
            )}
          </div>

          {/* Les façades en photo : les ouvertures lues s'y déduisent. */}
          {rapport && (
            <div className="space-y-2 border-t border-border p-4">
              <p className="text-sm font-medium">Les façades en photo</p>
              <div className="flex flex-wrap gap-1.5">
                {rapport.facades
                  .filter((f) => f.brute > 0)
                  .map((f) => (
                    <button
                      key={f.orientation}
                      type="button"
                      onClick={() => setFacade(facade === f.orientation ? null : f.orientation)}
                      className={cn(
                        'min-h-10 rounded-full border px-3 text-sm transition-colors',
                        facade === f.orientation ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-card hover:bg-accent',
                      )}
                    >
                      {f.orientation}
                      {f.ouvertures ? ` · ${f.ouvertures.nombre} ouv.` : ''}
                    </button>
                  ))}
              </div>
              {facade && (
                <div className="max-w-xl">
                  <PhotosFacade
                    token={t}
                    cleabs={cleabs}
                    orientation={facade}
                    hauteurReleve={rapport.facades.find((f) => f.orientation === facade)?.hauteurMin ?? null}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function Chiffre({ titre, valeur, detail, fort }: { titre: string; valeur: string; detail?: string; fort?: boolean }) {
  return (
    <div className="rounded-xl border border-border p-2.5">
      <p className="text-xs text-muted-foreground">{titre}</p>
      <p className={cn('montant font-semibold', fort ? 'text-lg text-primary' : 'text-base')}>{valeur}</p>
      {detail && <p className="text-[11px] leading-snug text-muted-foreground">{detail}</p>}
    </div>
  )
}
