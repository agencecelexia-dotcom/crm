import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, ArrowRight, ShieldCheck, Phone } from 'lucide-react'

import { supabase } from '@/lib/supabase/client'
import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad'
import { composerAdresse, geocoder } from '@/lib/geocoding'
import { formatTel } from '@/lib/format'
import { ContratFormate } from '@/features/contrats/contrat-format'
import { finaliserContenu } from '@/features/contrats/contrat-modele'
import { ArtisanForm } from '../components/artisan-form'
import type { ArtisanInput, ContratPublic } from '@/types/database'

// Numéro à faire enregistrer par l'artisan.
const TEL_APPORTEUR = '0769136182'

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

type Step = 'form' | 'explication' | 'contrat' | 'fini'

// Lien PUBLIC d'auto-inscription artisan (WhatsApp/Facebook…), en 3 étapes :
// 1) fiche complète → 2) explication du contrat → 3) signature → message final.
export function InscriptionArtisanPage() {
  const { canal } = useParams()
  const [step, setStep] = useState<Step>('form')
  const [submitting, setSubmitting] = useState(false)
  const [contratToken, setContratToken] = useState<string | null>(null)

  function haut() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

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
      const r = data as { ok?: boolean; error?: string; contrat_token?: string } | null
      if (error || !r?.ok) throw new Error(r?.error || error?.message || 'Inscription impossible')
      setContratToken(r.contrat_token ?? null)
      setStep('explication')
      haut()
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
          {step !== 'fini' && (
            <p className="text-xs font-medium text-muted-foreground">
              Étape {step === 'form' ? 1 : step === 'explication' ? 2 : 3} / 3
            </p>
          )}
        </header>

        {step === 'form' && (
          <>
            <div className="mb-4 text-center">
              <h1 className="text-xl font-semibold">Devenez partenaire Celexia</h1>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Recevez des chantiers près de chez vous, sans abonnement ni engagement. Renseignez
                votre activité (tous les champs sont nécessaires pour établir le contrat).
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card sm:p-6">
              <ArtisanForm
                onSubmit={onSubmit}
                submitting={submitting}
                submitLabel="Continuer →"
                hideCommission
                strict
              />
            </div>
          </>
        )}

        {step === 'explication' && (
          <Card className="shadow-card">
            <CardContent className="space-y-4 py-6">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-6 text-primary" />
                <h1 className="text-lg font-semibold">Pourquoi un contrat ?</h1>
              </div>
              <div className="space-y-3 text-sm leading-relaxed text-foreground">
                <p>
                  Avant de vous envoyer des chantiers, on met en place un <b>contrat d'apport
                  d'affaires</b>. C'est simple et ça nous protège tous les deux :
                </p>
                <ul className="space-y-2">
                  <li className="flex gap-2">
                    <span>•</span>
                    <span>
                      Il <b>fixe notre commission de 10 %</b> sur les chantiers qu'on vous apporte —
                      noir sur blanc, pas de mauvaise surprise.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span>•</span>
                    <span>
                      Il <b>contractualise la relation</b> : sans contrat, si on vous apporte un beau
                      chantier, rien n'encadre les choses. Là, c'est clair et sécurisé pour vous
                      comme pour nous.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span>•</span>
                    <span>
                      Il ne vous engage à <b>rien tant qu'il n'y a pas de chantier</b> : la
                      commission n'est due <b>que si un chantier qu'on vous a apporté aboutit</b>.
                      Pas de chantier = rien à payer. Aucun abonnement, aucun frais d'entrée.
                    </span>
                  </li>
                </ul>
              </div>
              <Button className="h-12 w-full text-base" onClick={() => { setStep('contrat'); haut() }}>
                Lire et signer le contrat
                <ArrowRight className="size-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'contrat' && contratToken && (
          <EtapeContrat token={contratToken} onSigned={() => { setStep('fini'); haut() }} />
        )}

        {step === 'fini' && (
          <Card className="shadow-card">
            <CardContent className="space-y-5 py-8 text-center">
              <CheckCircle2 className="mx-auto size-12 text-[#22C55E]" />
              <div>
                <h2 className="text-lg font-semibold">Bienvenue chez Celexia ✅</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Votre profil et votre contrat sont enregistrés. Dès que nous aurons un chantier
                  dans votre secteur, nous vous recontacterons au plus vite.
                </p>
              </div>

              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-left">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Phone className="size-4 text-primary" />
                  Enregistrez notre numéro 📲
                </p>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Ajoutez ce contact dans votre téléphone sous le nom{' '}
                  <b className="text-foreground">« Antoine apporteur d'affaires »</b> — comme ça,
                  quand on vous appelle, vous saurez tout de suite que c'est pour un chantier.
                </p>
                <a
                  href={`tel:${TEL_APPORTEUR}`}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                >
                  <Phone className="size-4" />
                  {formatTel(TEL_APPORTEUR)}
                </a>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

// Étape 3 : contrat auto-rempli + signature (réutilise get_contrat_by_token / signer_contrat).
function EtapeContrat({ token, onSigned }: { token: string; onSigned: () => void }) {
  const padRef = useRef<SignaturePadHandle>(null)
  const [contrat, setContrat] = useState<ContratPublic | null>(null)
  const [chargement, setChargement] = useState(true)
  const [nom, setNom] = useState('')
  const [accepte, setAccepte] = useState(false)
  const [envoi, setEnvoi] = useState(false)

  useEffect(() => {
    supabase.rpc('get_contrat_by_token', { p_token: token }).then(({ data, error }) => {
      if (!error && data) {
        const c = data as ContratPublic
        setContrat(c)
        if (c.artisan) setNom([c.artisan.prenom, c.artisan.nom].filter(Boolean).join(' '))
      }
      setChargement(false)
    })
  }, [token])

  async function signer() {
    if (!nom.trim()) return toast.error('Indiquez votre nom')
    if (!accepte) return toast.error('Cochez « Lu et approuvé »')
    if (padRef.current?.isEmpty()) return toast.error('Signez dans le cadre')
    setEnvoi(true)
    try {
      const { data, error } = await supabase.rpc('signer_contrat', {
        p_token: token,
        p_signataire: nom.trim(),
        p_signature: padRef.current!.toDataURL(),
      })
      const ok = (data as { ok?: boolean } | null)?.ok
      if (error || !ok) throw new Error('Signature impossible')
      toast.success('Contrat signé. Merci !')
      onSigned()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setEnvoi(false)
    }
  }

  if (chargement)
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  if (!contrat)
    return <p className="py-12 text-center text-sm text-muted-foreground">Contrat introuvable.</p>

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-5 py-6">
        <h1 className="text-lg font-semibold">Votre contrat d'engagement</h1>
        <p className="text-sm text-muted-foreground">
          Pré-rempli avec vos informations. Vérifiez, puis signez ci-dessous.
        </p>

        <div className="max-h-[50dvh] overflow-y-auto rounded-lg border border-border">
          <ContratFormate
            contenu={finaliserContenu(contrat.contenu, contrat.signed_at)}
            signedAt={contrat.signed_at}
            apporteurSignature={contrat.apporteur_signature}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nom">Nom du signataire</Label>
          <Input id="nom" className="h-11" value={nom} onChange={(e) => setNom(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Signature</Label>
            <Button type="button" variant="ghost" size="sm" onClick={() => padRef.current?.clear()}>
              Effacer
            </Button>
          </div>
          <SignaturePad ref={padRef} className="h-40 w-full rounded-lg border border-input bg-white" />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={accepte}
            onCheckedChange={(v) => setAccepte(v === true)}
            className="mt-0.5"
          />
          <span>J'ai lu et j'approuve l'intégralité des conditions du présent contrat.</span>
        </label>

        <Button onClick={signer} disabled={envoi} className="h-12 w-full text-base">
          {envoi && <Loader2 className="size-4 animate-spin" />}
          Signer le contrat
        </Button>
      </CardContent>
    </Card>
  )
}
