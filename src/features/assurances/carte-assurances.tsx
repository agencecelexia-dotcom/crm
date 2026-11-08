import { useId, useRef, useState } from 'react'
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
  const { data: etat, isLoading, isError, refetch } = useEtatChiffrage(token)
  const champId = useId()
  const lire = useLireAssurance(token)
  const deposer = useDeposerAssurance(token)
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null)
  const champs = useRef<Record<TypeAssurance, HTMLInputElement | null>>({
    decennale: null,
    rc_pro: null,
  })

  if (isLoading) return <div className="h-56 animate-pulse rounded-xl border border-border bg-muted" aria-label="Chargement des assurances" />
  if (isError || !etat) return <div role="alert" className="rounded-xl border border-border bg-card p-5"><p className="text-sm">Les assurances sont indisponibles</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>Réessayer</Button></div>

  async function choisir(type: TypeAssurance, file: File | null) {
    if (!file || lire.isPending || deposer.isPending) return
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('Format non pris en charge', { description: 'Choisissez un PDF, JPEG, PNG ou WebP.' })
      return
    }
    if (file.size > 6_000_000) { toast.error('Attestation trop volumineuse', { description: '6 Mo maximum.' }); return }
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
    <Card className="gap-0 rounded-xl border-border py-0 shadow-none">
      <CardContent className="space-y-0 px-0">
        <div className="border-b border-border p-5">
          <div className="flex items-center gap-2">
            {etat.peut_chiffrer ? <ShieldCheck className="size-4 text-muted-foreground" aria-hidden /> : <FileCheck2 className="size-4 text-muted-foreground" aria-hidden />}
            <h2 className="text-base font-medium">Assurances</h2>
          </div>
          <p className="mt-2 text-[13px] font-medium">{etat.peut_chiffrer ? 'Chiffrage activé' : 'Deux attestations requises'}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{etat.peut_chiffrer
            ? `Vos attestations sont validées${etat.validees_le ? ` depuis le ${formatDate(etat.validees_le)}` : ''}. Vous pouvez établir vos devis depuis votre espace.`
            : 'Déposez vos attestations décennale et RC professionnelle. Le générateur de devis sera disponible après leur validation par Celexia.'}</p>
        </div>

        <p className="px-5 pt-4 text-xs text-muted-foreground">PDF, JPEG, PNG ou WebP · 6 Mo maximum par attestation.</p>
        <div className="divide-y divide-border">
          {(['decennale', 'rc_pro'] as TypeAssurance[]).map((type) => (
            <Piece
              key={type}
              type={type}
              piece={etat[type]}
              busy={deposer.isPending || lire.isPending}
              onChoisir={(f) => choisir(type, f)}
              inputRef={(el) => (champs.current[type] = el)}
            />
          ))}
        </div>

        {brouillon && (
          <div className="space-y-4 border-t border-border bg-muted/30 p-5">
            <p className="break-words text-sm font-medium">
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
                  Vérifiez ces informations avant d’envoyer. Le remplacement d’une attestation nécessite une nouvelle validation par Celexia.
                </p>
                <div className="grid gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor={`${champId}-assureur`}>Assureur</Label>
                    <Input
                      id={`${champId}-assureur`}
                      value={brouillon.assureur}
                      onChange={(e) =>
                        setBrouillon({ ...brouillon, assureur: e.target.value })
                      }
                      placeholder="AXA, SMABTP…"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor={`${champId}-police`}>N° de police</Label>
                    <Input
                      id={`${champId}-police`}
                      value={brouillon.police}
                      onChange={(e) => setBrouillon({ ...brouillon, police: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor={`${champId}-echeance`}>Valable jusqu’au</Label>
                    <Input
                      id={`${champId}-echeance`}
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
            <div className="flex flex-wrap gap-2">
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
              <Button size="sm" variant="ghost" disabled={deposer.isPending} onClick={() => setBrouillon(null)}>
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
  busy,
}: {
  type: TypeAssurance
  piece: PieceAssurance
  busy: boolean
  onChoisir: (f: File | null) => void
  inputRef: (el: HTMLInputElement | null) => void
}) {
  const id = useId()
  const fichier = useRef<HTMLInputElement | null>(null)
  return (
    <div className="p-5">
      <p className="text-[13px] font-medium">{LIBELLES[type]}</p>
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
        ref={(el) => { fichier.current = el; inputRef(el) }}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={busy}
        onChange={(e) => { onChoisir(e.target.files?.[0] ?? null); e.target.value = '' }}
      />
      <Button type="button" size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => fichier.current?.click()} aria-label={`${piece.deposee ? 'Remplacer' : 'Déposer'} : ${LIBELLES[type]}`}>
        <Upload className="size-3.5" aria-hidden />
        {piece.deposee ? 'Remplacer' : 'Déposer l’attestation'}
      </Button>
    </div>
  )
}
