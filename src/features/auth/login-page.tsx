import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

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
import { Card, CardContent } from '@/components/ui/card'
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
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  // Déjà connecté → on file au dashboard
  if (session) return <Navigate to="/" replace />

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    try {
      await signIn(values.email, values.password)
      navigate('/', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connexion impossible'
      toast.error('Échec de la connexion', { description: message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4">
      {/* Décor violet (purement visuel) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-violet-100 via-violet-50/60 to-transparent" />
        <div className="absolute -right-20 -top-16 size-72 rounded-full bg-violet-300/20 blur-3xl" />
        <div className="absolute -bottom-24 -left-16 size-64 rounded-full bg-violet-400/10 blur-3xl" />
      </div>

      <div className="mb-8 flex flex-col items-center gap-3">
        <BrandLogo className="h-10 mix-blend-multiply" />
        <p className="text-sm text-muted-foreground">CRM — espace associés</p>
      </div>

      <Card className="w-full max-w-sm rounded-2xl border-border/70 shadow-card animate-in fade-in slide-in-from-bottom-2 duration-300">
        <CardContent className="pt-6">
          {supabaseMisconfigured && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              Configuration Supabase manquante. Renseigne <code>VITE_SUPABASE_URL</code>{' '}
              et <code>VITE_SUPABASE_ANON_KEY</code> dans <code>.env.local</code>.
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                        placeholder="associe@celexia.fr"
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
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        className="h-11"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="h-11 w-full shadow-violet transition-transform active:scale-[0.99]"
                disabled={submitting || supabaseMisconfigured}
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Se connecter
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
