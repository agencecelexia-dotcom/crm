import { Star, Loader2, EyeOff } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import type { ScoringArtisan } from '@/types/database'
import { useScoringArtisan, useNoterArtisan, useSolidite } from '../hooks/use-artisans'

// ----- Étoiles 1-5 (lecture seule ou éditable ; re-clic sur la note = efface) -----
function Etoiles({
  note,
  onChange,
}: {
  note: number | null
  onChange?: (n: number | null) => void
}) {
  const editable = !!onChange
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!editable}
          onClick={() => onChange?.(note === n ? null : n)}
          aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
          className={cn('p-0.5', editable && 'transition-transform hover:scale-110', !editable && 'cursor-default')}
        >
          <Star
            className={cn(
              'size-4',
              note != null && n <= note ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30',
            )}
          />
        </button>
      ))}
    </div>
  )
}

// ----- Conversion des métriques auto en note /5 (null = données insuffisantes) -----
function scoreVitesse(v: ScoringArtisan['vitesse']): number | null {
  const parts: number[] = []
  if (v.n_contact > 0 && v.h_contact != null)
    parts.push(v.h_contact <= 24 ? 5 : v.h_contact <= 48 ? 4 : v.h_contact <= 72 ? 3 : v.h_contact <= 168 ? 2 : 1)
  if (v.n_devis > 0 && v.h_devis != null)
    parts.push(v.h_devis <= 72 ? 5 : v.h_devis <= 168 ? 4 : v.h_devis <= 336 ? 3 : v.h_devis <= 672 ? 2 : 1)
  if (!parts.length) return null
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
}
function scoreTransfo(t: ScoringArtisan['transfo']): number | null {
  if (t.n_devis_envoyes === 0) return null
  return Math.round((t.n_signes / t.n_devis_envoyes) * 5)
}
function scoreFaceAFace(f: ScoringArtisan['face_a_face']): number | null {
  if (f.n_duels === 0) return null
  return Math.round((f.n_gagnes / f.n_duels) * 5)
}

// Moyenne générale = moyenne simple de tous les sous-scores DISPONIBLES
// (notes manuelles + métriques auto + solidité). Ignore ceux sans données.
function moyenneGenerale(s: ScoringArtisan, soliditeScore: number | null): number | null {
  const vals = [
    s.note_elocution,
    s.note_communication_agence,
    scoreVitesse(s.vitesse),
    scoreTransfo(s.transfo),
    scoreFaceAFace(s.face_a_face),
    soliditeScore,
  ].filter((n): n is number => n != null)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function delai(h: number | null): string {
  if (h == null) return '—'
  if (h < 1) return '< 1 h'
  if (h < 48) return `${Math.round(h)} h`
  return `${Math.round(h / 24)} j`
}

// ----- Ligne d'une dimension -----
function Ligne({
  emoji,
  titre,
  sousTitre,
  insuffisant,
  children,
}: {
  emoji: string
  titre: string
  sousTitre?: string
  insuffisant?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {emoji} {titre}
        </p>
        {sousTitre && <p className="text-xs text-muted-foreground">{sousTitre}</p>}
      </div>
      {insuffisant ? (
        <span className="shrink-0 text-xs text-muted-foreground/70">Données insuffisantes</span>
      ) : (
        children
      )}
    </div>
  )
}

// Carte « Scoring interne » d'un artisan (jamais visible côté artisan).
export function ScoringArtisanCard({ artisanId, siren }: { artisanId: string; siren?: string | null }) {
  const { data: s, isLoading } = useScoringArtisan(artisanId)
  const { data: solidite, isLoading: chargeSolidite } = useSolidite(siren)
  const noter = useNoterArtisan()
  const qc = useQueryClient()

  // Mise à jour optimiste du cache : la note s'affiche instantanément au clic.
  function maj(champ: 'note_elocution' | 'note_communication_agence', valeur: number | null) {
    qc.setQueryData<ScoringArtisan>(['scoring-artisan', artisanId], (old) =>
      old ? { ...old, [champ]: valeur } : old,
    )
    noter.mutate({ id: artisanId, champ, valeur })
  }

  return (
    <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>Scoring interne</span>
          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <EyeOff className="size-3.5" /> Agence uniquement
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="py-2">
        {isLoading || !s ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {/* Notes manuelles (éditables) */}
            <Ligne emoji="🗣️" titre="Comment il parle" sousTitre="Expression, aisance au téléphone">
              <Etoiles note={s.note_elocution} onChange={(n) => maj('note_elocution', n)} />
            </Ligne>
            <Ligne emoji="🤝" titre="Communication avec l'agence" sousTitre="Réactivité, fiabilité des échanges">
              <Etoiles note={s.note_communication_agence} onChange={(n) => maj('note_communication_agence', n)} />
            </Ligne>

            <div className="pt-1">
              <Separator />
              <p className="pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                Calculé automatiquement
              </p>
            </div>

            {/* Métriques auto (lecture seule) */}
            <Ligne
              emoji="⚡"
              titre="Vitesse (contact + devis)"
              sousTitre={`Contact : ${delai(s.vitesse.h_contact)} · Devis : ${delai(s.vitesse.h_devis)}`}
              insuffisant={s.vitesse.n_contact === 0 && s.vitesse.n_devis === 0}
            >
              <Etoiles note={scoreVitesse(s.vitesse)} />
            </Ligne>
            <Ligne
              emoji="📈"
              titre="Taux de transformation"
              sousTitre={
                s.transfo.n_devis_envoyes > 0
                  ? `${s.transfo.n_signes}/${s.transfo.n_devis_envoyes} devis signés (${Math.round(
                      (s.transfo.n_signes / s.transfo.n_devis_envoyes) * 100,
                    )} %)`
                  : 'Aucun devis envoyé'
              }
              insuffisant={s.transfo.n_devis_envoyes === 0}
            >
              <Etoiles note={scoreTransfo(s.transfo)} />
            </Ligne>
            <Ligne
              emoji="🏆"
              titre="Devis gagnés face à nos artisans"
              sousTitre={
                s.face_a_face.n_duels > 0
                  ? `${s.face_a_face.n_gagnes}/${s.face_a_face.n_duels} duel${s.face_a_face.n_duels > 1 ? 's' : ''} gagné${s.face_a_face.n_gagnes > 1 ? 's' : ''}`
                  : 'Pas encore de chantier en concurrence'
              }
              insuffisant={s.face_a_face.n_duels === 0}
            >
              <Etoiles note={scoreFaceAFace(s.face_a_face)} />
            </Ligne>
            <Ligne
              emoji="💪"
              titre="Solidité (indicatif)"
              sousTitre={
                !siren
                  ? 'SIREN manquant'
                  : chargeSolidite
                    ? 'Analyse en cours…'
                    : solidite?.trouve
                      ? solidite.resume +
                        (solidite.resultat_net != null
                          ? ` · résultat net ${formatEuros(solidite.resultat_net)} (${solidite.annee_finances})`
                          : ' · comptes non publiés')
                      : 'Entreprise introuvable'
              }
            >
              {!siren ? (
                <span className="shrink-0 text-xs text-muted-foreground/70">—</span>
              ) : chargeSolidite ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Etoiles note={solidite?.score ?? null} />
              )}
            </Ligne>

            {/* Moyenne générale (tous les sous-scores disponibles) */}
            {(() => {
              const moy = moyenneGenerale(s, solidite?.score ?? null)
              return (
                <div className="mt-3 flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2.5">
                  <span className="text-sm font-semibold">⭐ Moyenne générale</span>
                  {moy == null ? (
                    <span className="text-sm text-muted-foreground">Pas encore de données</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Etoiles note={Math.round(moy)} />
                      <span className="text-lg font-bold text-primary">{moy.toFixed(1)}/5</span>
                    </div>
                  )}
                </div>
              )
            })()}

            <p className="pt-2 text-[11px] text-muted-foreground">
              Basé sur {s.nb_projets} chantier{s.nb_projets > 1 ? 's' : ''} attribué{s.nb_projets > 1 ? 's' : ''}.
              {' '}Moyenne des scores renseignés.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
