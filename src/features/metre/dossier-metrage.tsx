import { useState } from 'react'
import { Check, ClipboardList, Loader2, MessageSquareQuote } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { quantitesDuChantier, type Quantite } from './catalogue-metrage'
import { BADGE_METRAGE, SOURCE_MESURE, UNITE_LISIBLE, valeurLisible } from './affichage-metrage'
import { lireValeurMetrage, quantiteValide } from './valeurs-metrage'
import {
  useDeclarerMetrage,
  useMetrageProjet,
  useTrancherMetrage,
  type LigneMetrage,
} from './use-metrage'

/**
 * Le dossier de métrés d'un chantier, vu de l'agence.
 *
 * Pour chaque quantité du métier : ce que le client a dit (on le note ici,
 * au téléphone), ce que l'outil a mesuré, et ce que l'artisan lira. L'agence
 * ne fait que vérifier : un écart s'affiche « à vérifier », et un clic
 * retient la bonne valeur.
 */
export function DossierMetrage({ projetId, metiers }: { projetId: string; metiers: (string | null)[] }) {
  const quantites = quantitesDuChantier(metiers)
  const { data: lignes, isPending, isError, refetch } = useMetrageProjet(projetId)
  if (!quantites.length) return null
  if (isPending) return <Card className="p-4"><p role="status" className="text-sm text-muted-foreground">Chargement des métrés du chantier…</p></Card>
  if (isError) return <Card className="space-y-2 p-4"><p role="alert" className="text-sm">Les métrés du chantier n’ont pas pu être chargés.</p><Button variant="outline" onClick={() => void refetch()}>Réessayer les métrés</Button></Card>

  const parCle = new Map((lignes ?? []).map((l) => [l.cle, l]))
  const aVerifier = (lignes ?? []).filter((l) => l.statut === 'ecart' || l.statut === 'sources_desaccord').length

  return (
    <Card className="p-4">
      <h2 className="mb-1 flex items-center gap-2 font-medium">
        <ClipboardList className="size-4 text-primary" />
        Métrés du chantier
        {aVerifier > 0 && (
          <span className="rounded-full bg-[#F59E0B]/15 px-2 py-0.5 text-xs font-medium text-[#B45309]">
            {aVerifier} à vérifier
          </span>
        )}
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Ce que dit le client, ce que mesure l’outil. L’artisan lit la valeur retenue.
      </p>
      <ul className="divide-y divide-border">
        {quantites.map((q) => (
          <LigneQuantite key={`${projetId}:${q.cle}`} projetId={projetId} q={q} ligne={parCle.get(q.cle) ?? null} />
        ))}
      </ul>
    </Card>
  )
}

function LigneQuantite({ projetId, q, ligne }: { projetId: string; q: Quantite; ligne: LigneMetrage | null }) {
  const declarer = useDeclarerMetrage(projetId)
  const trancher = useTrancherMetrage(projetId)
  const [saisie, setSaisie] = useState<'dit' | 'autre' | null>(null)
  const [valeur, setValeur] = useState('')
  const [citation, setCitation] = useState('')
  const [erreurSaisie, setErreurSaisie] = useState<string | null>(null)
  const uniteIncompatible = !!ligne && ligne.unite !== q.unite

  const erreur = (e: unknown) => {
    setErreurSaisie(e instanceof Error ? e.message : 'La sauvegarde n’a pas pu être confirmée. Réessayez.')
    toast.error('Non enregistré')
  }
  const retenir = (v: number) =>
    !uniteIncompatible && quantiteValide(v, q.unite) && trancher.mutate({ cle: q.cle, unite: q.unite, valeur: v }, { onSuccess: () => setSaisie(null), onError: erreur })

  function valider() {
    if (declarer.isPending || trancher.isPending || uniteIncompatible) return
    const v = lireValeurMetrage(valeur, q.unite)
    if (v == null) return setErreurSaisie(q.unite === 'u' ? 'Indiquez un nombre entier.' : q.unite === 'oui_non' ? 'Choisissez Oui ou Non.' : 'Indiquez un nombre complet, sans unité.')
    setErreurSaisie(null)
    if (saisie === 'dit') {
      declarer.mutate(
        { cle: q.cle, unite: q.unite, valeur: v, citation },
        {
          onSuccess: () => {
            setSaisie(null)
            setValeur('')
            setCitation('')
          },
          onError: erreur,
        },
      )
    } else retenir(v)
  }

  const statut = ligne?.statut
  const aTrancher = statut === 'ecart' || statut === 'sources_desaccord'
  const enCours = declarer.isPending || trancher.isPending

  return (
    <li className="space-y-1.5 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{q.libelle}</span>
        <span className="flex items-center gap-2">
          <span className="montant font-semibold">{valeurLisible(uniteIncompatible ? null : ligne?.valeur_retenue, q.unite)}</span>
          {!uniteIncompatible && statut && (ligne?.valeur_retenue != null || aTrancher) ? (
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', BADGE_METRAGE[statut!].classe)}>
              {BADGE_METRAGE[statut!].texte}
            </span>
          ) : null}
        </span>
      </div>

      {(ligne?.valeur_declaree != null || ligne?.valeur_mesuree != null) && (
        <p className="text-xs text-muted-foreground">
          {ligne?.valeur_declaree != null && (
            <>
              Dit : <span className="text-foreground">{valeurLisible(ligne.valeur_declaree, ligne.unite)}</span>
              {ligne.citation && <> · « {ligne.citation} »</>}
            </>
          )}
          {ligne?.valeur_declaree != null && ligne?.valeur_mesuree != null && ' · '}
          {ligne?.valeur_mesuree != null && (
            <>
              Mesuré : <span className="text-foreground">{valeurLisible(ligne.valeur_mesuree, ligne.unite)}</span>
              {ligne.mesure_source && ` (${SOURCE_MESURE[ligne.mesure_source] ?? ligne.mesure_source})`}
            </>
          )}
        </p>
      )}

      {uniteIncompatible ? <p role="alert" className="text-xs text-destructive">L’unité enregistrée ne correspond pas à cette quantité. Faites corriger la ligne avant de confirmer une valeur.</p> : saisie ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); valider() }}>
          {q.unite === 'oui_non' ? <select aria-label={`${q.libelle} : ${saisie === 'dit' ? 'valeur déclarée' : 'valeur retenue'}`} value={valeur} onChange={(e) => { setValeur(e.target.value); setErreurSaisie(null) }} disabled={enCours} className="h-11 rounded-md border border-input bg-background px-3"><option value="">Choisir</option><option value="1">Oui</option><option value="0">Non</option></select> : <Input
            autoFocus
            inputMode="decimal"
            className="h-11 w-32"
            aria-label={`${q.libelle} : ${saisie === 'dit' ? 'valeur déclarée' : 'valeur retenue'}`}
            disabled={enCours}
            placeholder={UNITE_LISIBLE[q.unite] || 'valeur'}
            value={valeur}
            onChange={(e) => { setValeur(e.target.value); setErreurSaisie(null) }}
          />}
          {saisie === 'dit' && (
            <Input
              className="h-11 min-w-40 flex-1"
              aria-label={`Précision du client : ${q.libelle}`}
              disabled={enCours}
              placeholder="Ses mots, s’il les a dits (facultatif)"
              value={citation}
              onChange={(e) => setCitation(e.target.value)}
            />
          )}
          <Button type="submit" size="sm" className="min-h-11" disabled={enCours}>
            {enCours ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {saisie === 'dit' ? 'Noter' : 'Retenir'}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={enCours} onClick={() => { setSaisie(null); setErreurSaisie(null) }}>
            Annuler
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {aTrancher && quantiteValide(ligne?.valeur_mesuree, q.unite) && (
            <Button size="sm" variant="outline" disabled={enCours} onClick={() => retenir(ligne.valeur_mesuree!)}>
              Retenir {valeurLisible(ligne.valeur_mesuree, q.unite)} (mesuré)
            </Button>
          )}
          {aTrancher && quantiteValide(ligne?.valeur_declaree, q.unite) && (
            <Button size="sm" variant="outline" disabled={enCours} onClick={() => retenir(ligne.valeur_declaree!)}>
              Retenir {valeurLisible(ligne.valeur_declaree, q.unite)} (dit)
            </Button>
          )}
          {!aTrancher && statut !== 'confirme' && quantiteValide(ligne?.valeur_retenue, q.unite) && (
            <Button size="sm" variant="ghost" disabled={enCours} onClick={() => retenir(ligne.valeur_retenue!)}>
              <Check className="size-4" />
              Confirmer
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            title={q.question}
            disabled={enCours}
            onClick={() => { setSaisie('dit'); setValeur(ligne?.valeur_declaree != null ? String(ligne.valeur_declaree) : ''); setErreurSaisie(null) }}
          >
            <MessageSquareQuote className="size-4" />
            {ligne?.valeur_declaree != null ? 'Le client corrige' : 'Le client dit…'}
          </Button>
            <Button size="sm" variant="ghost" disabled={enCours} className="text-muted-foreground" onClick={() => { setSaisie('autre'); setValeur(''); setErreurSaisie(null) }}>
              {ligne ? 'Autre valeur' : 'Saisir une valeur vérifiée'}
            </Button>
        </div>
      )}
      {saisie === 'dit' && <p className="text-xs text-muted-foreground">À demander : {q.question}</p>}
      {erreurSaisie && <p role="alert" className="text-xs text-destructive">{erreurSaisie}</p>}
    </li>
  )
}
