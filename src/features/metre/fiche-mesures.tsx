import { useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { QUANTITES, quantitesDuChantier, type Unite } from './catalogue-metrage'
import { BADGE_METRAGE, SOURCE_MESURE, UNITE_LISIBLE, valeurLisible } from './affichage-metrage'
import { useCorrigerMetrageArtisan, useMetrageArtisan, type LigneMetrage } from './use-metrage'
import { lireValeurMetrage, resoudreValeurMetrage } from './valeurs-metrage'

/** Un chiffre du métier, tel que l'écran le calcule. */
export interface CarteMesure {
  cle: string
  libelle: string
  unite: Unite
  /** Ce que l'outil affiche, ou null s'il ne le sait pas. */
  valeur: number | null
  /** Une précision sous le chiffre : « deux pans à 36 % », « ouvertures non déduites ». */
  detail?: string | null
  /** Toucher la carte : ouvrir l'onglet qui la détaille. */
  onToucher?: () => void
  /** La mesure arrive : ni « à saisir », ni un chiffre provisoire. */
  enCours?: boolean
  portee?: 'chantier' | 'selection'
}

/**
 * Les métrés du métier, d'abord.
 *
 * Deux ou trois gros chiffres, chacun avec ce qu'on en sait : mesuré par
 * l'outil, dit par le client, vérifié, confirmé. L'artisan qui revient du
 * chantier corrige d'un geste (« mesuré sur place ») : sa valeur devient celle
 * que l'agence retient.
 */
export function FicheMesures({
  token,
  affectationToken,
  cartes,
  dossierApplicable = true,
  saisiePermise = true,
}: {
  token: string
  affectationToken: string
  cartes: CarteMesure[]
  dossierApplicable?: boolean
  saisiePermise?: boolean
}) {
  const { data: metrage, isPending, isError, refetch } = useMetrageArtisan(dossierApplicable ? token : undefined, affectationToken)
  if (!cartes.length) return null
  const dossierIndisponible = dossierApplicable && (isPending || isError)
  const visibles = dossierIndisponible ? cartes.filter((c) => c.valeur != null) : cartes
  const parCle = new Map((dossierIndisponible ? [] : metrage ?? []).map((l) => [l.cle, l]))
  return <>
    {dossierApplicable && isPending && <p role="status" className="py-3 text-sm text-muted-foreground">Chargement des valeurs du chantier…</p>}
    {dossierApplicable && isError && (
    <div role="alert" className="space-y-2 rounded-xl border border-border p-3 text-sm">
      <p>Les valeurs confirmées n’ont pas pu être chargées. Les relevés automatiques ci-dessous restent des estimations.</p>
      <Button variant="outline" onClick={() => void refetch()}>Réessayer les valeurs du chantier</Button>
    </div>
    )}
    <div className="grid gap-2 sm:grid-cols-2">
      {visibles.map((c) => (
        <Carte key={`${affectationToken}:${c.cle}`} token={token} affectationToken={affectationToken} carte={dossierApplicable ? c : { ...c, portee: 'selection' }} ligne={parCle.get(c.cle) ?? null} saisiePermise={saisiePermise && !dossierIndisponible} />
      ))}
    </div>
  </>
}

/** La saisie terrain dépend du chantier, pas d'un bâtiment trouvé ou d'un relevé IGN. */
export function SaisieTerrainMetres({ token, affectationToken, metiers }: { token: string; affectationToken: string; metiers: (string | null | undefined)[] }) {
  const quantites = quantitesDuChantier(metiers)
  const [cle, setCle] = useState('')
  const presentes = quantites.length ? quantites : QUANTITES[cle] ? [QUANTITES[cle]] : []
  return <section className="space-y-3" aria-label="Mesures du chantier">
    <p className="text-xs leading-5 text-muted-foreground">Retrouvez les valeurs connues ou renseignez vos cotes prises sur place, même sans relevé automatique.</p>
    {!quantites.length && <label className="block space-y-1 text-sm"><span>Quantité à relever</span><select value={cle} onChange={(e) => setCle(e.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3"><option value="">Choisir une quantité</option>{Object.values(QUANTITES).map((q) => <option key={q.cle} value={q.cle}>{q.libelle}</option>)}</select></label>}
    <FicheMesures token={token} affectationToken={affectationToken} cartes={presentes.map((q) => ({ cle: q.cle, libelle: q.libelle, unite: q.unite, valeur: null }))} />
  </section>
}

function Carte({
  token,
  affectationToken,
  carte,
  ligne,
  saisiePermise,
}: {
  token: string
  affectationToken: string
  carte: CarteMesure
  ligne: LigneMetrage | null
  saisiePermise: boolean
}) {
  const corriger = useCorrigerMetrageArtisan(token, affectationToken)
  const [edition, setEdition] = useState(false)
  const [saisie, setSaisie] = useState('')
  const [erreurSaisie, setErreurSaisie] = useState<string | null>(null)

  // Ce que l'artisan lit : la valeur retenue par un humain l'emporte sur le calcul.
  const lue = resoudreValeurMetrage(carte, ligne)
  const { humaine, valeur } = lue
  const corrigeable = saisiePermise && carte.portee !== 'selection' && !lue.uniteIncompatible
  const badge = lue.enAttente
    ? { texte: 'mesure en cours…', classe: 'bg-muted text-muted-foreground' }
    : humaine != null
      ? { texte: lue.ligne?.retenue_par === 'artisan' ? '✓ mesuré sur place' : '✓ confirmé par l’agence', classe: BADGE_METRAGE.confirme.classe }
      : lue.statut ? BADGE_METRAGE[lue.statut] : { texte: 'non renseigné', classe: 'bg-muted text-muted-foreground' }

  function valider() {
    if (corriger.isPending || !corrigeable) return
    const v = lireValeurMetrage(saisie, carte.unite)
    if (v == null) return setErreurSaisie(carte.unite === 'u' ? 'Indiquez un nombre entier, sans unité.' : carte.unite === 'oui_non' ? 'Choisissez Oui ou Non.' : 'Indiquez un nombre complet, par exemple 120,5, sans unité.')
    setErreurSaisie(null)
    corriger.mutate(
      { cle: carte.cle, unite: carte.unite, valeur: v },
      {
        onSuccess: () => {
          setEdition(false)
          setSaisie('')
          toast.success('Valeur enregistrée', { description: 'L’agence la retient pour ce chantier.' })
        },
        onError: (e) => setErreurSaisie(e instanceof Error ? e.message : 'La sauvegarde n’a pas pu être confirmée. Réessayez.'),
      },
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-3" role="group" aria-label={carte.libelle}>
      <button type="button" onClick={carte.onToucher} className="text-left" disabled={!carte.onToucher}>
        <span className="flex flex-wrap items-start justify-between gap-1">
          <span className="text-xs text-muted-foreground">{carte.libelle}</span>
          <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', badge.classe)}>{badge.texte}</span>
        </span>
        <span className="montant block text-xl font-semibold text-primary">
          {lue.enAttente ? '…' : valeurLisible(valeur, carte.unite)}
        </span>
        {humaine != null && carte.valeur != null && Math.abs(humaine - carte.valeur) > 0.05 && (
          <span className="block text-[11px] text-muted-foreground">calculé : {valeurLisible(carte.valeur, carte.unite)}</span>
        )}
        {lue.declaree != null && lue.origine !== 'declaree' && humaine == null && (
          <span className="block text-[11px] text-muted-foreground">
            déclaré au dossier : {valeurLisible(lue.declaree, carte.unite)}
          </span>
        )}
        {lue.origine === 'dossier' && <span className="block text-[11px] text-muted-foreground">Estimation enregistrée{lue.ligne?.mesure_source ? ` · ${SOURCE_MESURE[lue.ligne.mesure_source] ?? lue.ligne.mesure_source}` : ''}</span>}
        {carte.portee === 'selection' && <span className="block text-[11px] text-muted-foreground">Sélection affichée · distincte des quantités du chantier</span>}
        {carte.detail && lue.origine !== 'humaine' && <span className="block text-[11px] text-muted-foreground">{carte.detail}</span>}
      </button>
      {lue.uniteIncompatible && <p role="alert" className="text-xs text-destructive">L’unité enregistrée ne correspond pas à cette quantité. Demandez sa correction à l’agence.</p>}
      {edition && corrigeable ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); valider() }}>
        <div className="flex items-center gap-1">
          {carte.unite === 'oui_non' ? <select autoFocus aria-label={`Valeur mesurée sur place : ${carte.libelle}`} value={saisie} onChange={(e) => { setSaisie(e.target.value); setErreurSaisie(null) }} disabled={corriger.isPending} className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"><option value="">Choisir</option><option value="1">Oui</option><option value="0">Non</option></select> :
          <Input
            autoFocus
            inputMode="decimal"
            className="h-11 min-w-0 flex-1"
            placeholder={UNITE_LISIBLE[carte.unite]}
            aria-label={`Valeur mesurée sur place : ${carte.libelle}`}
            value={saisie}
            disabled={corriger.isPending}
            onChange={(e) => { setSaisie(e.target.value); setErreurSaisie(null) }}
          />}
          <Button type="submit" size="icon" className="size-11 shrink-0" aria-label="Enregistrer" disabled={corriger.isPending}>
            {corriger.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          </Button>
          <Button type="button" size="icon" variant="ghost" className="size-11 shrink-0" aria-label={`Annuler la saisie : ${carte.libelle}`} disabled={corriger.isPending} onClick={() => { setEdition(false); setErreurSaisie(null) }}><X className="size-4" /></Button>
        </div>
        {erreurSaisie && <p role="alert" className="text-xs text-destructive">{erreurSaisie}</p>}
        </form>
      ) : corrigeable && (
        <button
          type="button"
          onClick={() => { setEdition(true); setSaisie(humaine != null ? String(humaine).replace('.', ',') : ''); setErreurSaisie(null) }}
          className="flex min-h-11 items-center gap-1 text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          <Pencil className="size-3" />
          Mesuré sur place
        </button>
      )}
    </div>
  )
}
