import { useEffect, useMemo, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { FORMATS, MODELES, SEUIL_CONFIRMATION_USD } from './donnees'
import { FormulaireDynamique } from './formulaire-dynamique'
import { Galerie } from './galerie'
import {
  useCreatives, useGenerer, useQuota, useSchemaModele, useSuivre,
} from './use-creatives'

/** Cadence de sondage d'une génération en cours. */
const SONDAGE_MS = 4000

/**
 * Générateur de créatives publicitaires.
 *
 * Le formulaire se construit depuis le schéma du modèle choisi : n'importe
 * lequel des 1 491 modèles de fal fonctionne, y compris ceux sortis après
 * l'écriture de cet écran.
 *
 * Deux garde-fous, parce que les tarifs vont de 0,0045 $ à 5,00 $ par image :
 * le prix s'affiche avant de lancer, et le plafond mensuel bloque en base —
 * pas seulement ici.
 */
export function CreativesPage() {
  const [modele, setModele] = useState(MODELES[0].id)
  const [modeleLibre, setModeleLibre] = useState('')
  const [prompt, setPrompt] = useState('')
  const [format, setFormat] = useState(FORMATS[0].cle)
  const [avances, setAvances] = useState<Record<string, unknown>>({})
  const [enCours, setEnCours] = useState<string | null>(null)

  const modeleActif = modeleLibre.trim() || modele
  const favori = MODELES.find((m) => m.id === modeleActif) ?? null

  const { data: quota } = useQuota()
  const { data: creatives, isLoading } = useCreatives()
  const { data: champs, isError: schemaKo } = useSchemaModele(modeleActif)
  const generer = useGenerer()
  const suivre = useSuivre()

  /** Le champ de dimension du modèle, dont le nom varie selon les familles. */
  const champFormat = useMemo(
    () => champs?.find((c) => c.nom === 'image_size' || c.nom === 'aspect_ratio') ?? null,
    [champs],
  )

  const formatsDisponibles = useMemo(() => {
    if (!champFormat?.options) return []
    return FORMATS.filter((f) => f.valeurs.some((v) => champFormat.options!.includes(v)))
  }, [champFormat])

  // Sondage tant que la génération n'a pas abouti.
  useEffect(() => {
    if (!enCours) return
    const t = setInterval(() => {
      suivre.mutate(enCours, {
        onSuccess: (r) => {
          if (r?.statut && r.statut !== 'en_cours') {
            setEnCours(null)
            toast[r.statut === 'reussi' ? 'success' : 'error'](
              r.statut === 'reussi' ? 'Visuel prêt' : 'La génération a échoué',
            )
          }
        },
      })
    }, SONDAGE_MS)
    return () => clearInterval(t)
  }, [enCours, suivre])

  function lancer() {
    if (!prompt.trim()) {
      toast.error('Décrivez le visuel voulu.')
      return
    }
    if (favori?.prixUsd != null && favori.prixUsd > SEUIL_CONFIRMATION_USD) {
      const ok = window.confirm(
        `${favori.titre} coûte ${favori.prixUsd.toFixed(2)} $ par image.\n\nConfirmer ?`,
      )
      if (!ok) return
    }

    const parametres: Record<string, unknown> = { ...avances, prompt: prompt.trim() }
    if (champFormat) {
      const f = FORMATS.find((x) => x.cle === format)
      const valeur = f?.valeurs.find((v) => champFormat.options?.includes(v))
      if (valeur) parametres[champFormat.nom] = valeur
    }

    generer.mutate(
      {
        modele: modeleActif,
        categorie: favori?.categorie ?? 'text-to-image',
        format,
        coutEstime: favori?.prixUsd ?? null,
        parametres,
      },
      {
        onSuccess: (id) => {
          setEnCours(id)
          toast.success('Génération lancée')
        },
        onError: (e) =>
          toast.error('Génération impossible', {
            description: e instanceof Error ? e.message : undefined,
          }),
      },
    )
  }

  const bloque = quota != null && quota.reste <= 0

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        titre="Créatives"
        sousTitre="Visuels publicitaires pour Meta, Pinterest et Stories"
      />

      <Card className="mb-5 rounded-lg border-border p-4">
        <div>
          <div>
            <Label className="text-xs">Modèle</Label>
            <Select
              value={modeleLibre.trim() ? '' : modele}
              onValueChange={(v) => {
                setModele(v)
                setModeleLibre('')
                // Les réglages avancés portent des noms de champs propres au
                // modèle précédent : les conserver enverrait des paramètres
                // que le nouveau modèle ne connaît pas.
                setAvances({})
              }}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Choisir" />
              </SelectTrigger>
              <SelectContent>
                {MODELES.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.titre}
                    {m.prixUsd != null && ` — ${m.prixUsd.toFixed(4)} $`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {favori && <p className="mt-1 text-xs text-muted-foreground">{favori.usage}</p>}
          </div>

        </div>

        <div className="mt-3">
          <Label>Décrivez le visuel voulu</Label>
          <Textarea
            rows={5}
            placeholder="Photo professionnelle d'une toiture en tuiles rouges refaite à neuf sur une maison de plain-pied, ciel bleu dégagé, prise de vue depuis le jardin, lumière de fin d'après-midi"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {/* La fidélité au résultat tient d'abord à la description. Trois
              repères valent mieux qu'un modèle plus cher. */}
          <p className="mt-1.5 text-xs text-muted-foreground">
            Plus vous êtes précis, plus l'image ressemblera à votre idée. Dites le{' '}
            <strong>sujet</strong>, le <strong>cadrage</strong> et la{' '}
            <strong>lumière</strong> — et ce que vous ne voulez pas voir.
          </p>
        </div>

        {formatsDisponibles.length > 0 && (
          <div className="mt-3">
            <Label className="text-xs">Format</Label>
            <div className="flex flex-wrap gap-2">
              {formatsDisponibles.map((f) => (
                <button
                  key={f.cle}
                  type="button"
                  onClick={() => setFormat(f.cle)}
                  title={f.usage}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                    format === f.cle
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {champs && (
          <div className="mt-3 space-y-3">
            {/* Rangé ici plutôt qu'en vue principale : les 1 491 modèles de
                fal restent accessibles, sans encombrer l'usage courant. */}
            <details className="rounded-lg border border-border">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">
                Utiliser un autre modèle fal
                <span className="ml-1.5 font-normal text-muted-foreground">
                  1 491 disponibles
                </span>
              </summary>
              <div className="border-t border-border p-3">
                <Input
                  className="h-10 font-mono text-xs"
                  placeholder="fal-ai/…"
                  value={modeleLibre}
                  onChange={(e) => {
                    setModeleLibre(e.target.value)
                    setAvances({})
                  }}
                />
                {schemaKo && modeleLibre.trim() && (
                  <p className="mt-1 text-xs text-destructive">
                    Modèle inconnu de fal — vérifiez l'identifiant.
                  </p>
                )}
              </div>
            </details>

            <FormulaireDynamique
              champs={champs}
              valeurs={avances}
              onChange={(nom, v) => setAvances((a) => ({ ...a, [nom]: v }))}
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={lancer} disabled={generer.isPending || Boolean(enCours) || bloque}>
            {generer.isPending || enCours ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {enCours ? 'Génération en cours…' : 'Générer'}
          </Button>

          {quota && (
            <p className={cn('text-xs', bloque ? 'font-medium text-destructive' : 'text-muted-foreground')}>
              {bloque
                ? `Plafond atteint (${quota.plafond}/mois). Relevez-le dans Automatisations.`
                : `${quota.utilise} / ${quota.plafond} ce mois-ci`}
            </p>
          )}
          {favori?.prixUsd != null && (
            <p className="text-xs text-muted-foreground">
              ≈ {favori.prixUsd.toFixed(4)} $ par image
            </p>
          )}
        </div>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : (
        <Galerie creatives={creatives ?? []} />
      )}
    </div>
  )
}
