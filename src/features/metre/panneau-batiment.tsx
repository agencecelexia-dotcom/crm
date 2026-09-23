import { useState } from 'react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { pignonDe, surfaceMur, type Batiment } from './bati-ign'
import { formatM, formatM2, surfaceReelle, type Mur } from './geometrie'
import { useFicheMaison } from './use-fiche-maison'

/** Pentes courantes, pour corriger d'un doigt ce que la BD TOPO propose. */
const PENTES = [0, 30, 35, 40, 45, 60, 80]

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
  pente_source?: 'altitudes' | 'saisie' | null
  hauteur_source?: 'bati' | 'saisie' | null
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
  onMurChoisi: (m: Mur | null) => void
  token: string
}) {
  const [onglet, setOnglet] = useState<'toiture' | 'facades' | 'maison'>('toiture')
  const { data: fiche, isLoading: ficheEnCours } = useFicheMaison(
    token,
    batiment.cleabs,
    batiment.centre?.[1] ?? null,
    batiment.centre?.[0] ?? null,
  )

  // La pente vient des altitudes de la BD TOPO ; l'artisan peut la corriger,
  // et on retient alors qu'elle est saisie et non déduite.
  const [penteSaisie, setPenteSaisie] = useState<number | null>(null)
  const pente = penteSaisie ?? Math.round(batiment.toiture?.pente ?? 0)
  const penteDeduite = penteSaisie == null && batiment.toiture != null

  const [mur, setMur] = useState<Mur | null>(null)
  const [hauteurSaisie, setHauteurSaisie] = useState('')
  const [nbOuvertures, setNbOuvertures] = useState(0)

  const hauteur = hauteurSaisie.trim()
    ? parseFloat(hauteurSaisie.replace(',', '.'))
    : (batiment.hauteur ?? null)
  const ouvertures = nbOuvertures * OUVERTURE_TYPE
  // Un pignon monte plus haut que la gouttière : le triangle sous la
  // charpente s'ajoute à « longueur × hauteur ».
  const pignon = mur ? pignonDe(batiment, mur) : null
  const surfaceFacade = mur ? surfaceMur(mur, hauteur, ouvertures, pignon) : null
  const toiture = surfaceReelle(batiment.emprise, pente)

  function choisirMur(m: Mur | null) {
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
            <Chiffre titre={`Toiture à ${pente} %`} valeur={formatM2(toiture)} fort />
            {batiment.encombrement && (
              <Chiffre
                titre="Dimensions"
                valeur={`${formatM(batiment.encombrement.longueur)} × ${formatM(batiment.encombrement.largeur)}`}
              />
            )}
            {batiment.hauteur != null && (
              <Chiffre titre="Hauteur à la gouttière" valeur={formatM(batiment.hauteur)} />
            )}
            <Chiffre titre="Périmètre" valeur={formatM(batiment.perimetre)} />
          </div>

          {/* La pente, déduite des altitudes plutôt que devinée — avec son
              incertitude, qui est grande sur une petite maison. */}
          {!batiment.toiture ? (
            // Sans altitudes, l'écran affichait « Toiture à 0 % » et la surface
            // au sol, en silence. Il faut le dire.
            <p className="text-xs text-[#B45309]">
              L’IGN ne donne pas les altitudes de ce toit&nbsp;: la pente est inconnue.
              Choisissez-la ci-dessous, sans quoi la surface affichée est celle du sol.
            </p>
          ) : penteDeduite ? (
            <p
              className={cn(
                'text-xs',
                batiment.toiture.fiable ? 'text-muted-foreground' : 'text-[#B45309]',
              )}
            >
              Pente déduite des altitudes de l’IGN&nbsp;:{' '}
              <strong className="text-foreground">{Math.round(batiment.toiture.pente)} %</strong>
              {batiment.toiture.incertitude > 0 && ` ± ${Math.round(batiment.toiture.incertitude)}`}
              {batiment.toiture.fiable
                ? '.'
                : ' — le calcul suppose un toit à deux pans ; sur ce bâtiment il ne tient pas. ' +
                  'Saisissez la pente.'}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Pente&nbsp;:</span>
            {PENTES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPenteSaisie(p)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  pente === p
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border bg-card hover:bg-accent',
                )}
              >
                {p === 0 ? 'plate' : `${p} %`}
              </button>
            ))}
          </div>

          <Garder
            enCours={enCours}
            defaut={batiment.nature || 'Toiture'}
            onGarder={(nom) =>
              onEnregistrer({
                nom,
                type: 'surface',
                geometrie: batiment.contour,
                hauteur_m: batiment.hauteur,
                pente_pct: pente > 0 ? pente : null,
                pente_source: penteDeduite ? 'altitudes' : 'saisie',
                hauteur_source: 'bati',
              })
            }
          />
        </>
      ) : onglet === 'facades' ? (
        <>
          {/* Un côté du bâtiment = une façade, nommée par son orientation. */}
          <div className="flex flex-wrap gap-1.5">
            {batiment.murs.map((m) => (
              <button
                key={m.index}
                type="button"
                onClick={() => choisirMur(mur?.index === m.index ? null : m)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  mur?.index === m.index
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-border bg-card hover:bg-accent',
                )}
              >
                {m.orientation} · {formatM(m.longueur)}
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
                  titre={pignon ? 'Longueur (pignon)' : 'Longueur'}
                  valeur={formatM(mur.longueur)}
                />
              </div>

              <div className="flex items-end gap-2">
                <label className="flex-1 space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Hauteur {pignon ? 'à la gouttière' : ''}
                  </span>
                  <div className="relative">
                    <Input
                      className="h-10 pr-8"
                      inputMode="decimal"
                      placeholder={batiment.hauteur ? String(batiment.hauteur) : 'à saisir'}
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

              {!batiment.hauteur && !hauteurSaisie.trim() && (
                <p className="text-xs text-[#B45309]">
                  L’IGN ne donne pas la hauteur de ce bâtiment : saisissez-la pour obtenir la
                  surface.
                </p>
              )}

              <Garder
                enCours={enCours}
                defaut={`Façade ${mur.orientation}`}
                desactive={surfaceFacade == null}
                onGarder={(nom) =>
                  onEnregistrer({
                    nom,
                    type: 'facade',
                    geometrie: [mur.a, mur.b],
                    hauteur_m: hauteur,
                    ouvertures_m2: ouvertures > 0 ? ouvertures : null,
                    azimut: mur.azimut,
                    hauteur_source: hauteurSaisie.trim() ? 'saisie' : 'bati',
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
  if (fiche.risques?.argile) lignes.push(['Retrait-gonflement argile', fiche.risques.argile])

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

function Chiffre({ titre, valeur, fort }: { titre: string; valeur: string; fort?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-border p-2.5', fort && 'bg-primary/5')}>
      <p className="truncate text-xs text-muted-foreground">{titre}</p>
      <p className={cn('montant truncate', fort ? 'text-lg font-semibold text-primary' : 'text-sm')}>
        {valeur}
      </p>
    </div>
  )
}
