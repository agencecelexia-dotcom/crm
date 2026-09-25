import { useState } from 'react'
import { Check, ClipboardList, Loader2, MessageSquareQuote } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { quantitesDuChantier, type Quantite } from './catalogue-metrage'
import { BADGE_METRAGE, SOURCE_MESURE, UNITE_LISIBLE, valeurLisible } from './affichage-metrage'
import {
  useDeclarerMetrage,
  useMetrageProjet,
  useTrancherMetrage,
  type LigneMetrage,
} from './use-metrage'

const lireNombre = (s: string) => {
  const n = parseFloat(s.replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

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
  const { data: lignes } = useMetrageProjet(projetId)
  if (!quantites.length) return null

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
          <LigneQuantite key={q.cle} projetId={projetId} q={q} ligne={parCle.get(q.cle) ?? null} />
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

  const erreur = (e: unknown) =>
    toast.error('Non enregistré', { description: e instanceof Error ? e.message : undefined })
  const retenir = (v: number) =>
    trancher.mutate({ cle: q.cle, unite: q.unite, valeur: v }, { onSuccess: () => setSaisie(null), onError: erreur })

  function valider() {
    const v = lireNombre(valeur)
    if (v == null) return toast.error('Indiquez un nombre.')
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
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{q.libelle}</span>
        <span className="flex items-center gap-2">
          <span className="montant font-semibold">{valeurLisible(ligne?.valeur_retenue, q.unite)}</span>
          {statut && (ligne?.valeur_retenue != null || aTrancher) ? (
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
              Dit : <span className="text-foreground">{valeurLisible(ligne.valeur_declaree, q.unite)}</span>
              {ligne.citation && <> · « {ligne.citation} »</>}
            </>
          )}
          {ligne?.valeur_declaree != null && ligne?.valeur_mesuree != null && ' · '}
          {ligne?.valeur_mesuree != null && (
            <>
              Mesuré : <span className="text-foreground">{valeurLisible(ligne.valeur_mesuree, q.unite)}</span>
              {ligne.mesure_source && ` (${SOURCE_MESURE[ligne.mesure_source] ?? ligne.mesure_source})`}
            </>
          )}
        </p>
      )}

      {saisie ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            inputMode="decimal"
            className="h-9 w-28"
            placeholder={UNITE_LISIBLE[q.unite] || 'valeur'}
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && valider()}
          />
          {saisie === 'dit' && (
            <Input
              className="h-9 min-w-40 flex-1"
              placeholder="Ses mots, s’il les a dits (facultatif)"
              value={citation}
              onChange={(e) => setCitation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && valider()}
            />
          )}
          <Button size="sm" disabled={enCours} onClick={valider}>
            {enCours ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {saisie === 'dit' ? 'Noter' : 'Retenir'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSaisie(null)}>
            Annuler
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {aTrancher && ligne?.valeur_mesuree != null && (
            <Button size="sm" variant="outline" disabled={enCours} onClick={() => retenir(ligne.valeur_mesuree!)}>
              Retenir {valeurLisible(ligne.valeur_mesuree, q.unite)} (mesuré)
            </Button>
          )}
          {aTrancher && ligne?.valeur_declaree != null && (
            <Button size="sm" variant="outline" disabled={enCours} onClick={() => retenir(ligne.valeur_declaree!)}>
              Retenir {valeurLisible(ligne.valeur_declaree, q.unite)} (dit)
            </Button>
          )}
          {!aTrancher && statut !== 'confirme' && ligne?.valeur_retenue != null && (
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
            onClick={() => setSaisie('dit')}
          >
            <MessageSquareQuote className="size-4" />
            {ligne?.valeur_declaree != null ? 'Le client corrige' : 'Le client dit…'}
          </Button>
          {ligne && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setSaisie('autre')}>
              Autre valeur
            </Button>
          )}
        </div>
      )}
      {saisie === 'dit' && <p className="text-xs text-muted-foreground">À demander : {q.question}</p>}
    </li>
  )
}
