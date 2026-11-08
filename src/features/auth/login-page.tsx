import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react'

import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { useAuth } from '@/lib/auth/use-auth'
import { supabaseMisconfigured } from '@/lib/supabase/client'

const schema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
})
type FormValues = z.infer<typeof schema>

// Écran de connexion (Supabase Auth email + mot de passe).
export function LoginPage() {
  const { session, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [submitting, setSubmitting] = useState(false)
  const [visible, setVisible] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const from: unknown = location.state?.from
  const destination = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login') ? from : '/'

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  // Déjà connecté → on file au dashboard
  if (session) return <Navigate to={destination} replace />

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    setErreur(null)
    try {
      await signIn(values.email, values.password)
      navigate(destination, { replace: true })
    } catch (err) {
      setErreur(err instanceof Error && /invalid login credentials/i.test(err.message)
        ? 'Email ou mot de passe incorrect. Vérifie tes identifiants.'
        : 'Connexion impossible pour le moment. Vérifie ta connexion et réessaie.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-dvh bg-card">
      <div className="grid min-h-dvh md:grid-cols-[0.9fr_1.1fr]">
        <section className="flex flex-col justify-between bg-[#202126] p-7 text-white sm:p-10 md:p-12 lg:p-16">
          <div>
            <BrandLogo sombre className="h-8" />
            <p className="mt-4 text-xs text-[#b1b2bd]">Espace de travail Celexia</p>
          </div>
          <div className="mt-10 md:my-20">
            <h1 className="max-w-lg text-3xl font-medium leading-[1.12] tracking-[-0.025em] md:text-5xl lg:text-[56px]">Du premier appel<br />au chantier signé</h1>
            <p className="mt-6 max-w-sm text-sm leading-7 text-[#b1b2bd]">
              Clients, artisans et commissions : retrouve les dossiers de l’agence et la prochaine action à mener.
            </p>
          </div>
          <ol className="mt-8 hidden items-center gap-4 border-t border-white/15 pt-6 text-xs text-[#c4c5ce] md:flex" aria-label="Parcours d’un projet">
            <li>Projet</li><li aria-hidden><ArrowRight className="size-4" /></li>
            <li>Artisan</li><li aria-hidden><ArrowRight className="size-4" /></li>
            <li>Devis signé</li>
          </ol>
        </section>
        <section className="mx-auto flex w-full max-w-[460px] flex-col justify-center px-7 py-10 sm:px-10 md:py-16" aria-labelledby="connexion-titre">
          <h2 id="connexion-titre" className="text-3xl font-medium tracking-tight">Connexion</h2>
          <p className="mb-9 mt-3 text-[13px] leading-6 text-muted-foreground">Accès réservé à l’équipe Celexia</p>
          {supabaseMisconfigured && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              Configuration Supabase manquante. Renseigne <code>VITE_SUPABASE_URL</code>{' '}
              et <code>VITE_SUPABASE_ANON_KEY</code> dans <code>.env.local</code>.
            </div>
          )}

          <Form {...form}>
            <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" aria-busy={submitting}>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="prenom@celexia.fr"
                        className="h-11"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mot de passe</FormLabel>
                    <div className="relative">
                    <FormControl>
                      <Input
                        type={visible ? 'text' : 'password'}
                        autoComplete="current-password"
                        className="h-11 pr-12"
                        {...field}
                      />
                    </FormControl>
                    <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-11 w-11" aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={visible} onClick={() => setVisible(!visible)}>
                      {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {erreur && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{erreur}</p>}
              <Button
                type="submit"
                className="h-11 w-full"
                disabled={submitting || supabaseMisconfigured}
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Se connecter
              </Button>
            </form>
          </Form>
        </section>
      </div>
    </main>
  )
}
