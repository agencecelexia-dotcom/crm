import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckCircle2 } from 'lucide-react'

import { supabase } from '@/lib/supabase/client'
import { BrandLogo } from '@/components/brand-logo'
import { composerAdresse, geocoder } from '@/lib/geocoding'
import { ArtisanForm } from '../components/artisan-form'
import type { ArtisanInput } from '@/types/database'

// Géocode l'adresse (du + précis au - précis) pour placer l'artisan sur la carte.
async function geocodeArtisan(input: ArtisanInput) {
  const candidats = [
    composerAdresse({ adresse: input.adresse, code_postal: input.code_postal, ville: input.ville }),
    composerAdresse({ code_postal: input.code_postal, ville: input.ville }),
    composerAdresse({ ville: input.ville }),
    composerAdresse({ code_postal: input.code_postal }),
  ].filter((a, i, arr): a is string => !!a && arr.indexOf(a) === i)
  for (const c of candidats) {
    const coord = await geocoder(c)
    if (coord) return coord
  }
  return null
}

// Lien PUBLIC d'auto-inscription des artisans (WhatsApp / Facebook…).
// Route : /rejoindre/:canal (ex. /rejoindre/facebook) → artisan tagué source=auto:facebook.
export function InscriptionArtisanPage() {
  const { canal } = useParams()
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(input: ArtisanInput) {
    setSubmitting(true)
    try {
      const coord = await geocodeArtisan(input)
      const { data, error } = await supabase.rpc('inscrire_artisan', {
        p_payload: {
          ...input,
          latitude: coord?.lat ?? null,
          longitude: coord?.lon ?? null,
          source: `auto:${canal || 'lien'}`,
        },
      })
      const r = data as { ok?: boolean; error?: string } | null
      if (error || !r?.ok) throw new Error(r?.error || error?.message || 'Inscription impossible')
      setDone(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      toast.error("Échec de l'inscription", {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-accent/60 via-secondary to-secondary">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-6 flex flex-col items-center gap-2.5 text-center">
          <BrandLogo className="h-10 mix-blend-multiply" />
          <h1 className="text-xl font-semibold">Devenez partenaire Celexia</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Recevez des chantiers près de chez vous, sans abonnement ni engagement. Renseignez votre
            activité ci-dessous — dès que nous aurons un chantier dans votre secteur, nous vous
            recontacterons.
          </p>
        </header>

        {done ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
            <CheckCircle2 className="mx-auto mb-3 size-12 text-[#22C55E]" />
            <h2 className="text-lg font-semibold">Merci, c'est enregistré ✅</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Votre profil est bien enregistré. Dès que nous aurons un chantier dans votre secteur,
              nous vous recontacterons au plus vite.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-card sm:p-6">
            <ArtisanForm onSubmit={onSubmit} submitting={submitting} submitLabel="M'inscrire" hideCommission />
          </div>
        )}
      </div>
    </div>
  )
}
