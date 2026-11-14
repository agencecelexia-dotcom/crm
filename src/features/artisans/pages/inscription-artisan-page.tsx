import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Phone, LayoutDashboard } from 'lucide-react'

import { supabase } from '@/lib/supabase/client'
import { N8N_WEBHOOK_URL, TEL_APPORTEUR } from '@/lib/constants'
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
import { finaliserContenu, raisonRefusSignature } from '@/features/contrats/contrat-modele'
import { InscriptionForm } from '../components/inscription-form'
import type { ArtisanInput, ContratPublic } from '@/types/database'

// Numéro à faire enregistrer par l'artisan.

async function geocodeArtisan(input: ArtisanInput) {
  const adresse = composerAdresse(input)
  const coord = adresse ? await geocoder(`${adresse}, France`) : null
  if (coord) return coord
  // Une panne de localisation de l'adresse ne doit pas bloquer l'inscription.
  // Le secteur, déjà vérifié à l'étape précédente, peut fournir le centre de la ville.
  const secteur = input.zones_couvertes?.find((z) => z.ville.trim().toLowerCase() === input.ville?.trim().toLowerCase())
  return secteur?.lat != null && secteur.lon != null ? { lat: secteur.lat, lon: secteur.lon } : null
}

// Email de bienvenue avec le lien d'espace (via n8n, no-cors).
async function envoyerEmailEspace(p: {
  email: string
  lien: string
  prenom?: string | null
  nom?: string | null
}) {
  try {
    await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'bienvenue_espace',
        email: p.email,
        lien: p.lien,
        artisan_prenom: p.prenom ?? '',
        artisan_nom: p.nom ?? '',
      }),
    })
  } catch {
    /* no-cors : pas de réponse attendue */
  }
}

type Espace = { token: string; email: string; prenom: string | null; nom: string }
type Step = 'form' | 'contrat' | 'fini'
type Reprise = { step: 'contrat' | 'fini'; contratToken: string | null; espace: Espace | null; taux: number | null }
function lireProgression(token: string | undefined): Reprise | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(`celexia-inscription-suite:${token}`) ?? 'null')
    if (!r || !['contrat', 'fini'].includes(r.step)) return null
    if (r.contratToken !== null && typeof r.contratToken !== 'string') return null
    if (r.espace && (!['token', 'email', 'nom'].every((k) => typeof r.espace[k] === 'string') || (r.espace.prenom !== null && typeof r.espace.prenom !== 'string'))) return null
    if (r.taux !== null && ![10, 15, 20].includes(r.taux)) return null
    return r as Reprise
  } catch { return null }
}

// Les informations sont vérifiées avant la création de la fiche et du contrat.
// Après création, une actualisation reprend le contrat, sans recréer l'artisan.
export function InscriptionArtisanPage() {
  const { invitationToken } = useParams()
  return <InscriptionArtisan key={invitationToken ?? 'invalide'} invitationToken={invitationToken} />
}

function InscriptionArtisan({ invitationToken }: { invitationToken: string | undefined }) {
  const formatValide = /^[a-f0-9]{64}$/.test(invitationToken ?? '')
  const lien = useQuery({
    queryKey: ['lien-inscription-public', invitationToken],
    enabled: formatValide,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<{ taux: number } | null> => {
      const { data, error } = await supabase.rpc('lien_inscription_artisan', { p_token: invitationToken })
      if (error) throw error
      if (data?.ok !== true) return null
      if (![10, 15, 20].includes(data.taux)) throw new Error('Lien indisponible')
      return { taux: data.taux }
    },
  })
  const [reprise] = useState(() => lireProgression(invitationToken))
  const [tauxInscrit, setTauxInscrit] = useState<number | null>(reprise?.taux ?? null)
  const tauxPct = tauxInscrit ?? lien.data?.taux
  const [step, setStep] = useState<Step>(reprise?.step ?? 'form')
  const [submitting, setSubmitting] = useState(false)
  const [contratToken, setContratToken] = useState<string | null>(reprise?.contratToken ?? null)
  const [espace, setEspace] = useState<Espace | null>(reprise?.espace ?? null)
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null)
  const enCours = useRef(false)
  useEffect(() => {
    if (step === 'form') return
    try {
      sessionStorage.setItem(`celexia-inscription-suite:${invitationToken}`, JSON.stringify({ step, contratToken, espace, taux: tauxInscrit }))
      sessionStorage.removeItem(`celexia-inscription-brouillon-v1:${invitationToken}`)
    } catch { /* La progression reste disponible en mémoire. */ }
  }, [step, contratToken, espace, tauxInscrit, invitationToken])

  function haut() {
    window.scrollTo({ top: 0 })
    requestAnimationFrame(() => document.getElementById('inscription-contenu')?.focus())
  }

  async function onSubmit(input: ArtisanInput) {
    if (!lien.data || !invitationToken || enCours.current) return
    enCours.current = true
    setErreurEnvoi(null)
    setSubmitting(true)
    try {
      const coord = await geocodeArtisan(input)
      const payload: Record<string, unknown> = {
        ...input, latitude: coord?.lat ?? null, longitude: coord?.lon ?? null,
        invitation_token: invitationToken,
      }
      // Seul le serveur fixe ces valeurs à partir du lien reçu.
      delete payload.taux_commission
      delete payload.source
      const { data, error } = await supabase.rpc('inscrire_artisan', {
        p_payload: payload,
      })
      const r = data as
        | { ok?: boolean; error?: string; contrat_token?: string; espace_token?: string; email?: string | null; taux_commission?: number }
        | null
      if (error || !r?.ok) throw new Error(r?.error || 'Nous n’avons pas pu préparer votre contrat. Vérifiez votre connexion et réessayez ; votre saisie est conservée.')
      if (typeof r.taux_commission === 'number') setTauxInscrit(Math.round(r.taux_commission * 100))
      setContratToken(r.contrat_token ?? null)
      if (r.espace_token) {
        setEspace({
          token: r.espace_token,
          email: r.email || input.email || '',
          prenom: input.prenom ?? null,
          nom: input.nom,
        })
      }
      setStep('contrat')
      haut()
    } catch (e) {
      setErreurEnvoi(e instanceof Error ? e.message : 'Inscription indisponible. Réessayez dans un instant.')
    } finally {
      enCours.current = false
      setSubmitting(false)
    }
  }

  if (!lien.data) return (
    <main className="flex min-h-dvh items-center justify-center bg-secondary p-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-7 text-center">
        <BrandLogo className="mx-auto h-10" />
        {formatValide && lien.isLoading ? <p role="status">Vérification de votre invitation…</p> : lien.isError ? <>
          <h1 className="text-xl font-semibold">Invitation indisponible</h1>
          <p role="alert" className="text-sm text-muted-foreground">Nous n’avons pas pu vérifier votre lien. Réessayez dans un instant.</p>
          <Button onClick={() => void lien.refetch()}>Réessayer</Button>
        </> : <>
          <h1 className="text-xl font-semibold">Demandez un nouveau lien</h1>
          <p className="text-sm text-muted-foreground">Ce lien d’inscription est incomplet ou n’est plus valide. Contactez Celexia pour recevoir votre invitation.</p>
          <Button asChild><a href={`tel:${TEL_APPORTEUR}`}>Contacter Celexia</a></Button>
        </>}
      </div>
    </main>
  )

  return (
    <div className="min-h-dvh bg-gradient-to-b from-accent/60 via-secondary to-secondary">
      <main id="inscription-contenu" tabIndex={-1} className="mx-auto max-w-2xl px-4 py-6 outline-none sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-col items-center gap-2.5 text-center">
          <BrandLogo className="h-10 mix-blend-multiply" />
          {step === 'contrat' && <p className="text-xs font-medium text-primary">Étape 5 sur 5 · Contrat</p>}
        </header>

        {step === 'form' && (
          <>
            <div className="mb-4 text-center">
              <h1 className="text-xl font-semibold">Devenez partenaire Celexia</h1>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Présentez votre entreprise et votre secteur d’intervention. Vous pourrez lire le contrat avant de le signer.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 shadow-card sm:p-6">
              <InscriptionForm invitationToken={invitationToken!} taux={tauxPct!} onSubmit={onSubmit} submitting={submitting} erreurEnvoi={erreurEnvoi} />
            </div>
          </>
        )}

        {step === 'contrat' && contratToken && (
          <EtapeContrat
            token={contratToken}
            taux={tauxPct!}
            onSigned={(envoyerBienvenue) => {
              if (envoyerBienvenue && espace?.token && espace.email) {
                envoyerEmailEspace({
                  email: espace.email,
                  lien: `${window.location.origin}/artisan/${espace.token}`,
                  prenom: espace.prenom,
                  nom: espace.nom,
                })
              }
              setStep('fini')
              haut()
            }}
          />
        )}

        {step === 'contrat' && !contratToken && <Card><CardContent className="space-y-4 py-6"><h1 className="text-lg font-semibold">Votre inscription est enregistrée</h1><p role="alert" className="text-sm text-muted-foreground">Le lien du contrat n’a pas pu être récupéré. Contactez Celexia pour terminer votre inscription.</p><Button asChild><a href={`tel:${TEL_APPORTEUR}`}>Contacter Celexia</a></Button></CardContent></Card>}

        {step === 'fini' && (
          <Card className="shadow-card">
            <CardContent className="space-y-5 py-8 text-center">
              <CheckCircle2 className="mx-auto size-12 text-[#22C55E]" />
              <div>
                <h1 className="text-lg font-semibold">Bienvenue chez Celexia</h1>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Votre profil et votre contrat sont enregistrés. Dès que nous aurons un chantier
                  dans votre secteur, nous vous recontacterons au plus vite.
                </p>
              </div>

              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-left">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Phone className="size-4 text-primary" />
                  Enregistrez notre numéro
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

              {espace?.token && (
                <div className="rounded-xl border border-border p-4 text-left">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <LayoutDashboard className="size-4 text-primary" />
                    Votre espace partenaire
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Vous avez signé le contrat, vous avez donc déjà accès à votre espace. Pour
                    l'instant il n'y a pas de chantier — dès que nous vous appellerons pour vous en
                    attribuer un, il s'affichera directement ici.
                  </p>
                  <a
                    href={`${window.location.origin}/artisan/${espace.token}`}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-primary px-4 py-2.5 text-sm font-semibold text-primary"
                  >
                    <LayoutDashboard className="size-4" />
                    Ouvrir mon espace artisan
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}

// Dernière étape : lecture et signature du contrat généré depuis le récapitulatif.
function EtapeContrat({ token, taux, onSigned }: { token: string; taux: number; onSigned: (envoyerBienvenue: boolean) => void }) {
  const padRef = useRef<SignaturePadHandle>(null)
  const [nomSaisi, setNomSaisi] = useState<string | null>(null)
  const [accepte, setAccepte] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreurSignature, setErreurSignature] = useState<string | null>(null)
  const [lectureComplete, setLectureComplete] = useState(false)
  const verrou = useRef(false)
  const query = useQuery({
    queryKey: ['contrat-inscription', token], retry: false, refetchOnWindowFocus: false,
    queryFn: async (): Promise<ContratPublic> => {
      const { data, error } = await supabase.rpc('get_contrat_by_token', { p_token: token })
      if (error || !data) throw new Error('Contrat indisponible')
      return data as ContratPublic
    },
  })
  const contrat = query.data
  const nom = nomSaisi ?? [contrat?.artisan?.prenom, contrat?.artisan?.nom].filter(Boolean).join(' ')

  async function signer() {
    if (verrou.current) return
    if (!nom.trim()) { setErreurSignature('Indiquez le nom du signataire.'); document.getElementById('nom-signataire')?.focus(); return }
    if (!accepte) { setErreurSignature('Confirmez avoir lu et approuvé le contrat avant de signer.'); document.getElementById('accepte-contrat')?.focus(); return }
    if (!padRef.current || padRef.current.isEmpty()) { setErreurSignature('Dessinez votre signature dans le cadre, avec votre doigt ou votre souris.'); return }
    verrou.current = true
    setErreurSignature(null)
    setEnvoi(true)
    try {
      const { data, error } = await supabase.rpc('signer_contrat', {
        p_token: token, p_signataire: nom.trim(), p_signature: padRef.current.toDataURL(),
      })
      if (error) throw new Error('Connexion impossible. Votre signature est conservée : réessayez dans un instant.')
      if (!(data as { ok?: boolean } | null)?.ok) throw new Error(raisonRefusSignature(data as { ok?: boolean; error?: string } | null))
      toast.success('Contrat signé. Merci !')
      onSigned(true)
    } catch (e) { setErreurSignature(e instanceof Error ? e.message : 'La signature n’a pas pu être enregistrée. Réessayez.') }
    finally { verrou.current = false; setEnvoi(false) }
  }

  if (query.isLoading) return <p role="status" className="flex items-center justify-center gap-3 py-12 text-sm"><Loader2 className="size-5 animate-spin text-primary" aria-hidden />Chargement de votre contrat…</p>
  if (!contrat) return <Card><CardContent className="space-y-4 py-6"><h1 className="text-lg font-semibold">Votre contrat est momentanément indisponible</h1><p role="alert" className="text-sm text-muted-foreground">Votre inscription est enregistrée. Réessayez pour ouvrir le contrat.</p><Button onClick={() => void query.refetch()} disabled={query.isFetching}>{query.isFetching && <Loader2 className="size-4 animate-spin" aria-hidden />}Réessayer</Button><a className="ml-4 inline-flex min-h-11 items-center text-sm text-primary underline" href={`tel:${TEL_APPORTEUR}`}>Contacter Celexia</a></CardContent></Card>
  if (contrat.signed_at) return <Card><CardContent className="space-y-4 py-6"><h1 className="text-lg font-semibold">Votre contrat est déjà signé</h1><p className="text-sm text-muted-foreground">La signature a bien été enregistrée. Vous pouvez accéder à votre espace.</p><Button onClick={() => onSigned(false)}>Continuer vers mon espace</Button></CardContent></Card>

  return <Card className="shadow-card"><CardContent className="space-y-6 py-6">
    <div><h1 className="text-xl font-semibold">Votre contrat d’engagement</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Vérifiez les informations et lisez le contrat complet ci-dessous. Vous pourrez ensuite le signer avec votre doigt ou votre souris.</p></div>
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-primary">Taux de commission</p><p className="mt-2 font-semibold">{taux} % du montant TTC des devis signés</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">La commission est due dès la signature du devis par le client, pour un chantier apporté par Celexia. Le contrat précise les conditions et les délais de paiement.</p></div>
    <div className="space-y-2"><Button type="button" variant="outline" className="min-h-11 w-full" aria-expanded={lectureComplete} aria-controls="lecture-contrat" onClick={() => setLectureComplete((v) => !v)}>{lectureComplete ? 'Réduire la lecture' : 'Agrandir la lecture du contrat'}</Button>
      <div id="lecture-contrat" role="region" aria-label="Texte intégral du contrat" tabIndex={0} className={`${lectureComplete ? '' : 'max-h-[60dvh] overflow-y-auto'} rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-primary`}>
        <ContratFormate contenu={finaliserContenu(contrat.contenu, contrat.signed_at)} signedAt={contrat.signed_at} apporteurSignature={contrat.apporteur_signature} />
      </div>
      {!lectureComplete && <p className="text-xs text-muted-foreground">Faites défiler le texte dans le cadre, ou agrandissez la lecture.</p>}
    </div>
    <form noValidate onSubmit={(e) => { e.preventDefault(); void signer() }} className="space-y-5">
      <div className="space-y-2"><Label htmlFor="nom-signataire">Nom du signataire *</Label><Input id="nom-signataire" autoComplete="name" className="h-12" value={nom} onChange={(e) => setNomSaisi(e.target.value)} disabled={envoi} /></div>
      <fieldset disabled={envoi} className="space-y-2"><legend className="sr-only">Signature manuscrite</legend><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">Votre signature *</span><Button type="button" variant="ghost" className="min-h-11" onClick={() => padRef.current?.clear()}>Effacer la signature</Button></div><p id="aide-signature" className="text-xs text-muted-foreground">Dessinez dans le cadre avec votre doigt sur téléphone, ou avec votre souris sur ordinateur.</p><div className={envoi ? 'pointer-events-none' : undefined}><SignaturePad ref={padRef} className="h-44 w-full rounded-lg border border-input bg-white" /></div></fieldset>
      <label className="flex min-h-12 items-start gap-3 rounded-lg border border-border p-3 text-sm leading-relaxed"><Checkbox id="accepte-contrat" checked={accepte} onCheckedChange={(v) => setAccepte(v === true)} disabled={envoi} className="mt-0.5 size-5 shrink-0" /><span>J’ai lu et j’approuve l’intégralité des conditions du présent contrat.</span></label>
      {erreurSignature && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{erreurSignature}</p>}
      <Button type="submit" disabled={envoi} className="min-h-12 w-full whitespace-normal text-base">{envoi && <Loader2 className="size-4 animate-spin" aria-hidden />}{envoi ? 'Enregistrement de la signature…' : 'Signer et accéder à mon espace'}</Button>
    </form>
    <p className="text-xs leading-relaxed text-muted-foreground">Une information à corriger ou une question ? <a className="text-primary underline" href={`tel:${TEL_APPORTEUR}`}>Contactez Celexia au {formatTel(TEL_APPORTEUR)}</a>.</p>
  </CardContent></Card>
}
