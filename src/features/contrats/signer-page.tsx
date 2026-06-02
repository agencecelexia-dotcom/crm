import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, CheckCircle2, FileText } from 'lucide-react'
import { toast } from 'sonner'

import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad'
import { supabase } from '@/lib/supabase/client'
import { formatDate } from '@/lib/format'
import { finaliserContenu } from './contrat-modele'
import type { ContratPublic } from '@/types/database'

// Page PUBLIQUE de signature d'un contrat (accès par token, sans authentification).
export function SignerPage() {
  const { token } = useParams()
  const padRef = useRef<SignaturePadHandle>(null)

  const [contrat, setContrat] = useState<ContratPublic | null>(null)
  const [chargement, setChargement] = useState(true)
  const [introuvable, setIntrouvable] = useState(false)
  const [nom, setNom] = useState('')
  const [accepte, setAccepte] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [signe, setSigne] = useState(false)

  useEffect(() => {
    if (!token) return
    supabase
      .rpc('get_contrat_by_token', { p_token: token })
      .then(({ data, error }) => {
        if (error || !data) setIntrouvable(true)
        else {
          const c = data as ContratPublic
          setContrat(c)
          if (c.statut === 'signe') setSigne(true)
          if (c.artisan)
            setNom([c.artisan.prenom, c.artisan.nom].filter(Boolean).join(' '))
        }
        setChargement(false)
      })
  }, [token])

  async function signer() {
    if (!token) return
    if (!nom.trim()) return toast.error('Indique ton nom')
    if (!accepte) return toast.error('Tu dois cocher « Lu et approuvé »')
    if (padRef.current?.isEmpty()) return toast.error('Signe dans le cadre')

    setEnvoi(true)
    try {
      const signature = padRef.current!.toDataURL()
      const { data, error } = await supabase.rpc('signer_contrat', {
        p_token: token,
        p_signataire: nom.trim(),
        p_signature: signature,
      })
      const ok = (data as { ok?: boolean } | null)?.ok
      if (error || !ok) throw new Error('Signature impossible (contrat déjà signé ?)')
      setSigne(true)
      toast.success('Contrat signé. Merci !')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setEnvoi(false)
    }
  }

  // États de chargement / erreur
  if (chargement)
    return (
      <Centre>
        <Loader2 className="size-6 animate-spin text-primary" />
      </Centre>
    )
  if (introuvable || !contrat)
    return (
      <Centre>
        <FileText className="mb-2 size-8 text-muted-foreground" />
        <p className="font-medium">Contrat introuvable</p>
        <p className="text-sm text-muted-foreground">Le lien est invalide ou expiré.</p>
      </Centre>
    )

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-secondary px-4 py-6">
      <div className="mb-6 flex justify-center">
        <BrandLogo className="h-9" />
      </div>

      {signe ? (
        <Card className="shadow-card">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 className="size-10 text-[#22C55E]" />
            <p className="text-lg font-semibold">Contrat signé</p>
            <p className="text-sm text-muted-foreground">
              Merci {contrat.signataire_nom ?? ''}.
              {contrat.signed_at && ` Signé le ${formatDate(contrat.signed_at)}.`}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              L'équipe Celexia revient vers toi très vite avec les détails du projet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-card">
          <CardContent className="space-y-5 py-6">
            <h1 className="text-lg font-semibold">Contrat d'engagement</h1>

            {/* Texte du contrat */}
            <div className="max-h-[45dvh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm leading-relaxed">
              {finaliserContenu(contrat.contenu, contrat.signed_at)}
            </div>

            {/* Nom du signataire */}
            <div className="space-y-1.5">
              <Label htmlFor="nom">Nom du signataire</Label>
              <Input
                id="nom"
                className="h-11"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
              />
            </div>

            {/* Signature */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Signature</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => padRef.current?.clear()}
                >
                  Effacer
                </Button>
              </div>
              <SignaturePad
                ref={padRef}
                className="h-40 w-full rounded-lg border border-input bg-white"
              />
            </div>

            {/* Lu et approuvé */}
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={accepte}
                onCheckedChange={(v) => setAccepte(v === true)}
                className="mt-0.5"
              />
              <span>
                J'ai lu et j'approuve l'intégralité des conditions du présent contrat.
              </span>
            </label>

            <Button onClick={signer} disabled={envoi} className="h-12 w-full text-base">
              {envoi && <Loader2 className="size-4 animate-spin" />}
              Signer le contrat
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      {children}
    </div>
  )
}
