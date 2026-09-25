import { useState } from 'react'
import { Check, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Unite } from './catalogue-metrage'
import { BADGE_METRAGE, UNITE_LISIBLE, valeurLisible } from './affichage-metrage'
import { useCorrigerMetrageArtisan, useMetrageArtisan, type LigneMetrage } from './use-metrage'

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
}: {
  token: string
  affectationToken: string
  cartes: CarteMesure[]
}) {
  const { data: metrage } = useMetrageArtisan(token, affectationToken)
  if (!cartes.length) return null
  const parCle = new Map((metrage ?? []).map((l) => [l.cle, l]))
  return (
    <div className="grid grid-cols-2 gap-2">
      {cartes.map((c) => (
        <Carte key={c.cle} token={token} affectationToken={affectationToken} carte={c} ligne={parCle.get(c.cle) ?? null} />
      ))}
    </div>
  )
}

function Carte({
  token,
  affectationToken,
  carte,
  ligne,
}: {
  token: string
  affectationToken: string
  carte: CarteMesure
  ligne: LigneMetrage | null
}) {
  const corriger = useCorrigerMetrageArtisan(token, affectationToken)
  const [edition, setEdition] = useState(false)
  const [saisie, setSaisie] = useState('')

  // Ce que l'artisan lit : la valeur retenue par un humain l'emporte sur le calcul.
  const humaine = ligne?.statut === 'confirme' ? ligne.valeur_retenue : null
  const valeur = humaine ?? carte.valeur
  const badge = carte.enCours && humaine == null
    ? { texte: 'mesure en cours…', classe: 'bg-muted text-muted-foreground' }
    : ligne?.statut === 'confirme'
      ? { texte: ligne.retenue_par === 'artisan' ? '✓ mesuré sur place' : '✓ confirmé', classe: BADGE_METRAGE.confirme.classe }
      : ligne && ligne.statut !== 'mesure'
        ? BADGE_METRAGE[ligne.statut]
        : carte.valeur != null
          ? BADGE_METRAGE.mesure
          : { texte: 'à saisir', classe: 'bg-muted text-muted-foreground' }

  function valider() {
    const v = parseFloat(saisie.replace(',', '.'))
    if (!Number.isFinite(v) || v < 0) return toast.error('Indiquez un nombre.')
    corriger.mutate(
      { cle: carte.cle, unite: carte.unite, valeur: v },
      {
        onSuccess: () => {
          setEdition(false)
          setSaisie('')
          toast.success('Valeur enregistrée', { description: 'L’agence la retient pour ce chantier.' })
        },
        onError: (e) => toast.error('Non enregistré', { description: e instanceof Error ? e.message : undefined }),
      },
    )
  }

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2.5">
      <button type="button" onClick={carte.onToucher} className="text-left" disabled={!carte.onToucher}>
        <span className="flex items-start justify-between gap-1">
          <span className="text-xs text-muted-foreground">{carte.libelle}</span>
          <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', badge.classe)}>{badge.texte}</span>
        </span>
        <span className="montant block text-xl font-semibold text-primary">
          {carte.enCours && humaine == null ? '…' : valeurLisible(valeur, carte.unite)}
        </span>
        {humaine != null && carte.valeur != null && Math.abs(humaine - carte.valeur) > 0.05 && (
          <span className="block text-[11px] text-muted-foreground">calculé : {valeurLisible(carte.valeur, carte.unite)}</span>
        )}
        {ligne?.valeur_declaree != null && ligne.statut !== 'confirme' && (
          <span className="block text-[11px] text-muted-foreground">
            dit par le client : {valeurLisible(ligne.valeur_declaree, carte.unite)}
          </span>
        )}
        {carte.detail && <span className="block text-[11px] text-muted-foreground">{carte.detail}</span>}
      </button>
      {edition ? (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            inputMode="decimal"
            className="h-9 min-w-0 flex-1"
            placeholder={UNITE_LISIBLE[carte.unite]}
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && valider()}
          />
          <Button size="icon" className="size-9 shrink-0" aria-label="Enregistrer" disabled={corriger.isPending} onClick={valider}>
            {corriger.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEdition(true)}
          className="flex min-h-9 items-center gap-1 text-left text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          <Pencil className="size-3" />
          Mesuré sur place
        </button>
      )}
    </div>
  )
}
