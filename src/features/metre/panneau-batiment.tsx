import { useState } from 'react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { pignonDe, surfaceMur, type Batiment } from './bati-ign'
import {
  distance,
  empriseAvecDebord,
  formatM,
  formatM2,
  surfaceReelle,
  type Facade,
} from './geometrie'
import { useFicheMaison } from './use-fiche-maison'
import {
  mesureFacade,
  partsNormalisees,
  penteRetenue,
  useToiture,
  versantsLisibles,
} from './use-toiture'

/** Pentes courantes, pour corriger d'un doigt ce que la BD TOPO propose. */
const PENTES = [0, 30, 35, 40, 45, 60, 80]

/**
 * Débords de toiture courants, en centimètres.
 *
 * Quarante centimètres par défaut : c'est la valeur de construction la plus
 * répandue, et l'erreur qu'elle évite va dans le sens qui compte. Sur une
 * maison de 80 m² au sol, l'oublier retire quinze mètres carrés de couverture
 * — soit de quoi manquer de tuiles en fin de chantier.
 */
const DEBORDS = [0, 30, 40, 50, 70]

/** Une hauteur mesurée au LiDAR vaut ±0,3 m : une décimale, pas deux. */
const formatHauteur = (n: number) => `${n.toFixed(1).replace('.', ',')} m`
const DEBORD_DEFAUT = 40

/** Surface moyenne d'une ouverture de maison : une fenêtre standard. */
const OUVERTURE_TYPE = 1.8

export interface MesureAEnregistrer {
  nom: string
  type: 'surface' | 'facade'
  geometrie: [number, number][]
  hauteur_m?: number | null
  pente_pct?: number | null
  ouvertures_m2?: number | null
  azimut?: number | null
  pente_source?: 'altitudes' | 'saisie' | 'lidar' | 'photogrammetrie' | null
  debord_m?: number | null
  part_toiture?: number | null
  versant?: string | null
  hauteur_source?: 'bati' | 'saisie' | 'lidar' | null
}

/**
 * Ce qu'on peut dire d'un bâtiment sans y aller.
 *
 * Deux métiers, deux onglets. Le couvreur veut une surface de toiture, donc
 * une pente. Le façadier veut UNE façade, donc un côté et ses ouvertures — pas
 * l'enveloppe entière du bâtiment, que personne ne vend.
 */
export function PanneauBatiment({
  batiment,
  onEnregistrer,
  enCours,
  onMurChoisi,
  token,
}: {
  batiment: Batiment
  onEnregistrer: (m: MesureAEnregistrer) => void
  enCours: boolean
  onMurChoisi: (f: Facade | null) => void
  token: string
}) {
  const [onglet, setOnglet] = useState<'toiture' | 'facades' | 'maison'>('toiture')
  const { data: fiche, isLoading: ficheEnCours } = useFicheMaison(
    token,
    batiment.cleabs,
    batiment.centre?.[1] ?? null,
    batiment.centre?.[0] ?? null,
  )

  // LA PENTE, PAR ORDRE DE CONFIANCE
  //
  // 1. ce que l'artisan saisit — il est sur le terrain, pas nous ;
  // 2. ce qu'on MESURE dans la grille d'altitudes de l'IGN, à 50 cm : ±2 à ±10
  //    points sur des maisons réelles ;
  // 3. ce qu'on DÉDUIT des altitudes de la BD TOPO, faute de mieux : ±27 à ±61
  //    points, que l'écran doit annoncer comme tels.
  const [penteSaisie, setPenteSaisie] = useState<number | null>(null)
  const { data: toitureIgn, isLoading: toitureEnCours } = useToiture(
    token,
    batiment.cleabs,
    batiment.contour,
  )
  const penteDeduite = batiment.toiture ? Math.round(batiment.toiture.pente) : null
  const { pente, source: origine, suggestion } = penteRetenue({
    saisie: penteSaisie,
    mesuree: toitureIgn,
    deduite: penteDeduite,
  })
  const penteMesuree = origine === 'lidar' || origine === 'photogrammetrie' ? pente : null
  const parLiDAR = origine === 'lidar'

  const [mur, setMur] = useState<Facade | null>(null)
  const [hauteurSaisie, setHauteurSaisie] = useState('')
  const [nbOuvertures, setNbOuvertures] = useState(0)

  // LA HAUTEUR D'UN MUR, PAR ORDRE DE CONFIANCE
  //
  // 1. celle que l'artisan tape — il a vu la maison, ou le client la lui a dite ;
  // 2. celle MESURÉE au LiDAR le long du mur, point par point : elle suit le
  //    pignon et le terrain, et chaque côté a la sienne ;
  // 3. à défaut, celle de la BD TOPO. Comparée au LiDAR sur quinze maisons, elle
  //    s'écarte de 3,6 à 4,8 m sur un tiers d'entre elles — l'écran le dit.
  const tapee = hauteurSaisie.trim() ? parseFloat(hauteurSaisie.replace(',', '.')) : null
  const hauteurTapee = tapee != null && Number.isFinite(tapee) && tapee > 0 ? tapee : null
  const ouvertures = nbOuvertures * OUVERTURE_TYPE
  const mesureMur = mur ? mesureFacade(mur, toitureIgn) : null
  // Un pignon monte plus haut que la gouttière : avec une hauteur unique, le
  // triangle sous la charpente s'ajoute à « longueur × hauteur ». Le profil
  // mesuré, lui, le contient déjà.
  const pignon = mur ? pignonDe(batiment, mur) : null
  const origineHauteur: 'saisie' | 'lidar' | 'bati' | null =
    hauteurTapee != null ? 'saisie' : mesureMur ? 'lidar' : batiment.hauteur ? 'bati' : null
  const surfaceBrute = !mur
    ? null
    : origineHauteur === 'saisie'
      ? surfaceMur(mur, hauteurTapee, 0, pignon)
      : origineHauteur === 'lidar'
        ? mesureMur!.surface
        : origineHauteur === 'bati'
          ? surfaceMur(mur, batiment.hauteur, 0, pignon)
          : null
  const surfaceFacade = surfaceBrute != null ? Math.max(0, surfaceBrute - ouvertures) : null
  // Le serveur recalcule « longueur des pans × hauteur ». Pour qu'il retrouve
  // la surface affichée — profil mesuré ou pignon compris — on lui envoie la
  // hauteur ÉQUIVALENTE, rapportée à la longueur qu'il mesure lui-même : la
  // somme des pans d'un bout à l'autre. Sans cela l'écran montrait 49 m² sur
  // un pignon quand la base en gardait 44,8.
  const longueurServeur = mur ? mur.pans.reduce((s, p) => s + distance(p.a, p.b), 0) : 0
  const hauteurEquivalente =
    surfaceBrute != null && longueurServeur > 0 ? surfaceBrute / longueurServeur : null
  // LE TOIT DÉBORDE DES MURS, et le contour ne le montre pas : vérifié contre
  // le cadastre, celui de la BD TOPO est bien celui du bâtiment au sol. Le
  // débord n'est pas mesurable — le LiDAR a une maille de 50 cm et son bord de
  // toit est flou d'autant — donc on ne l'annonce pas comme mesuré : on le
  // montre, chiffré à part, et l'artisan le corrige d'un doigt.
  const [debordCm, setDebordCm] = useState(DEBORD_DEFAUT)
  const empriseToit = empriseAvecDebord(batiment.emprise, batiment.perimetre, debordCm / 100)
  // Sans pente connue, il n'y a PAS de surface de toiture à afficher : la
  // surface au sol n'en est pas une, et un toit plat n'est pas un toit inconnu.
  const toiture = pente != null ? surfaceReelle(empriseToit, pente) : null
  const gainDebord = pente != null ? surfaceReelle(empriseToit, pente) - surfaceReelle(batiment.emprise, pente) : null

  // UN COUVREUR NE REFAIT PAS TOUJOURS TOUT LE TOIT. Le relevé sépare les
  // versants par leur exposition ; l'artisan en choisit un et lit sa surface,
  // au lieu de diviser le total par deux de tête.
  const versants = partsNormalisees(toitureIgn)
  const [versantChoisi, setVersantChoisi] = useState<string | null>(null)
  const partRetenue = versantChoisi
    ? (versants.find((v) => v.orientation === versantChoisi)?.part ?? 1)
    : 1
  const surfaceRetenue = toiture != null ? toiture * partRetenue : null

  function choisirMur(m: Facade | null) {
    setMur(m)
    onMurChoisi(m)
  }

  return (
    <>
      {/* L'alerte qui change un devis de ravalement : dans le périmètre des
          500 m d'un monument, l'Architecte des Bâtiments de France impose les
          teintes, la déclaration préalable devient obligatoire et le délai
          d'instruction s'allonge de deux mois. */}
      {fiche?.urbanisme?.abf && (
        <div className="flex items-start gap-2 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-2.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#B45309]" />
          <p className="text-xs text-[#B45309]">
            <strong>Abords de monument historique.</strong> Teintes et matériaux soumis à
            l’Architecte des Bâtiments de France, déclaration préalable obligatoire, deux mois
            d’instruction en plus.
            {fiche.urbanisme.abf_motifs.length > 0 && ` — ${fiche.urbanisme.abf_motifs[0]}`}
          </p>
        </div>
      )}

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {(['toiture', 'facades', 'maison'] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => {
              setOnglet(o)
              if (o === 'toiture') choisirMur(null)
            }}
            className={cn(
              'flex-1 rounded-md py-1.5 text-sm transition-colors',
              onglet === o ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground',
            )}
          >
            {o === 'toiture' ? 'Toiture' : o === 'facades' ? 'Façades' : 'La maison'}
          </button>
        ))}
      </div>

      {onglet === 'toiture' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Chiffre titre="Emprise au sol" valeur={formatM2(batiment.emprise)} />
            <Chiffre
              titre={
                pente == null
                  ? 'Toiture'
                  : versantChoisi
                    ? `Versant ${versantChoisi} à ${pente} %`
                    : `Toiture à ${pente} %`
              }
              valeur={surfaceRetenue != null ? formatM2(surfaceRetenue) : 'Pente à choisir'}
              fort
              enAttente={surfaceRetenue == null}
            />
            {batiment.encombrement && (
              <Chiffre
                titre="Dimensions"
                valeur={`${formatM(batiment.encombrement.longueur)} × ${formatM(batiment.encombrement.largeur)}`}
              />
            )}
            {toitureIgn?.hauteur_gouttiere != null ? (
              <Chiffre
                titre="Gouttière · faîtage (mesurés)"
                valeur={`${formatHauteur(toitureIgn.hauteur_gouttiere)} · ${formatHauteur(toitureIgn.hauteur_faitage ?? 0)}`}
              />
            ) : null}
            <Chiffre titre="Périmètre" valeur={formatM(batiment.perimetre)} />
          </div>

          {/* D'OÙ VIENT LA PENTE — jamais un chiffre sans sa provenance. */}
          {toitureEnCours ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Mesure de la pente dans les altitudes de l’IGN…
            </p>
          ) : penteSaisie != null ? (
            <p className="text-xs text-muted-foreground">Pente saisie par vos soins.</p>
          ) : penteMesuree != null ? (
            <p className="text-xs text-muted-foreground">
              Pente <strong className="text-foreground">mesurée</strong> sur {toitureIgn?.pixels}{' '}
              points du toit&nbsp;:{' '}
              <strong className="text-foreground">{penteMesuree} %</strong>
              {toitureIgn?.incertitude ? ` ± ${toitureIgn.incertitude}` : ''}.{' '}
              {parLiDAR
                ? 'Relevé LiDAR de l’IGN, grille de 50 cm.'
                : 'Photogrammétrie de l’IGN, grille de 1 m — moins fine que le LiDAR, absent ici.'}
              {versantsLisibles(toitureIgn?.versants) &&
                ` Deux versants, ${versantsLisibles(toitureIgn?.versants)}.`}
            </p>
          ) : toitureIgn && toitureIgn.couvert && !toitureIgn.fiable ? (
            // Un îlot urbain n'a pas de pan dominant : servir une médiane et son
            // écart interquartile reviendrait à habiller du bruit en mesure.
            <p className="text-xs text-[#B45309]">
              Les altitudes de ce toit ne montrent pas deux versants nets&nbsp;: il est trop
              découpé pour qu’une pente unique ait un sens. Saisissez-la.
            </p>
          ) : toitureIgn && !toitureIgn.couvert ? (
            <p className="text-xs text-[#B45309]">
              {toitureIgn.motif === 'hors_couverture'
                ? 'Aucun relevé d’altitude de l’IGN ne couvre ce bâtiment.'
                : 'Ce bâtiment est trop petit pour que sa pente se lise dans les altitudes — ' +
                  'vérifiez que c’est bien la maison, et non un abri.'}{' '}
              Saisissez la pente.
            </p>
          ) : (
            // Ni mesure fiable, ni choix de l'artisan. La pente DÉDUITE de deux
            // altitudes de la BD TOPO (±27 à ±61 points) n'est qu'une piste : on
            // la propose, on ne la retient pas à sa place.
            <p className="text-xs text-[#B45309]">
              La pente de ce toit n’a pas pu être mesurée&nbsp;: choisissez-la ci-dessous.
              {suggestion != null &&
                ` L’IGN suggère environ ${suggestion} %, sans garantie — à vérifier avec le client.`}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Pente&nbsp;:</span>
            {/* Revenir à la valeur de l'IGN : une fois une pastille touchée,
                elle était perdue. */}
            {penteSaisie != null && toitureIgn?.fiable && toitureIgn.pente != null && (
              <button
                type="button"
                onClick={() => setPenteSaisie(null)}
                className="rounded-full border border-border bg-card px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
              >
                Mesurée&nbsp;: {Math.round(toitureIgn.pente)} %
              </button>
            )}
            {/* La suggestion de la BD TOPO, à reprendre d'un geste : elle devient
                alors le choix de l'artisan, et c'est écrit comme tel. */}
            {pente == null && suggestion != null && (
              <button
                type="button"
                onClick={() => setPenteSaisie(suggestion)}
                className="rounded-full border border-dashed border-[#B45309]/60 bg-card px-2.5 py-1.5 text-xs text-[#B45309] transition-colors hover:bg-accent"
              >
                ≈ {suggestion} % (IGN)
              </button>
            )}
            {PENTES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPenteSaisie(p)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors',
                  pente === p
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border bg-card hover:bg-accent',
                )}
              >
                {p === 0 ? 'plate' : `${p} %`}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Débord&nbsp;:</span>
            {DEBORDS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDebordCm(d)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors',
                  debordCm === d
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border bg-card hover:bg-accent',
                )}
              >
                {d === 0 ? 'aucun' : `${d} cm`}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {debordCm > 0 ? (
              <>
                Le contour est celui des murs&nbsp;; le toit dépasse de {debordCm} cm à l’égout,
                {gainDebord != null ? (
                  <>
                    soit <strong className="text-foreground">{formatM2(gainDebord)}</strong> en plus.
                  </>
                ) : (
                  'à ajouter à la surface une fois la pente choisie.'
                )}
                Ce débord n’est pas mesurable sur les données de l’IGN&nbsp;: à vous de le régler.
              </>
            ) : (
              <>
                Sans débord, la surface est celle du toit à l’aplomb des murs
                {pente != null && toiture != null ? (
                  <>
                    {' '}
                    — en général{' '}
                    {formatM2(
                      surfaceReelle(empriseAvecDebord(batiment.emprise, batiment.perimetre, 0.4), pente) -
                        toiture,
                    )}{' '}
                    de moins que le toit réel.
                  </>
                ) : (
                  ', plus petite que le toit réel.'
                )}
              </>
            )}
          </p>

          {/* Les versants, quand le relevé en distingue. Toucher un versant le
              met seul en avant ; le retoucher rend tout le toit. */}
          {versants.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Versant&nbsp;:</span>
              {versants.map((v) => (
                <button
                  key={v.orientation}
                  type="button"
                  onClick={() =>
                    setVersantChoisi(versantChoisi === v.orientation ? null : v.orientation)
                  }
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs transition-colors',
                    versantChoisi === v.orientation
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'border-border bg-card hover:bg-accent',
                  )}
                >
                  {v.orientation} · {formatM2((toiture ?? 0) * v.part)}
                </button>
              ))}
              {versantChoisi && (
                <button
                  type="button"
                  onClick={() => setVersantChoisi(null)}
                  className="rounded-full border border-border bg-card px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
                >
                  tout le toit
                </button>
              )}
            </div>
          )}
          {versants.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Surfaces de versant approchées&nbsp;: elles supposent la même pente de chaque côté,
              ce qui est le cas courant.
            </p>
          )}

          <Garder
            enCours={enCours}
            desactive={pente == null}
            defaut={versantChoisi ? `Toiture versant ${versantChoisi}` : batiment.nature || 'Toiture'}
            onGarder={(nom) =>
              onEnregistrer({
                nom,
                type: 'surface',
                geometrie: batiment.contour,
                // La hauteur MESURÉE à la gouttière, jamais celle de la BD TOPO
                // (fausse de 3,6 à 4,8 m sur un tiers des maisons comparées).
                hauteur_m: toitureIgn?.hauteur_gouttiere ?? null,
                // 0 = toit plat, choisi. `null` n'arrive plus ici : le bouton est
                // désactivé tant que la pente est inconnue.
                pente_pct: pente,
                pente_source: origine,
                hauteur_source: toitureIgn?.hauteur_gouttiere != null ? 'lidar' : null,
                debord_m: debordCm / 100,
                part_toiture: partRetenue,
                versant: versantChoisi,
              })
            }
          />
        </>
      ) : onglet === 'facades' ? (
        <>
          {/* Un côté du bâtiment = une façade, nommée par son orientation. */}
          <div className="flex flex-wrap gap-1.5">
            {batiment.facades.map((m) => (
              <button
                key={m.orientation}
                type="button"
                onClick={() => choisirMur(mur?.orientation === m.orientation ? null : m)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors',
                  mur?.orientation === m.orientation
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border bg-card hover:bg-accent',
                )}
              >
                {m.orientation} · {formatM(m.longueur)}
                {m.pans.length > 1 && (
                  <span className="ml-1 opacity-70">({m.pans.length} pans)</span>
                )}
              </button>
            ))}
          </div>

          {mur ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Chiffre
                  titre={`Façade ${mur.orientation}`}
                  valeur={surfaceFacade != null ? formatM2(surfaceFacade) : '—'}
                  fort
                />
                <Chiffre
                  // « Pignon » vient d'une supposition géométrique (côté court,
                  // perpendiculaire au faîtage). Quand le mur est MESURÉ, c'est
                  // son profil qui parle : sur un toit en croupe il est plat, et
                  // l'étiquette aurait menti.
                  titre={origineHauteur !== 'lidar' && pignon ? 'Longueur (pignon)' : 'Longueur'}
                  valeur={formatM(mur.longueur)}
                />
              </div>

              {/* D'OÙ VIENT LA HAUTEUR — jamais un chiffre sans sa provenance.
                  Avant, 6,8 m s'affichait en gris dans un champ vide : on le
                  lisait comme « pas de hauteur », et c'était une valeur de la
                  BD TOPO fausse de plusieurs mètres une fois sur trois. */}
              {toitureEnCours && !hauteurTapee ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Mesure de la hauteur du mur dans les altitudes de l’IGN…
                </p>
              ) : origineHauteur === 'saisie' ? (
                <p className="text-xs text-muted-foreground">
                  Hauteur saisie par vos soins&nbsp;: {formatM(hauteurTapee!)}
                  {pignon ? ' à la gouttière, pignon ajouté.' : '.'}
                </p>
              ) : origineHauteur === 'lidar' ? (
                <p className="text-xs text-muted-foreground">
                  Hauteur <strong className="text-foreground">mesurée</strong> le long du mur au
                  LiDAR de l’IGN&nbsp;:{' '}
                  <strong className="text-foreground">{formatHauteur(mesureMur!.hauteurMoyenne)}</strong> en
                  moyenne, de {formatHauteur(mesureMur!.hauteurMin)} à {formatHauteur(mesureMur!.hauteurMax)}.
                  {mesureMur!.hauteurMax - mesureMur!.hauteurMin > 1.5 &&
                    ' Le mur n’a pas partout la même hauteur (pignon ou terrain en pente) : la surface en tient compte.'}
                </p>
              ) : origineHauteur === 'bati' ? (
                <p className="text-xs text-[#B45309]">
                  Hauteur <strong>non mesurée</strong> ici&nbsp;: {formatM(batiment.hauteur!)} selon
                  la BD TOPO de l’IGN, qui s’écarte de plusieurs mètres sur une maison sur trois.
                  Vérifiez-la et corrigez-la ci-dessous.
                </p>
              ) : (
                <p className="text-xs text-[#B45309]">
                  Hauteur inconnue&nbsp;: saisissez-la pour obtenir la surface.
                </p>
              )}
              {origineHauteur === 'lidar' &&
                mesureMur!.longueurAccolee > 0.5 * longueurServeur && (
                  <p className="text-xs text-[#B45309]">
                    Sur {formatM(mesureMur!.longueurAccolee)}, ce mur touche un autre volume —
                    maison mitoyenne ou annexe accolée. Cette partie n’est peut-être pas à traiter.
                  </p>
                )}

              <div className="flex items-end gap-2">
                <label className="flex-1 space-y-1">
                  <span className="text-xs text-muted-foreground">
                    {origineHauteur === 'lidar' || origineHauteur === 'bati'
                      ? 'Corriger la hauteur'
                      : `Hauteur${pignon ? ' à la gouttière' : ''}`}
                  </span>
                  <div className="relative">
                    <Input
                      className="h-10 pr-8"
                      inputMode="decimal"
                      placeholder="ex. 5,8"
                      value={hauteurSaisie}
                      onChange={(e) => setHauteurSaisie(e.target.value)}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      m
                    </span>
                  </div>
                </label>
                <div className="flex-1 space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Ouvertures ({formatM2(ouvertures)})
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-10 shrink-0"
                      aria-label="Une ouverture de moins"
                      onClick={() => setNbOuvertures((n) => Math.max(0, n - 1))}
                    >
                      −
                    </Button>
                    <span className="montant flex-1 text-center text-base font-medium">
                      {nbOuvertures}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-10 shrink-0"
                      aria-label="Une ouverture de plus"
                      onClick={() => setNbOuvertures((n) => n + 1)}
                    >
                      +
                    </Button>
                  </div>
                </div>
              </div>

              <Garder
                enCours={enCours}
                defaut={`Façade ${mur.orientation}`}
                desactive={surfaceFacade == null}
                onGarder={(nom) =>
                  onEnregistrer({
                    nom,
                    type: 'facade',
                    geometrie: mur.pans.flatMap((p) => [p.a, p.b]),
                    hauteur_m: hauteurEquivalente,
                    ouvertures_m2: ouvertures > 0 ? ouvertures : null,
                    azimut: mur.azimut,
                    hauteur_source: origineHauteur,
                  })
                }
              />
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Choisissez la façade à chiffrer. Chaque côté du bâtiment en est une.
            </p>
          )}
        </>
      ) : (
        <FicheMaison fiche={fiche} enCours={ficheEnCours} />
      )}
    </>
  )
}

/**
 * Ce que l'État sait de cette maison.
 *
 * Six sources publiques et gratuites. Aucune n'est garantie : la BDNB ne
 * couvre pas tout, le DPE concerne quatre logements sur dix. On ne montre donc
 * que ce qui a répondu, et on le dit quand rien ne répond — une absence de
 * donnée n'est pas une donnée.
 */
function FicheMaison({
  fiche,
  enCours,
}: {
  fiche: ReturnType<typeof useFicheMaison>['data']
  enCours: boolean
}) {
  if (enCours) {
    return (
      <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Interrogation des bases publiques…
      </p>
    )
  }
  if (!fiche?.ok) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Aucune donnée publique sur ce bâtiment.
      </p>
    )
  }

  const b = fiche.bdnb
  const d = fiche.dpe?.recent
  const lignes: [string, string][] = []

  if (b?.annee_construction) lignes.push(['Construite en', String(b.annee_construction)])
  else if (d?.annee_construction) lignes.push(['Construite en', String(d.annee_construction)])
  if (b?.nb_niveau) lignes.push(['Niveaux', String(b.nb_niveau)])
  if (d?.surface_habitable_logement)
    lignes.push(['Surface habitable', `${d.surface_habitable_logement} m²`])
  // La BDNB écrit « INDETERMINE » quand elle ne sait pas : ce n'est pas une
  // information, c'est une absence.
  const materiau = (v?: string | null) =>
    v && !/^ind[eé]termin/i.test(v) && !/^indiff/i.test(v) ? v : null
  const murs = materiau(b?.mat_mur_txt)
  const toit = materiau(b?.mat_toit_txt)
  if (murs) lignes.push(['Murs', murs])
  if (toit) lignes.push(['Toiture', toit])
  if (d?.qualite_isolation_murs) lignes.push(['Isolation des murs', d.qualite_isolation_murs])
  if (d?.isolation_toiture != null)
    lignes.push(['Toiture isolée', d.isolation_toiture ? 'oui' : 'non'])
  if (d?.qualite_isolation_menuiseries)
    lignes.push(['Menuiseries', d.qualite_isolation_menuiseries])
  if (d?.etiquette_dpe) lignes.push(['Étiquette énergie', d.etiquette_dpe])
  if (fiche.urbanisme?.zonage) lignes.push(['Zone du PLU', fiche.urbanisme.zonage])
  if (fiche.cadastre?.contenance) lignes.push(['Terrain', `${fiche.cadastre.contenance} m²`])
  // Géorisques répond parfois 200 avec un corps vide — trois fiches sur sept
  // lors de l'audit. La BDNB porte le même aléa : on s'en sert en secours.
  const argile = fiche.risques?.argile ?? b?.alea_argile ?? null
  if (argile) lignes.push(['Retrait-gonflement argile', argile])

  if (lignes.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Les bases publiques ne connaissent pas ce bâtiment.
      </p>
    )
  }

  return (
    <>
      <dl className="divide-y divide-border rounded-xl border border-border">
        {lignes.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
            <dt className="min-w-0 shrink text-muted-foreground">{k}</dt>
            <dd className="shrink-0 text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Sources publiques : BD nationale des bâtiments, DPE de l’ADEME, Géoportail de
        l’urbanisme, Géorisques, cadastre.
        {fiche.dpe?.approche && ' Le DPE est celui du logement le plus proche, à vérifier.'}
      </p>
    </>
  )
}

function Garder({
  defaut,
  onGarder,
  enCours,
  desactive,
}: {
  defaut: string
  onGarder: (nom: string) => void
  enCours: boolean
  desactive?: boolean
}) {
  const [nom, setNom] = useState('')
  return (
    <div className="flex gap-2">
      <Input
        className="h-10 flex-1"
        placeholder={defaut}
        value={nom}
        onChange={(e) => setNom(e.target.value)}
      />
      <Button onClick={() => onGarder(nom.trim() || defaut)} disabled={enCours || desactive}>
        {enCours ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Garder
      </Button>
    </div>
  )
}

function Chiffre({
  titre,
  valeur,
  fort,
  enAttente,
}: {
  titre: string
  valeur: string
  fort?: boolean
  /** Pas encore de chiffre : une consigne, écrite plus petit pour tenir dans la case. */
  enAttente?: boolean
}) {
  return (
    <div className={cn('rounded-xl border border-border p-2.5', fort && 'bg-primary/5')}>
      {/* Sur deux lignes plutôt que coupé : « (mesurés) » disparaissait. */}
      <p className="line-clamp-2 text-xs leading-tight text-muted-foreground">{titre}</p>
      <p
        className={cn(
          'montant truncate',
          enAttente
            ? 'pt-1 text-sm font-medium text-[#B45309]'
            : fort
              ? 'text-lg font-semibold text-primary'
              : 'text-sm',
        )}
      >
        {valeur}
      </p>
    </div>
  )
}
