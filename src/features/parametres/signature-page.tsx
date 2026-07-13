import { useRef, useState } from 'react'
import { Loader2, Eraser, Save, PenTool, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { SignaturePad, type SignaturePadHandle } from '@/components/signature-pad'
import {
  CLE_SIGNATURE_APPORTEUR,
  useParametre,
  useSetParametre,
} from './use-parametres'

// Écran admin : l'associé (apporteur CELEXIA) dépose sa signature UNE fois.
// Elle sera apposée automatiquement, avec la date, sur chaque contrat artisan.
export function ParametresSignaturePage() {
  const padRef = useRef<SignaturePadHandle>(null)
  const { data: signatureActuelle, isLoading } = useParametre(CLE_SIGNATURE_APPORTEUR)
  const enregistrer = useSetParametre()
  const [apercu, setApercu] = useState<string | null>(null)

  function sauvegarder() {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error('Dessine ta signature avant d’enregistrer')
      return
    }
    const dataUrl = padRef.current.toDataURL()
    enregistrer.mutate(
      { cle: CLE_SIGNATURE_APPORTEUR, valeur: dataUrl },
      {
        onSuccess: () => {
          setApercu(dataUrl)
          toast.success('Signature enregistrée')
          padRef.current?.clear()
        },
        onError: (err) =>
          toast.error('Enregistrement impossible', {
            description: err instanceof Error ? err.message : undefined,
          }),
      },
    )
  }

  const signatureCourante = apercu ?? signatureActuelle

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        titre="Ma signature"
        sousTitre="Apposée automatiquement sur les contrats des artisans"
      />

      {/* Signature actuelle */}
      <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
        <CardHeader>
          <CardTitre>
            <PenTool className="size-4 text-primary" />
            Signature enregistrée
          </CardTitre>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : signatureCourante ? (
            <div className="flex items-center gap-3">
              <img
                src={signatureCourante}
                alt="Signature de l'apporteur"
                className="h-24 w-auto rounded-md border border-border bg-white p-2"
              />
              <span className="flex items-center gap-1 text-sm text-[#16A34A]">
                <CheckCircle2 className="size-4" />
                Active
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucune signature enregistrée pour le moment. Dessine-la ci-dessous.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Nouvelle signature */}
      <Card className="rounded-2xl border-border/70 shadow-card">
        <CardHeader>
          <CardTitre>
            {signatureCourante ? 'Modifier ma signature' : 'Déposer ma signature'}
          </CardTitre>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Signe dans le cadre ci-dessous (au doigt sur mobile, à la souris sur ordinateur).
          </p>
          <SignaturePad ref={padRef} className="h-48 w-full rounded-lg border border-border" />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => padRef.current?.clear()}>
              <Eraser className="size-4" />
              Effacer
            </Button>
            <Button onClick={sauvegarder} disabled={enregistrer.isPending}>
              {enregistrer.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Enregistrer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
