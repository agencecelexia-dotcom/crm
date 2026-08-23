import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import type { Membre } from '@/types/database'

/** Droits activables un par un. Le libellé dit ce que la personne pourra faire. */
const DROITS = [
  { cle: 'peut_creer_lead', label: 'Saisir des leads' },
  { cle: 'peut_attribuer', label: 'Attribuer à un artisan' },
  { cle: 'peut_creer_artisan', label: 'Ajouter des artisans' },
  { cle: 'peut_voir_commissions', label: 'Voir les commissions agence' },
] as const

/**
 * Gestion des accès au CRM.
 *
 * Réservée aux fondateurs (route protégée + RLS). Le cloisonnement réel est
 * appliqué en base : un commercial désactivé ici ne voit plus rien, même en
 * forçant une URL.
 */
export function EquipePage() {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [nom, setNom] = useState('')
  const [taux, setTaux] = useState('10')
  const [envoi, setEnvoi] = useState(false)
  // Lien de secours quand l'e-mail n'est pas parti (quota Supabase atteint).
  const [lienManuel, setLienManuel] = useState<string | null>(null)

  const { data: membres, isLoading } = useQuery({
    queryKey: ['membres'],
    queryFn: async (): Promise<Membre[]> => {
      const { data, error } = await supabase
        .from('membres')
        .select('*')
        .order('role')
        .order('nom')
      if (error) throw error
      return (data ?? []) as Membre[]
    },
  })

  const patch = useMutation({
    mutationFn: async ({ id, champ, valeur }: { id: string; champ: string; valeur: unknown }) => {
      const { error } = await supabase.from('membres').update({ [champ]: valeur }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['membres'] }),
    onError: (e) =>
      toast.error('Modification impossible', {
        description: e instanceof Error ? e.message : undefined,
      }),
  })

  async function inviter() {
    const mail = email.trim().toLowerCase()
    const t = parseFloat(taux.replace(',', '.'))
    if (!mail || !nom.trim()) {
      toast.error('Renseignez le nom et l’e-mail.')
      return
    }
    if (!Number.isFinite(t) || t < 0 || t > 100) {
      toast.error('Le taux doit être compris entre 0 et 100 %.')
      return
    }

    setEnvoi(true)
    try {
      // L'invitation passe par une edge function : créer un compte demande la
      // clé `service_role`, qui n'a rien à faire dans un bundle public. La
      // fonction revérifie côté serveur que l'appelant est bien fondateur.
      const { data, error } = await supabase.functions.invoke('inviter-membre', {
        body: { email: mail, nom: nom.trim(), taux: t / 100 },
      })
      const r = data as { ok?: boolean; error?: string; lien_manuel?: string | null } | null
      if (error || !r?.ok) {
        const messages: Record<string, string> = {
          reserve_fondateur: 'Seul un fondateur peut inviter.',
          nom_requis: 'Le nom est obligatoire.',
          taux_invalide: 'Le taux doit être compris entre 0 et 100 %.',
          email_invalide: 'Adresse e-mail invalide.',
          invitation_impossible: "L'e-mail d'invitation n'a pas pu être envoyé.",
          enregistrement_impossible: 'Compte créé mais non enregistré. Contactez le support.',
        }
        throw new Error((r?.error && messages[r.error]) || "L'invitation n'a pas pu être envoyée.")
      }

      if (r.lien_manuel) {
        // L'e-mail n'est pas parti : plutôt qu'un échec, on donne le lien à
        // transmettre soi-même. Le compte, lui, est bien créé.
        setLienManuel(r.lien_manuel)
        toast.warning('Compte créé, mais l’e-mail n’est pas parti', {
          description: 'Transmettez le lien affiché ci-dessous.',
        })
      } else {
        setLienManuel(null)
        toast.success(`Invitation envoyée à ${mail}`)
      }
      setEmail('')
      setNom('')
      void qc.invalidateQueries({ queryKey: ['membres'] })
    } catch (e) {
      toast.error('Invitation impossible', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setEnvoi(false)
    }
  }

  if (isLoading) return <Skeleton className="m-4 h-80 rounded-2xl" />

  const fondateurs = membres?.filter((m) => m.role === 'fondateur') ?? []
  const commerciaux = membres?.filter((m) => m.role === 'commercial') ?? []

  return (
    <div>
      <PageHeader titre="Équipe" />

      {/* ---- Inviter ---- */}
      <Card className="mb-5 rounded-2xl border-border/70 shadow-card">
        <CardContent className="pt-4">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
            <UserPlus className="size-4 text-primary" />
            Inviter un commercial
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px_auto] sm:items-end">
            <div>
              <Label htmlFor="nom">Nom</Label>
              <Input id="nom" value={nom} onChange={(e) => setNom(e.target.value)}
                     placeholder="Prénom Nom" />
            </div>
            <div>
              <Label htmlFor="mail">E-mail</Label>
              <Input id="mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                     placeholder="prenom@exemple.fr" />
            </div>
            <div>
              <Label htmlFor="taux">Sa part</Label>
              <div className="flex items-center gap-1">
                <Input id="taux" inputMode="decimal" value={taux}
                       onChange={(e) => setTaux(e.target.value)} />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <Button onClick={() => void inviter()} disabled={envoi}>
              {envoi ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Inviter
            </Button>
          </div>
          {lienManuel && (
            <div className="mt-3 rounded-md border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-3">
              <p className="text-sm font-medium">Lien à transmettre</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                L’e-mail n’a pas pu partir (quota d’envoi atteint). Le compte est bien créé :
                envoyez ce lien à la personne, il vaut invitation.
              </p>
              <div className="mt-2 flex gap-2">
                <Input readOnly value={lienManuel} className="h-9 font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 shrink-0"
                  onClick={() => {
                    void navigator.clipboard.writeText(lienManuel)
                    toast.success('Lien copié')
                  }}
                >
                  Copier
                </Button>
              </div>
            </div>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            Il recevra un e-mail pour créer son mot de passe. Sa part est calculée sur la
            commission <strong>encaissée</strong> par l'agence, jamais à la signature.
          </p>
        </CardContent>
      </Card>

      {/* ---- Fondateurs ---- */}
      <h2 className="mb-2 flex items-center gap-2 font-display text-lg tracking-tight">
        <ShieldCheck className="size-4 text-primary" />
        Fondateurs
      </h2>
      <div className="mb-5 space-y-2">
        {fondateurs.map((m) => (
          <Card key={m.id} className="rounded-2xl border-border/70 p-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{m.nom}</span>
              <span className="text-sm text-muted-foreground">{m.email}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Accès complet — commissions, artisans, réglages, tous les leads.
            </p>
          </Card>
        ))}
      </div>

      {/* ---- Commerciaux ---- */}
      <h2 className="mb-2 flex items-center gap-2 font-display text-lg tracking-tight">
        <Users className="size-4 text-primary" />
        Commerciaux
      </h2>

      {commerciaux.length === 0 ? (
        <EmptyState
          icon={Users}
          titre="Aucun commercial"
          description="Invitez votre premier commercial ci-dessus. Il ne verra que ses propres leads et les chantiers que vous lui confiez."
        />
      ) : (
        <div className="space-y-3">
          {commerciaux.map((m) => (
            <Card
              key={m.id}
              className={cn(
                'rounded-2xl p-4 shadow-card',
                m.actif ? 'border-border/70' : 'border-border bg-muted/30 opacity-70',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-base tracking-tight">{m.nom}</p>
                  <p className="text-sm text-muted-foreground">{m.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Part : <strong>{Math.round(m.taux_retrocession * 100)} %</strong> de la
                    commission encaissée
                    {!m.active_at && ' · invitation en attente'}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm">
                  <Switch
                    checked={m.actif}
                    onCheckedChange={(v) =>
                      patch.mutate({ id: m.id, champ: 'actif', valeur: v })
                    }
                  />
                  {m.actif ? 'Actif' : 'Désactivé'}
                </label>
              </div>

              {/* Les droits ne s'affichent que si le compte est actif : régler
                  les permissions d'un compte fermé n'a pas de sens. */}
              {m.actif && (
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3">
                  {DROITS.map((d) => (
                    <label key={d.cle} className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={Boolean(m[d.cle])}
                        onCheckedChange={(v) =>
                          patch.mutate({ id: m.id, champ: d.cle, valeur: v })
                        }
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Un commercial ne voit que les leads qu'il a saisis et ceux que vous lui confiez à
        reprendre. Il n'a jamais accès aux commissions de l'agence, au vivier de prospection ni
        aux réglages — même en tapant l'adresse directement.
      </p>
    </div>
  )
}
