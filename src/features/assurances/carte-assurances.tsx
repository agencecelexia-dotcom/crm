import { useRef, useState } from 'react'
import { FileCheck2, Loader2, ShieldCheck, TriangleAlert, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDate } from '@/lib/format'
import {
  useDeposerAssurance,
  useEtatChiffrage,
  useLireAssurance,
  type PieceAssurance,
  type TypeAssurance,
} from './use-assurances'

const LIBELLES: Record<TypeAssurance, string> = {
  decennale: 'Responsabilité décennale',
  rc_pro: 'Responsabilité civile professionnelle',
}

interface Brouillon {
  type: TypeAssurance
  file: File
  assureur: string
  police: string
  echeance: string
}

/**
 * Dépôt des attestations, dans l'espace artisan.
 *
 * C'est la porte d'entrée du chiffrage : tant que les deux pièces ne sont pas
 * déposées et validées par l'agence, le générateur de devis reste fermé.
 *
 * La lecture par Claude n'est qu'une aide à la saisie — elle peut échouer sans
 * bloquer quoi que ce soit, l'artisan remplit alors les champs lui-même.
 */
export function CarteAssurances({ token }: { token: string }) {
  const { data: etat, isLoading } = useEtatChiffrage(token)
  const lire = useLireAssurance(token)
  const deposer = useDeposerAssurance(token)
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null)
  const champs = useRef<Record<TypeAssurance, HTMLInputElement | null>>({
    decennale: null,
    rc_pro: null,
  })

  if (isLoading || !etat) return null

  async function choisir(type: TypeAssurance, file: File | null) {
    if (!file) return
    setBrouillon({ type, file, assureur: '', police: '', echeance: '' })

    // Échec silencieux : le formulaire reste saisissable à la main.
    try {
      const lu = await lire.mutateAsync(file)
      if (!lu.ok) return
      if (lu.type_document === 'autre') {
        toast.warning('Ce document ne ressemble pas à une attestation', {
          description: 'Vérifiez le fichier avant de l’envoyer.',
        })
      }
      setBrouillon((b) =>
        b && b.file === file
          ? {
              ...b,
              assureur: lu.assureur ?? '',
              police: lu.numero_police ?? '',
              echeance: lu.echeance ?? '',
            }
          : b,
      )
      if ((lu.confiance ?? 0) < 0.7) {
        toast.info('Document peu lisible', { description: 'Vérifiez les champs remplis.' })
      }
    } catch {
      toast.info('Lecture automatique indisponible', {
        description: 'Renseignez les champs à la main.',
      })
    }
  }

  return (
    <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
      <CardContent className="space-y-4 py-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            {etat.peut_chiffrer ? (
              <ShieldCheck className="size-5" />
            ) : (
              <FileCheck2 className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="font-display text-lg font-medium">
              {etat.peut_chiffrer ? 'Chiffrage activé' : 'Activez le chiffrage'}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {etat.peut_chiffrer
                ? `Vos attestations sont validées${etat.validees_le ? ` depuis le ${formatDate(etat.validees_le)}` : ''}. Vous pouvez établir vos devis depuis votre espace.`
                : 'Déposez vos deux attestations d’assurance pour débloquer le générateur de devis. Nous les vérifions, puis l’outil s’ouvre.'}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(['decennale', 'rc_pro'] as TypeAssurance[]).map((type) => (
            <Piece
              key={type}
              type={type}
              piece={etat[type]}
              onChoisir={(f) => choisir(type, f)}
              inputRef={(el) => (champs.current[type] = el)}
            />
          ))}
        </div>

        {brouillon && (
          <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
            <p className="text-sm font-medium">
              {LIBELLES[brouillon.type]} — {brouillon.file.name}
            </p>
            {lire.isPending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Lecture du document…
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Vérifiez ces informations avant d’envoyer.
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Assureur</Label>
                    <Input
                      value={brouillon.assureur}
                      onChange={(e) =>
                        setBrouillon({ ...brouillon, assureur: e.target.value })
                      }
                      placeholder="AXA, SMABTP…"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">N° de police</Label>
                    <Input
                      value={brouillon.police}
                      onChange={(e) => setBrouillon({ ...brouillon, police: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Valable jusqu’au</Label>
                    <Input
                      type="date"
                      value={brouillon.echeance}
                      onChange={(e) =>
                        setBrouillon({ ...brouillon, echeance: e.target.value })
                      }
                    />
                  </div>
                </div>
              </>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={deposer.isPending || lire.isPending}
                onClick={() =>
                  deposer.mutate(
                    {
                      type: brouillon.type,
                      file: brouillon.file,
                      assureur: brouillon.assureur,
                      police: brouillon.police,
                      echeance: brouillon.echeance || null,
                    },
                    {
                      onSuccess: () => {
                        toast.success('Attestation envoyée — nous la vérifions')
                        setBrouillon(null)
                      },
                      onError: (e) =>
                        toast.error('Envoi impossible', {
                          description: e instanceof Error ? e.message : undefined,
                        }),
                    },
                  )
                }
              >
                {deposer.isPending && <Loader2 className="size-4 animate-spin" />}
                Envoyer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBrouillon(null)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Piece({
  type,
  piece,
  onChoisir,
  inputRef,
}: {
  type: TypeAssurance
  piece: PieceAssurance
  onChoisir: (f: File | null) => void
  inputRef: (el: HTMLInputElement | null) => void
}) {
  const id = `assurance-${type}`
  return (
    <div className="rounded-xl border border-border/70 p-3">
      <p className="text-sm font-medium">{LIBELLES[type]}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {!piece.deposee ? (
          'Aucune attestation déposée'
        ) : piece.expiree ? (
          <span className="inline-flex items-center gap-1 text-destructive">
            <TriangleAlert className="size-3.5" />
            Expirée le {formatDate(piece.echeance)}
          </span>
        ) : (
          <>
            {piece.assureur || 'Déposée'}
            {piece.echeance && ` · valable jusqu’au ${formatDate(piece.echeance)}`}
          </>
        )}
      </p>
      <input
        id={id}
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => onChoisir(e.target.files?.[0] ?? null)}
      />
      <Button asChild size="sm" variant="outline" className="mt-2.5 w-full cursor-pointer">
        <label htmlFor={id}>
          <Upload className="size-4" />
          {piece.deposee ? 'Remplacer' : 'Déposer'}
        </label>
      </Button>
    </div>
  )
}
