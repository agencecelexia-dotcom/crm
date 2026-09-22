import { useMemo, useState } from 'react'
import { Copy, Layers, Loader2, Search, Star, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useDupliquerDevis,
  useEnregistrerModele,
  useListeDevis,
  useModelesDevis,
  usePrixArtisan,
  useSupprimerModele,
  type LigneModele,
  type ModeleDevis,
  type PrixArtisan,
} from './use-devis'

const euro = (n: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n || 0).replace(/[\u202f\u00a0]/g, ' ') +
  ' €'

const euro2 = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n || 0)
    .replace(/[\u202f\u00a0]/g, ' ') + ' €'

/**
 * Ne jamais partir d'une page blanche.
 *
 * Trois façons de remplir un devis d'un geste : un modèle enregistré, le devis
 * type du métier (déduit des devis réellement observés), ou un devis déjà fait
 * qu'on reprend. C'est ce bloc qui décide du temps que prendra le devis : une
 * minute ou un quart d'heure.
 *
 * Il ne s'affiche que tant que le devis est vide — une fois les lignes posées,
 * il n'a plus rien à proposer et laisse la place.
 */
export function DemarrageDevis({
  token,
  metier,
  onAppliquer,
}: {
  token: string
  metier?: string | null
  onAppliquer: (lignes: LigneModele[], objet?: string | null) => void
}) {
  const { data: modeles } = useModelesDevis(token, metier)
  const { data: devis } = useListeDevis(token)
  const dupliquer = useDupliquerDevis(token)
  const [choixDevis, setChoixDevis] = useState(false)

  // Les huit derniers : au-delà, l'artisan ne reconnaît plus le chantier.
  const reprises = useMemo(() => (devis ?? []).slice(0, 8), [devis])

  function appliquer(m: ModeleDevis) {
    onAppliquer(m.lignes ?? [])
    toast.success(`${m.nom} — ${m.nb_lignes} ligne${m.nb_lignes > 1 ? 's' : ''} ajoutée${m.nb_lignes > 1 ? 's' : ''}`)
  }

  if (!modeles?.length && !reprises.length) return null

  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">Partir d’un modèle</p>

      <div className="flex flex-wrap gap-1.5">
        {(modeles ?? []).map((m) => (
          <button
            key={m.id ?? m.nom}
            type="button"
            onClick={() => appliquer(m)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            {m.source === 'reference' ? (
              <Star className="size-3.5 text-primary" />
            ) : (
              <Layers className="size-3.5 text-muted-foreground" />
            )}
            {m.nom}
            <span className="font-normal text-muted-foreground">{m.nb_lignes} l.</span>
          </button>
        ))}

        {reprises.length > 0 && (
          <button
            type="button"
            onClick={() => setChoixDevis((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            <Copy className="size-3.5 text-muted-foreground" />
            Reprendre un devis
          </button>
        )}
      </div>

      {choixDevis && (
        <ul className="space-y-1">
          {reprises.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                disabled={dupliquer.isPending}
                onClick={() =>
                  dupliquer.mutate(d.id, {
                    onSuccess: (r) => {
                      onAppliquer(r.lignes ?? [], r.objet)
                      setChoixDevis(false)
                      toast.success(`Lignes du devis ${d.numero} reprises`)
                    },
                    onError: (e) =>
                      toast.error('Reprise impossible', {
                        description: e instanceof Error ? e.message : undefined,
                      }),
                  })
                }
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:bg-accent disabled:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.client_nom}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.numero}
                    {d.objet ? ` · ${d.objet}` : ''}
                  </p>
                </div>
                <span className="montant shrink-0 text-sm">{euro(d.total ?? 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * La bibliothèque de prix, avec recherche.
 *
 * Elle se remplit toute seule : chaque devis enregistré y verse ses lignes.
 * Au bout de quelques chantiers, l'artisan ne saisit plus un prix — il le
 * retrouve. Sans recherche, une bibliothèque de quarante lignes est
 * inutilisable ; c'est le champ de recherche qui la rend exploitable.
 */
export function BibliothequePrix({
  token,
  onAjouter,
}: {
  token: string
  onAjouter: (p: PrixArtisan) => void
}) {
  const { data: prix } = usePrixArtisan(token)
  const [q, setQ] = useState('')

  const resultats = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return (prix ?? []).slice(0, 6)
    return (prix ?? []).filter((p) => p.designation.toLowerCase().includes(t)).slice(0, 20)
  }, [prix, q])

  if (!prix?.length) return null

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-10 pl-9 pr-9"
          placeholder={`Chercher dans vos ${prix.length} prix…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Effacer"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {resultats.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucun prix ne correspond à « {q} ».</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {resultats.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onAjouter(p)}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:bg-accent"
            >
              {p.designation}
              <span className="ml-1 text-muted-foreground">
                {euro2(p.prix_unitaire)}/{p.unite}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Enregistrer le devis en cours comme modèle.
 *
 * Le geste qui rentabilise tout le reste : l'artisan chiffre une fois sa
 * prestation courante, et les suivantes tiennent en un clic.
 */
export function EnregistrerModele({
  token,
  lignes,
  metier,
}: {
  token: string
  lignes: LigneModele[]
  metier?: string | null
}) {
  const enregistrer = useEnregistrerModele(token)
  const supprimer = useSupprimerModele(token)
  const { data: modeles } = useModelesDevis(token, metier)
  const [ouvert, setOuvert] = useState(false)
  const [nom, setNom] = useState('')

  const perso = (modeles ?? []).filter((m) => m.source === 'perso' && m.id)

  if (lignes.length === 0) return null

  return (
    <div className="space-y-2">
      {!ouvert ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => {
            setNom(metier ?? '')
            setOuvert(true)
          }}
        >
          <Layers className="size-4" />
          Enregistrer ces {lignes.length} lignes comme modèle
        </Button>
      ) : (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <Input
            className="h-10"
            autoFocus
            placeholder="Nom du modèle (ex. Ravalement complet)"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={enregistrer.isPending || !nom.trim()}
              onClick={() =>
                enregistrer.mutate(
                  { nom, lignes, metier },
                  {
                    onSuccess: () => {
                      toast.success(`Modèle « ${nom.trim()} » enregistré`)
                      setOuvert(false)
                      setNom('')
                    },
                    onError: (e) =>
                      toast.error('Échec', {
                        description: e instanceof Error ? e.message : undefined,
                      }),
                  },
                )
              }
            >
              {enregistrer.isPending && <Loader2 className="size-4 animate-spin" />}
              Enregistrer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
          </div>

          {perso.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              <p className="text-xs text-muted-foreground">Vos modèles</p>
              {perso.map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {m.nom}
                    <span className="text-muted-foreground"> · {m.nb_lignes} l.</span>
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-muted-foreground"
                    aria-label={`Supprimer ${m.nom}`}
                    onClick={() => supprimer.mutate(m.id!)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
