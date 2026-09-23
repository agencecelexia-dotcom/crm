import { useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, MessageSquareText, Sparkles, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  useEntretienDevis,
  usePrixArtisan,
  type LigneEntretien,
  type QuestionEntretien,
} from './use-devis'

const euro2 = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n || 0)
    .replace(/[\u202f\u00a0]/g, ' ') + ' €'

const MARGES = [25, 30, 35, 40]

type Etape = 'description' | 'questions' | 'resultat'

/**
 * La seconde porte d'entrée du générateur.
 *
 * L'artisan qui sait déjà ce qu'il vend remplit ses lignes. Celui qui sort
 * d'une visite a autre chose en tête : ce qu'il a vu. Il le décrit, on lui
 * demande ce qui manque pour chiffrer, et le devis sort.
 *
 * Le modèle ne voit aucun prix — il choisit des lignes et des quantités. Les
 * prix sont attachés en base, depuis ses tarifs à lui puis le référentiel du
 * métier. Ce qui ne trouve preneur revient « à chiffrer » : une case vide se
 * voit, un prix faux non.
 */
export function EntretienDevis({
  token,
  metier,
  affectationToken,
  descriptionInitiale,
  onTermine,
  onAnnuler,
}: {
  token: string
  metier?: string | null
  affectationToken?: string | null
  descriptionInitiale?: string | null
  onTermine: (lignes: LigneEntretien[], objet?: string | null) => void
  onAnnuler: () => void
}) {
  const entretien = useEntretienDevis(token)
  // La marge visée recalcule un prix de vente À PARTIR D'UN DÉBOURSÉ. Sans
  // aucun déboursé en bibliothèque, le champ ne peut rien faire : l'afficher
  // laisse croire à un réglage qui agit.
  const { data: bibliotheque } = usePrixArtisan(token)
  const margeUtile = (bibliotheque ?? []).some((p) => p.cout_unitaire != null)
  const [etape, setEtape] = useState<Etape>('description')
  const [description, setDescription] = useState(descriptionInitiale ?? '')
  const [questions, setQuestions] = useState<QuestionEntretien[]>([])
  const [reponses, setReponses] = useState<Record<string, string>>({})
  const [marge, setMarge] = useState('')
  const [objet, setObjet] = useState<string | null>(null)
  const [lignes, setLignes] = useState<LigneEntretien[]>([])
  const [hypotheses, setHypotheses] = useState<string[]>([])
  const [manques, setManques] = useState<string[]>([])

  function demanderQuestions() {
    if (description.trim().length < 10) {
      toast.error('Décrivez le chantier en quelques mots')
      return
    }
    entretien.mutate(
      { phase: 'questions', description, metier, affectation_token: affectationToken },
      {
        onSuccess: (r) => {
          if (!r.ok) {
            toast.error('Entretien indisponible', { description: r.error })
            return
          }
          const qs = r.questions ?? []
          setQuestions(qs)
          // Les défauts sont pré-remplis : la plupart seront conservés tels
          // quels, et l'artisan n'a plus qu'à corriger ce qui ne colle pas.
          setReponses(
            Object.fromEntries(qs.map((q) => [q.cle, q.defaut ?? ''])),
          )
          setObjet(r.objet ?? null)
          setEtape('questions')
        },
        onError: (e) =>
          toast.error('Entretien indisponible', {
            description: e instanceof Error ? e.message : undefined,
          }),
      },
    )
  }

  // Une marge se situe entre 1 et 79 % : à 80 % et au-delà, la formule
  // PV = déboursé / (1 − marge) diverge. Le serveur écarte déjà les valeurs
  // aberrantes, mais EN SILENCE — l'artisan croyait sa marge appliquée.
  const margeSaisie = marge.trim()
  const margeNum = parseFloat(margeSaisie.replace(',', '.'))
  const margeInvalide =
    margeSaisie !== '' && (!Number.isFinite(margeNum) || margeNum < 1 || margeNum > 79)

  function composer() {
    if (margeInvalide) {
      toast.error('Marge hors limites', { description: 'Indiquez une valeur entre 1 et 79 %.' })
      return
    }
    const m = parseFloat(marge.replace(',', '.'))
    entretien.mutate(
      {
        phase: 'lignes',
        description,
        metier,
        affectation_token: affectationToken,
        reponses,
        marge: Number.isFinite(m) && m > 0 ? m / 100 : null,
      },
      {
        onSuccess: (r) => {
          if (!r.ok) {
            toast.error('Composition impossible', { description: r.error })
            return
          }
          setLignes(r.lignes ?? [])
          setHypotheses(r.hypotheses ?? [])
          setManques(r.manques ?? [])
          if (r.objet) setObjet(r.objet)
          setEtape('resultat')
        },
        onError: (e) =>
          toast.error('Composition impossible', {
            description: e instanceof Error ? e.message : undefined,
          }),
      },
    )
  }

  const total = lignes.reduce((s, l) => s + (l.quantite ?? 0) * (l.prix_unitaire ?? 0), 0)
  const aChiffrer = lignes.filter((l) => l.prix_unitaire == null).length

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Button
          size="icon"
          variant="ghost"
          className="size-9 shrink-0"
          aria-label="Retour"
          onClick={() =>
            etape === 'description'
              ? onAnnuler()
              : setEtape(etape === 'resultat' ? 'questions' : 'description')
          }
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {etape === 'description'
              ? 'Décrivez le chantier'
              : etape === 'questions'
                ? 'Quelques précisions'
                : objet || 'Votre devis'}
          </p>
          <p className="text-xs text-muted-foreground">
            {etape === 'description'
              ? 'Comme vous le raconteriez à un collègue'
              : etape === 'questions'
                ? `${questions.length} question${questions.length > 1 ? 's' : ''} qui change${questions.length > 1 ? 'nt' : ''} le prix`
                : `${lignes.length} lignes — ${euro2(total)}`}
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {etape === 'description' && (
          <>
            <Textarea
              autoFocus
              rows={8}
              placeholder="Ex. Maison de plain-pied des années 70, le crépi est décollé sur la façade sud et fissuré ailleurs. Le client veut tout refaire en enduit gratté ton pierre. Accès facile."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Inutile de donner les mesures maintenant : on vous les demandera ensuite, une par
              une. {affectationToken && 'Ce qui s’est dit pendant les appels est déjà pris en compte.'}
            </p>
          </>
        )}

        {etape === 'questions' && (
          <>
            {questions.map((q) => (
              <div key={q.cle} className="space-y-1.5">
                <Label className="text-sm font-medium">{q.libelle}</Label>
                {q.pourquoi && <p className="text-xs text-muted-foreground">{q.pourquoi}</p>}

                {q.type === 'choix' && q.options?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {q.options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => setReponses((r) => ({ ...r, [q.cle]: o }))}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-xs transition-colors',
                          reponses[q.cle] === o
                            ? 'border-primary bg-primary/10 font-medium text-primary'
                            : 'border-border bg-card hover:bg-accent',
                        )}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      className={cn('h-11', q.unite && 'pr-12')}
                      inputMode={q.type === 'nombre' ? 'decimal' : 'text'}
                      value={reponses[q.cle] ?? ''}
                      onChange={(e) => setReponses((r) => ({ ...r, [q.cle]: e.target.value }))}
                    />
                    {q.unite && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {q.unite}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* La marge visée : elle ne s'applique qu'aux lignes dont le
                déboursé est connu — sans coût, il n'y a pas de marge à viser. */}
            {margeUtile && (
            <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-3">
              <Label className="text-sm font-medium">Marge visée (facultatif)</Label>
              <p className="text-xs text-muted-foreground">
                Sur les lignes dont vous avez renseigné le déboursé, le prix de vente sera calculé
                pour atteindre cette marge. Ailleurs, vos tarifs habituels s’appliquent.
              </p>
              <div className="flex items-center gap-2">
                <div className="relative w-24 shrink-0">
                  <Input
                    className="h-10 w-full pr-8"
                    inputMode="decimal"
                    placeholder="—"
                    value={marge}
                    onChange={(e) => setMarge(e.target.value)}
                    aria-label="Marge visée en pourcentage"
                    aria-invalid={margeInvalide}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {MARGES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMarge(String(m))}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        marge === String(m)
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'border-border bg-card hover:bg-accent',
                      )}
                    >
                      {m} %
                    </button>
                  ))}
                </div>
              </div>
              {margeInvalide && (
                <p className="text-xs text-destructive">
                  Entre 1 et 79 %. Au-delà, le prix de vente n’a plus de limite.
                </p>
              )}
            </div>
            )}
          </>
        )}

        {etape === 'resultat' && (
          <>
{/* Un devis entièrement sans prix n'est pas une panne : c'est ce que
                donne un artisan dont la bibliothèque est encore vide, les
                tarifs des autres entreprises lui étant fermés. Le dire évite
                qu'il croie l'outil cassé. */}
            {aChiffrer > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-3">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#B45309]" />
                <div className="text-xs text-[#B45309]">
                  {aChiffrer === lignes.length ? (
                    <>
                      <p className="font-medium">Aucun de vos tarifs ne couvre encore ce chantier.</p>
                      <p className="mt-1">
                        Les lignes et les quantités sont prêtes : il ne reste qu’à poser vos prix.
                        Une fois ce devis enregistré, ils reviendront tout seuls sur les suivants.
                      </p>
                    </>
                  ) : (
                    <p>
                      {aChiffrer} ligne{aChiffrer > 1 ? 's' : ''} sans prix : aucun tarif connu
                      pour {aChiffrer > 1 ? 'ces prestations' : 'cette prestation'}. À vous de
                      {aChiffrer > 1 ? ' les' : ' la'} chiffrer — rien n’a été inventé.
                    </p>
                  )}
                </div>
              </div>
            )}

            <ul className="space-y-1.5">
              {lignes.map((l, i) => (
                <li key={i} className="rounded-lg border border-border p-2.5">
                  <p className="text-sm font-medium">{l.designation}</p>
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                    <span>
                      {l.quantite} {l.unite}
                    </span>
                    {l.prix_unitaire != null ? (
                      <>
                        <span className="montant">× {euro2(l.prix_unitaire)}</span>
                        <span className="montant font-medium text-foreground">
                          = {euro2((l.quantite ?? 0) * l.prix_unitaire)}
                        </span>
                        <span>
                          {l.source === 'bibliotheque'
                            ? '· votre prix'
                            : l.source === 'marge'
                              ? '· calculé sur votre marge'
                              : '· prix observé'}
                        </span>
                      </>
                    ) : (
                      <span className="text-[#B45309]">· prix à saisir</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>

            {hypotheses.length > 0 && (
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs font-medium">Ce qui a été supposé</p>
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  {hypotheses.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}

            {manques.length > 0 && (
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs font-medium">À vérifier sur place</p>
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  {manques.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-border p-4">
        {etape === 'description' && (
          <Button className="w-full" onClick={demanderQuestions} disabled={entretien.isPending}>
            {entretien.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageSquareText className="size-4" />
            )}
            Poser les questions
          </Button>
        )}
        {etape === 'questions' && (
          <Button
            className="w-full"
            onClick={composer}
            disabled={entretien.isPending || margeInvalide}
          >
            {entretien.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Composer le devis
          </Button>
        )}
        {etape === 'resultat' && lignes.length > 0 && (
          <Button
            className="w-full"
            onClick={() => {
              onTermine(lignes, objet)
              toast.success(
                `${lignes.length} ligne${lignes.length > 1 ? 's' : ''} ajoutée${lignes.length > 1 ? 's' : ''} au devis`,
              )
            }}
          >
            <ArrowRight className="size-4" />
            Reprendre ces {lignes.length} ligne{lignes.length > 1 ? 's' : ''}
          </Button>
        )}
      </div>
    </div>
  )
}
