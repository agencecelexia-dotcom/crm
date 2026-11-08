import { useId, useRef, useState } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MOTIFS_PERTE, motifDef, type MotifPerte } from '@/lib/motifs-perte'
import { supabase } from '@/lib/supabase/client'
import { messageErreurSuivi } from './erreur-suivi'
import { confirmerTentativeSuivi, obtenirTentativeSuivi } from './tentative-suivi'

const RAISON_MIN = 5

type Situation = 'client' | 'artisan'

/** Un point d’entrée, deux décisions distinctes : perte client ou retrait artisan.
 * Les RPC et leur qualification restent distinctes ; aucun historique n’est réécrit. */
export function RetraitChantierDialog({
  token,
  peutDeclarerPerte = false,
  onRetire,
}: {
  /** Token de l’AFFECTATION. */
  token: string
  /** La perte client relève du suivi, accessible après signature du contrat. */
  peutDeclarerPerte?: boolean
  /** Rafraîchit l’espace après l’une ou l’autre des décisions. */
  onRetire: () => void
}) {
  const id = useId()
  const [ouvert, setOuvert] = useState(false)
  const [situation, setSituation] = useState<Situation | ''>('')
  const [raison, setRaison] = useState('')
  const [motif, setMotif] = useState<MotifPerte | ''>('')
  const [recontacterLe, setRecontacterLe] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const envoiEnCours = useRef(false)

  // Une permission retirée pendant l’ouverture ne laisse pas envoyer une perte.
  const choix: Situation | '' = peutDeclarerPerte ? situation : 'artisan'
  const def = motifDef(motif)
  const raisonValide = raison.trim().length >= RAISON_MIN && def?.origine === choix
  const relancable = choix === 'artisan' && def?.relancable === true

  function reinitialiser() {
    setRaison('')
    setMotif('')
    setRecontacterLe('')
    setErreur(null)
  }

  async function confirmer() {
    if (!raisonValide || !choix || envoiEnCours.current) return
    envoiEnCours.current = true
    setEnvoi(true)
    setErreur(null)
    try {
      if (choix === 'client') {
        // Même contenu et même clé persistante que l’ancien parcours « Perdu ».
        const contenu = { p_statut: 'perdu', p_message: raison.trim(), p_date_rdv: null, p_motif: motif }
        const tentative = await obtenirTentativeSuivi(token, 'suivi', contenu)
        const { data, error } = await supabase.rpc('add_suivi_by_token', {
          p_token: token, ...contenu, p_cle: tentative.cle,
        })
        if (error || !data?.ok) throw error ?? data
        confirmerTentativeSuivi(tentative)
        toast.success('Fin du suivi enregistrée', { description: 'Le chantier reste consultable dans vos chantiers perdus.' })
      } else {
        const { data, error } = await supabase.rpc('retirer_chantier_by_token', {
          p_token: token,
          p_raison: raison.trim(),
          p_motif: motif,
          p_recontacter_le: relancable ? recontacterLe || null : null,
        })
        if (error || !data?.ok) throw error ?? data
        toast.success('Chantier retiré', { description: 'Celexia a été prévenu et pourra réattribuer le dossier.' })
      }
      setOuvert(false)
      setSituation('')
      reinitialiser()
      onRetire()
    } catch (e) {
      setErreur(messageErreurSuivi(e, 'L’arrêt du suivi n’a pas pu être confirmé. Vos saisies sont conservées ; réessayez.'))
    } finally {
      envoiEnCours.current = false
      setEnvoi(false)
    }
  }

  return (
    <AlertDialog
      open={ouvert}
      onOpenChange={(o) => {
        if (envoiEnCours.current) return
        setOuvert(o)
        if (!o) { setSituation(''); reinitialiser() }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm"
          className="min-h-11 whitespace-normal text-muted-foreground hover:bg-destructive/5 hover:text-destructive">
          <LogOut className="size-4 shrink-0" aria-hidden />
          Ne pas poursuivre ce chantier
        </Button>
      </AlertDialogTrigger>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[10px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-left">Ne pas poursuivre ce chantier</AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              Précisez la situation pour que Celexia puisse donner la bonne suite au dossier. Rien ne change avant votre confirmation.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <fieldset disabled={envoi} className="min-w-0 space-y-4">
            {peutDeclarerPerte ? (
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Quelle est la situation ?</legend>
                {([
                  ['client', 'Le client ne donne pas suite'],
                  ['artisan', 'Je ne peux pas prendre ce chantier'],
                ] as const).map(([valeur, label]) => (
                  <label key={valeur} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-3 text-sm has-checked:border-primary has-checked:bg-primary/5">
                    <input type="radio" name={`${id}-situation`} value={valeur} checked={choix === valeur}
                      onChange={() => { setSituation(valeur); reinitialiser() }} className="size-4 shrink-0 accent-primary" />
                    {label}
                  </label>
                ))}
              </fieldset>
            ) : (
              <div className="space-y-1 text-sm">
                <p className="font-medium">Je ne peux pas prendre ce chantier</p>
                <p className="text-muted-foreground">Vous pouvez vous retirer sans signer le contrat. Le suivi des décisions du client est disponible après signature.</p>
              </div>
            )}

            {choix && <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {choix === 'client'
                  ? 'Ce chantier passera dans vos chantiers perdus. La raison du client sera enregistrée et votre historique conservé.'
                  : 'Ce chantier quittera votre liste active. Celexia sera prévenu de votre retrait et pourra le proposer à un autre artisan. Votre historique restera consultable dans les chantiers perdus.'}
              </p>
              <div className="space-y-2">
                <Label htmlFor={`${id}-motif`}>{choix === 'client' ? 'Motif de perte du chantier' : 'Motif de votre retrait'} <span aria-hidden className="text-destructive">*</span></Label>
                <Select value={motif} onValueChange={(v) => { setMotif(v as MotifPerte); setErreur(null); if (!motifDef(v)?.relancable) setRecontacterLe('') }} disabled={envoi}>
                  <SelectTrigger id={`${id}-motif`} className="h-11 w-full" aria-required="true">
                    <SelectValue placeholder="Choisir un motif" />
                  </SelectTrigger>
                  <SelectContent>
                    {MOTIFS_PERTE.filter((m) => m.origine === choix).map((m) => <SelectItem key={m.cle} value={m.cle}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {choix === 'artisan' && <p className="text-xs text-muted-foreground">Si aucun motif ne correspond à votre situation, contactez Celexia.</p>}
              </div>

              {relancable && <div className="space-y-2">
                <Label htmlFor={`${id}-recontacter`}>À recontacter le (facultatif)</Label>
                <Input id={`${id}-recontacter`} type="date" className="h-11" value={recontacterLe}
                  min={new Date().toISOString().slice(0, 10)} onChange={(e) => setRecontacterLe(e.target.value)} />
                <p className="text-xs text-muted-foreground">Celexia recevra une notification à cette date pour réexaminer le dossier.</p>
              </div>}

              <div className="space-y-2">
                <Label htmlFor={`${id}-raison`}>{choix === 'client' ? 'Raison de la perte du chantier' : 'Pourquoi vous retirez-vous ?'} <span aria-hidden className="text-destructive">*</span></Label>
                <Textarea id={`${id}-raison`} value={raison} onChange={(e) => setRaison(e.target.value)} rows={3}
                  placeholder={choix === 'client' ? 'Expliquez la décision ou la situation du client…' : 'Précisez votre zone, votre métier ou vos disponibilités…'} aria-required="true" />
                <p className="text-xs text-muted-foreground">Précisez la situation en au moins {RAISON_MIN} caractères.</p>
              </div>
            </>}
          </fieldset>

          {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={envoi}>Annuler</AlertDialogCancel>
            {/* Pas d’AlertDialogAction : une erreur doit garder la fenêtre et sa saisie. */}
            <Button type="button" variant="destructive" className="min-h-11 whitespace-normal"
              disabled={!raisonValide || envoi} onClick={() => void confirmer()}>
              {envoi && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />}
              {envoi ? 'Enregistrement…' : 'Confirmer l’arrêt du suivi'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
  )
}
