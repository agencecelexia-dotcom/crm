import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { surfaceMur, type Batiment } from './bati-ign'
import { formatM, formatM2, surfaceReelle, type Mur } from './geometrie'

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
}: {
  batiment: Batiment
  onEnregistrer: (m: MesureAEnregistrer) => void
  enCours: boolean
  onMurChoisi: (m: Mur | null) => void
}) {
  const [onglet, setOnglet] = useState<'toiture' | 'facades'>('toiture')

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
  const surfaceFacade = mur ? surfaceMur(mur, hauteur, ouvertures) : null
  const toiture = surfaceReelle(batiment.emprise, pente)

  function choisirMur(m: Mur | null) {
    setMur(m)
    onMurChoisi(m)
  }

  return (
    <>
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {(['toiture', 'facades'] as const).map((o) => (
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
            {o === 'toiture' ? 'Toiture' : 'Façades'}
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
              <Chiffre titre="Hauteur au faîtage" valeur={formatM(batiment.hauteur)} />
            )}
          </div>

          {/* La pente, déduite des altitudes plutôt que devinée — avec son
              incertitude, qui est grande sur une petite maison. */}
          {penteDeduite && batiment.toiture && (
            <p className="text-xs text-muted-foreground">
              Pente déduite des altitudes de l’IGN&nbsp;:{' '}
              <strong className="text-foreground">{Math.round(batiment.toiture.pente)} %</strong>
              {batiment.toiture.incertitude > 0 && ` ± ${Math.round(batiment.toiture.incertitude)}`}
              {batiment.toiture.incertitude > 15
                ? ' — marge large sur un bâtiment de cette taille, vérifiez.'
                : '.'}
            </p>
          )}

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
      ) : (
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
                <Chiffre titre="Longueur" valeur={formatM(mur.longueur)} />
              </div>

              <div className="flex items-end gap-2">
                <label className="flex-1 space-y-1">
                  <span className="text-xs text-muted-foreground">Hauteur</span>
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
      )}
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
