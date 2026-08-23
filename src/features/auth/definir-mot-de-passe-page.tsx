import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, KeyRound, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase/client'

/** Longueur minimale imposée. En dessous, un mot de passe se devine. */
const LONGUEUR_MIN = 10

/**
 * Création du mot de passe après une invitation.
 *
 * Sans cet écran, le lien reçu par e-mail renvoyait vers `/login`, qui réclame
 * un mot de passe que la personne n'a jamais défini : l'invitation ne pouvait
 * pas aboutir.
 *
 * Supabase ouvre une session temporaire en arrivant ici (jeton dans l'URL).
 * C'est cette session qui autorise `updateUser` — d'où l'attente explicite
 * avant d'afficher le formulaire, plutôt qu'un message d'erreur trompeur.
 *
 * Cette page ne crée AUCUN compte : elle pose un mot de passe sur un compte
 * déjà invité. L'inscription libre est fermée côté Supabase.
 */
export function DefinirMotDePassePage() {
  const naviguer = useNavigate()
  const [pret, setPret] = useState<boolean | null>(null)
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [envoi, setEnvoi] = useState(false)

  useEffect(() => {
    // Le jeton d'invitation est dans l'URL ; supabase-js l'échange contre une
    // session, ce qui déclenche onAuthStateChange. On attend cet événement
    // plutôt que de lire l'URL à la main.
    let fini = false

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!fini && session) {
        fini = true
        setPret(true)
      }
    })

    // Un lien à usage unique déjà consommé ouvre parfois une session sans
    // permettre la mise à jour. On ne peut pas le deviner ici : c'est
    // `updateUser` qui tranchera, et son échec est expliqué à ce moment-là.

    supabase.auth.getSession().then(({ data }) => {
      if (!fini && data.session) {
        fini = true
        setPret(true)
      }
    })

    // Un lien expiré n'ouvre aucune session : il faut le dire, pas laisser
    // tourner un chargement sans fin.
    const secours = setTimeout(() => {
      if (!fini) {
        fini = true
        setPret(false)
      }
    }, 6000)

    return () => {
      clearTimeout(secours)
      sub.subscription.unsubscribe()
    }
  }, [])

  async function valider(e: React.FormEvent) {
    e.preventDefault()
    if (motDePasse.length < LONGUEUR_MIN) {
      toast.error(`Le mot de passe doit faire au moins ${LONGUEUR_MIN} caractères.`)
      return
    }
    if (motDePasse !== confirmation) {
      toast.error('Les deux mots de passe ne correspondent pas.')
      return
    }

    setEnvoi(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: motDePasse })
      if (error) throw error

      // Preuve plutôt que promesse : on vérifie que le mot de passe ouvre
      // réellement une session. Sans ce contrôle, un échec silencieux laissait
      // la personne croire son compte prêt — elle se retrouvait bloquée au
      // premier retour sur le CRM.
      const { data: session } = await supabase.auth.getUser()
      if (!session?.user) throw new Error('Le mot de passe n’a pas pu être vérifié.')

      toast.success('Mot de passe enregistré', {
        description: 'Vous pourrez vous connecter avec cette adresse et ce mot de passe.',
      })
      naviguer('/', { replace: true })
    } catch (err) {
      toast.error('Enregistrement impossible', {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setEnvoi(false)
    }
  }

  if (pret === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!pret) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Card className="w-full max-w-sm rounded-2xl border-border/70 shadow-card">
          <CardContent className="pt-6 text-center">
            <p className="font-display text-lg tracking-tight">Lien expiré</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Ce lien d’invitation n’est plus valable. Demandez à l’agence de vous en envoyer
              un nouveau.
            </p>
            <Button variant="outline" className="mt-4 w-full" onClick={() => naviguer('/login')}>
              Retour à la connexion
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm rounded-2xl border-border/70 shadow-card">
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-full bg-primary/10">
              <KeyRound className="size-4 text-primary" />
            </span>
            <div>
              <p className="font-display text-lg leading-tight tracking-tight">
                Choisissez votre mot de passe
              </p>
              <p className="text-xs text-muted-foreground">Il vous servira à vous connecter.</p>
            </div>
          </div>

          <form onSubmit={valider} className="space-y-3">
            <div>
              <Label htmlFor="mdp">Mot de passe</Label>
              <Input
                id="mdp"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {LONGUEUR_MIN} caractères minimum.
              </p>
            </div>

            <div>
              <Label htmlFor="mdp2">Confirmation</Label>
              <Input
                id="mdp2"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </div>

            <Button type="submit" className="h-11 w-full" disabled={envoi}>
              {envoi ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Enregistrer et accéder au CRM
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
