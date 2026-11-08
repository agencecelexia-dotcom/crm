import { useState } from 'react'
import { Camera, Check, CheckCircle2, Circle, Loader2, Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatM, formatM2 } from './geometrie'
import type { Releve } from './releve'
import { correctionsSurPlace, facadesSurPlace, noteSurPlace, type SaisieFacade } from './calcul-sur-place'
import { usePhotosFacade } from './use-photos-facade'
import { useConfirmerMetragesArtisan } from './use-metrage'
import { lireValeurMetrage } from './valeurs-metrage'

const nombre = (t: string) => {
  const v = lireValeurMetrage(t, 'm')
  return v != null && v > 0 && v < 200 ? v : null
}

/**
 * Le mode « sur place » : devant la maison, façade par façade — la photo (ses
 * ouvertures se retirent d'un doigt), les ouvertures qu'elle n'a pas vues, une
 * cote au mètre si on veut. Quand toutes les façades sont vues, les chiffres
 * vont au dossier, marqués « mesuré sur place ».
 */
export function SurPlace({
  token,
  affectationToken,
  cleabs,
  releve,
  orientationChoisie,
  onChoisir,
}: {
  token: string
  affectationToken: string
  cleabs: string | null
  releve: Releve
  orientationChoisie: string | null
  onChoisir: (o: string) => void
}) {
  const { data: photos } = usePhotosFacade(token, cleabs, true)
  const corriger = useConfirmerMetragesArtisan(token, affectationToken)
  const [saisies, setSaisies] = useState<Record<string, SaisieFacade>>({})
  const [textes, setTextes] = useState<Record<string, { longueur: string; hauteur: string }>>({})
  const [envoi, setEnvoi] = useState(false)
  const facades = facadesSurPlace(releve, photos ?? [], saisies)
  const corrections = correctionsSurPlace(facades, saisies)
  const vues = facades.filter((f) => f.vue).length
  const saisieInvalide = Object.values(textes).some((t) => Object.values(t).some((v) => !!v.trim() && nombre(v) == null))

  const changer = (o: string, s: Partial<SaisieFacade>) => setSaisies((avant) => ({ ...avant, [o]: { ...avant[o], ...s } }))
  const ecrire = (o: string, champ: 'longueur' | 'hauteur', t: string) => {
    setTextes((avant) => ({ ...avant, [o]: { ...(avant[o] ?? { longueur: '', hauteur: '' }), [champ]: t } }))
    changer(o, { [champ]: nombre(t) })
  }

  async function confirmer() {
    if (saisieInvalide || envoi || !corrections.length) return
    setEnvoi(true)
    const note = noteSurPlace(facades, saisies, new Date())
    try {
      await corriger.mutateAsync({ corrections, note })
      toast.success('Façades confirmées sur place', { description: 'L’agence retient ces chiffres pour ce chantier.' })
    } catch (e) {
      toast.error('Confirmation non enregistrée', { description: e instanceof Error ? e.message : 'Rechargez les mesures pour vérifier leur état.' })
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-2.5">
      <p className="text-xs text-muted-foreground">
        Pour chaque façade&nbsp;: une photo (touchez une ouverture en trop pour la retirer), les ouvertures
        qu’elle n’a pas vues, et une cote au mètre si vous voulez. Puis «&nbsp;Façade vue&nbsp;».
      </p>
      <ul className="space-y-2">
        {facades.map((f) => {
          const ouverte = orientationChoisie === f.orientation
          const t = textes[f.orientation] ?? { longueur: '', hauteur: '' }
          const coteInvalide = Object.values(t).some((v) => !!v.trim() && nombre(v) == null)
          return (
            <li key={f.orientation} className={cn('rounded-lg border bg-card p-2', ouverte ? 'border-primary' : 'border-border')}>
              <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => onChoisir(f.orientation)}>
                {f.vue ? <CheckCircle2 className="size-5 shrink-0 text-[#16A34A]" /> : <Circle className="size-5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Façade {f.orientation}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {f.ouvertures.photo ? '' : 'pas de photo lue · '}
                    {f.ouvertures.nombre} ouverture{f.ouvertures.nombre > 1 ? 's' : ''} · nette {formatM2(f.nette)}
                    {f.corrigee ? ` (brute ${formatM2(f.bruteCorrigee)}, corrigée)` : ''}
                  </span>
                </span>
                {!f.ouvertures.photo && <Camera className="size-4 shrink-0 text-muted-foreground" />}
              </button>
              {ouverte && (
                <div className="mt-2 space-y-2 border-t border-border pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Ouvertures en plus de la photo</span>
                    <span className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-9"
                        aria-label="Une ouverture de moins"
                        onClick={() => changer(f.orientation, { ajoutees: Math.max(0, (saisies[f.orientation]?.ajoutees ?? 0) - 1) })}
                      >
                        <Minus className="size-4" />
                      </Button>
                      <span className="montant w-6 text-center text-sm">{saisies[f.orientation]?.ajoutees ?? 0}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="size-9"
                        aria-label="Une ouverture de plus"
                        onClick={() => changer(f.orientation, { ajoutees: (saisies[f.orientation]?.ajoutees ?? 0) + 1 })}
                      >
                        <Plus className="size-4" />
                      </Button>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-0.5 text-[11px] text-muted-foreground">
                      Longueur mesurée
                      <Input
                        inputMode="decimal"
                        className="h-9"
                        placeholder={formatM(f.longueur)}
                        value={t.longueur}
                        aria-invalid={!!t.longueur.trim() && nombre(t.longueur) == null}
                        onChange={(e) => ecrire(f.orientation, 'longueur', e.target.value)}
                      />
                    </label>
                    <label className="space-y-0.5 text-[11px] text-muted-foreground">
                      Hauteur à la gouttière
                      <Input
                        inputMode="decimal"
                        className="h-9"
                        placeholder={formatM(f.hauteur)}
                        value={t.hauteur}
                        aria-invalid={!!t.hauteur.trim() && nombre(t.hauteur) == null}
                        onChange={(e) => ecrire(f.orientation, 'hauteur', e.target.value)}
                      />
                    </label>
                  </div>
                  {coteInvalide && <p role="alert" className="text-xs text-destructive">Saisissez des cotes complètes entre 0 et 200 m, sans unité, ou videz les champs pour conserver le relevé.</p>}
                  <Button
                    size="sm"
                    variant={f.vue ? 'outline' : 'default'}
                    className="min-h-10 w-full"
                    disabled={coteInvalide}
                    onClick={() => changer(f.orientation, { vue: !f.vue })}
                  >
                    <Check className="size-4" />
                    {f.vue ? 'Vue — la revoir' : 'Façade vue'}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <Button className="min-h-11 w-full" disabled={!corrections.length || envoi || saisieInvalide} onClick={confirmer}>
        {envoi ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        {corrections.length
          ? `Confirmer : ${formatM2(corrections.find((c) => c.cle === 'facade_nette')!.valeur)} nets`
          : `Façades vues : ${vues} sur ${facades.length}`}
      </Button>
    </div>
  )
}
