import { useState } from 'react'
import {
  Cable,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatDateHeure } from '@/lib/format'
import {
  useEnregistrerPont,
  useEntrants,
  usePont,
  useRegenererSecret,
  useSortants,
  useTesterPont,
} from '../hooks/use-pont'
import { specificationPont } from '../specification-pont'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const CLE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

/** Copie un texte, avec un retour visuel court. */
function useCopie() {
  const [copie, setCopie] = useState<string | null>(null)
  return {
    copie,
    async copier(cle: string, valeur: string, libelle: string) {
      try {
        await navigator.clipboard.writeText(valeur)
        setCopie(cle)
        toast.success(`${libelle} copié`)
        window.setTimeout(() => setCopie((c) => (c === cle ? null : c)), 1500)
      } catch {
        toast.error('Copie impossible — sélectionne le texte à la main')
      }
    },
  }
}

/** Ligne « valeur à recopier » : libellé, valeur monospace, bouton copier. */
function Champ({
  libelle,
  valeur,
  aide,
  masquable,
  cle,
  copie,
  onCopier,
}: {
  libelle: string
  valeur: string
  aide?: string
  masquable?: boolean
  cle: string
  copie: string | null
  onCopier: (cle: string, valeur: string, libelle: string) => void
}) {
  const [visible, setVisible] = useState(!masquable)
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{libelle}</Label>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
          {visible ? valeur : '•'.repeat(48)}
        </code>
        {masquable && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={visible ? 'Masquer' : 'Afficher'}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Copier ${libelle}`}
          onClick={() => onCopier(cle, valeur, libelle)}
        >
          {copie === cle ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
        </Button>
      </div>
      {aide && <p className="text-xs text-muted-foreground">{aide}</p>}
    </div>
  )
}

/**
 * Pont vers le CRM propre de l'artisan.
 *
 * Réservé aux fondateurs : la carte contient un secret de signature, et
 * brancher un partenaire sur nos données relève de la même décision que
 * signer son contrat.
 */
export function PontCrmCard({
  artisanId,
  societe,
  tokenArtisan,
}: {
  artisanId: string
  societe: string
  tokenArtisan: string
}) {
  const { data: pont, isLoading } = usePont(artisanId)
  const { data: sortants } = useSortants(artisanId)
  const { data: entrants } = useEntrants(artisanId)
  const enregistrer = useEnregistrerPont(artisanId)
  const regenerer = useRegenererSecret(artisanId)
  const tester = useTesterPont(artisanId)
  const { copie, copier } = useCopie()

  // `undefined` = pas encore saisi par l'utilisateur : on affiche la valeur
  // enregistrée. Un état initialisé depuis `pont` écraserait la frappe en
  // cours à chaque rafraîchissement de la requête.
  const [url, setUrl] = useState<string | undefined>(undefined)
  const urlAffichee = url ?? pont?.url_webhook ?? ''

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-primary" />
        </CardContent>
      </Card>
    )
  }

  const actif = Boolean(pont?.actif)
  const enPanne = Boolean(
    pont?.dernier_echec_at &&
      (!pont.derniere_reussite_at || pont.dernier_echec_at > pont.derniere_reussite_at),
  )

  const spec = pont
    ? specificationPont({
        societe,
        tokenArtisan,
        clePublique: pont.cle_publique,
        secret: pont.secret,
        urlWebhook: pont.url_webhook,
        supabaseUrl: SUPABASE_URL,
        cleAnon: CLE_ANON,
      })
    : null

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitre>
            <Cable className="size-4" /> Pont vers son CRM
          </CardTitre>
          <p className="text-xs text-muted-foreground">
            Les chantiers qu’on lui attribue partent chez lui, ses mises à jour
            reviennent ici. Tant que c’est éteint, rien ne circule et rien ne
            s’accumule.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actif &&
            (enPanne ? (
              <Badge variant="destructive" className="gap-1">
                <TriangleAlert className="size-3" /> En panne
              </Badge>
            ) : (
              <Badge className="bg-primary/10 text-primary">Actif</Badge>
            ))}
          <Switch
            checked={actif}
            aria-label="Activer le pont"
            disabled={enregistrer.isPending}
            onCheckedChange={(v) =>
              enregistrer.mutate(
                { actif: v },
                {
                  onSuccess: () => toast.success(v ? 'Pont activé' : 'Pont coupé'),
                  onError: (e: unknown) =>
                    toast.error(e instanceof Error ? e.message : 'Échec'),
                },
              )
            }
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* --- Ce qu'il doit nous donner --- */}
        <div className="space-y-1.5">
          <Label htmlFor="pont-url" className="text-xs text-muted-foreground">
            L’URL de SON webhook — où on lui pousse les événements
          </Label>
          <div className="flex gap-2">
            <Input
              id="pont-url"
              value={urlAffichee}
              placeholder="https://son-crm.fr/api/celexia"
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={enregistrer.isPending || urlAffichee === (pont?.url_webhook ?? '')}
              onClick={() =>
                enregistrer.mutate(
                  { url_webhook: urlAffichee.trim() || null },
                  {
                    onSuccess: () => {
                      setUrl(undefined)
                      toast.success('URL enregistrée')
                    },
                    onError: (e: unknown) =>
                      toast.error(e instanceof Error ? e.message : 'Échec'),
                  },
                )
              }
            >
              Enregistrer
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Tant qu’elle est vide, les événements attendent en file et partent
            dès qu’elle est renseignée.
          </p>
        </div>

        {pont && (
          <>
            <Separator />

            {/* --- Ce qu'on lui donne --- */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ
                cle="entree"
                libelle="Notre point d’entrée"
                valeur={`${SUPABASE_URL}/rest/v1/rpc/pont_entrant`}
                aide="C’est là qu’il POSTe ses modifications."
                copie={copie}
                onCopier={copier}
              />
              <Champ
                cle="lecture"
                libelle="Lecture de son pipe"
                valeur={`${SUPABASE_URL}/rest/v1/rpc/get_espace_artisan`}
                aide="Un appel, tous ses chantiers."
                copie={copie}
                onCopier={copier}
              />
              <Champ
                cle="cle"
                libelle="Sa clé de pont"
                valeur={pont.cle_publique}
                aide="Envoyée dans l’en-tête X-Celexia-Cle."
                copie={copie}
                onCopier={copier}
              />
              <Champ
                cle="token"
                libelle="Son jeton d’espace artisan"
                valeur={tokenArtisan}
                aide="Donne accès à tout son pipe."
                masquable
                copie={copie}
                onCopier={copier}
              />
            </div>

            <div className="space-y-1.5">
              <Champ
                cle="secret"
                libelle="Secret de signature"
                valeur={pont.secret}
                aide="Il vérifie avec HMAC-SHA256 que l’événement vient bien de nous."
                masquable
                copie={copie}
                onCopier={copier}
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                disabled={regenerer.isPending}
                onClick={() => {
                  if (
                    !window.confirm(
                      'Régénérer le secret coupe la réception chez lui tant qu’il n’a pas repris la nouvelle valeur. Continuer ?',
                    )
                  )
                    return
                  regenerer.mutate(undefined, {
                    onSuccess: () => toast.success('Secret régénéré — préviens-le'),
                    onError: (e: unknown) =>
                      toast.error(e instanceof Error ? e.message : 'Échec'),
                  })
                }}
              >
                <RefreshCw className="size-3.5" /> Régénérer le secret
              </Button>
            </div>

            <Separator />

            {/* --- Prouver le tuyau avant d'y mettre un vrai chantier --- */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={tester.isPending}
                onClick={() =>
                  tester.mutate(undefined, {
                    onSuccess: ({ code, erreur }) => {
                      if (code && code >= 200 && code < 300) {
                        toast.success(`Connexion établie — son serveur a répondu ${code}`)
                      } else {
                        toast.error(
                          code
                            ? `Son serveur a répondu ${code}${erreur ? ` — ${erreur}` : ''}`
                            : (erreur ?? 'Pas de réponse'),
                        )
                      }
                    },
                    onError: (e: unknown) =>
                      toast.error(e instanceof Error ? e.message : 'Échec'),
                  })
                }
              >
                {tester.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Zap className="size-4" />
                )}
                Tester la connexion
              </Button>
              <span className="text-xs text-muted-foreground">
                Envoie un <code className="font-mono">ping</code> à son serveur.
                Aucune donnée client, rien de créé chez lui.
              </span>
            </div>

            <Separator />

            {/* --- Le livrable : la spec pré-remplie --- */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="mb-2 text-sm font-medium">Sa notice de branchement</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Tout est déjà rempli — ses jetons, sa clé, son secret, nos URL.
                Il la colle dans son assistant de code et son CRM s’adapte. On
                ne touche jamais à son code.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!spec}
                  onClick={() => spec && copier('spec', spec, 'Notice')}
                >
                  {copie === 'spec' ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  Copier la notice
                </Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      La lire
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Notice de branchement — {societe}</DialogTitle>
                      <DialogDescription>
                        Contient le secret de signature : à transmettre par un
                        canal sûr, pas en clair dans un fil public.
                      </DialogDescription>
                    </DialogHeader>
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">
                      {spec}
                    </pre>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* --- Est-ce que ça vit ? --- */}
            <Separator />
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground">Dernier envoi réussi</p>
                <p className="font-medium">
                  {pont.derniere_reussite_at
                    ? formatDateHeure(pont.derniere_reussite_at)
                    : 'jamais'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Dernier échec</p>
                <p className={enPanne ? 'font-medium text-destructive' : 'font-medium'}>
                  {pont.dernier_echec_at
                    ? `${formatDateHeure(pont.dernier_echec_at)} — ${pont.dernier_echec ?? ''}`
                    : 'aucun'}
                </p>
              </div>
            </div>

            {Boolean(sortants?.length || entrants?.length) && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Derniers envois
                  </p>
                  <ul className="space-y-1">
                    {(sortants ?? []).slice(0, 6).map((e) => (
                      <li key={e.id} className="flex items-center gap-2 text-xs">
                        <span
                          aria-hidden
                          className={`size-1.5 shrink-0 rounded-full ${
                            e.code_http && e.code_http < 300
                              ? 'bg-primary'
                              : e.etat === 'abandonne'
                                ? 'bg-destructive'
                                : 'bg-muted-foreground/40'
                          }`}
                        />
                        <span className="truncate">{e.type}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">
                          {e.code_http ?? e.etat}
                        </span>
                      </li>
                    ))}
                    {!sortants?.length && (
                      <li className="text-xs text-muted-foreground">rien encore</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Dernières réceptions
                  </p>
                  <ul className="space-y-1">
                    {(entrants ?? []).slice(0, 6).map((e) => (
                      <li key={e.id} className="flex items-center gap-2 text-xs">
                        <span
                          aria-hidden
                          className={`size-1.5 shrink-0 rounded-full ${
                            e.resultat && (e.resultat as { ok?: boolean }).ok
                              ? 'bg-primary'
                              : 'bg-destructive'
                          }`}
                        />
                        <span className="truncate">{e.type ?? '—'}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">
                          {formatDateHeure(e.recu_at)}
                        </span>
                      </li>
                    ))}
                    {!entrants?.length && (
                      <li className="text-xs text-muted-foreground">rien encore</li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}

        {!pont && (
          <p className="text-xs text-muted-foreground">
            Active le pont pour générer sa clé, son secret et sa notice de
            branchement.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
