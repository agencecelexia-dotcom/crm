import { useState } from 'react'
import { Link2, Copy, Check, Mail } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { InvitationEmailForm } from './invitation-email-form'
import { useLiensInscription } from '../use-liens-inscription'
import { lienInscription } from '../../../../supabase/functions/_invitation-artisan'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

// Canaux de diffusion du lien public d'auto-inscription artisan.
const CANAUX = [
  { id: 'lien', label: 'Lien général' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
]

// Les liens sont générés côté serveur et disponibles uniquement à l'agence.
const TAUX = [10, 15, 20] as const

export function LienInscriptionButton() {
  const [copie, setCopie] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState(false)
  const [invitation, setInvitation] = useState<10 | 15 | 20 | null>(null)
  const liens = useLiensInscription(ouvert)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const jeton = (canal: string, taux: number) => liens.data?.find((l) => l.canal === canal && l.taux === taux)?.token
  const tokenEmail = invitation ? jeton('email', invitation) : undefined

  async function copier(id: string, taux: number) {
    const cle = `${id}-${taux}`
    try {
      const token = jeton(id, taux)
      if (!token) throw new Error('Lien indisponible')
      await navigator.clipboard.writeText(lienInscription(origin, token))
      setCopie(cle)
      toast.success(`Lien ${taux}% copié`)
      window.setTimeout(() => setCopie((c) => (c === cle ? null : c)), 1500)
    } catch {
      toast.error('Copie impossible — copie le lien à la main')
    }
  }

  return (
    <Dialog onOpenChange={(open) => { setOuvert(open); if (!open) setInvitation(null) }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Lien d'inscription" title="Lien d'inscription">
          <Link2 className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{invitation ? `Invitation par email · ${invitation} %` : "Liens d'inscription artisan"}</DialogTitle>
          <DialogDescription>
            Un lien par canal et par taux : <b>10 %</b>, <b>15 %</b> ou{' '}
            <b>20 %</b>. La commission porte sur le <b>montant TTC</b> ; le contrat de
            l'artisan reprend le taux du lien qu'il a utilisé.
          </DialogDescription>
        </DialogHeader>
        {liens.isError && <div role="alert" className="space-y-2 text-sm text-destructive"><p>Impossible de charger les liens d’inscription.</p><Button variant="outline" size="sm" onClick={() => void liens.refetch()}>Réessayer</Button></div>}
        {liens.isLoading && <p role="status" className="text-sm text-muted-foreground">Chargement des liens d’inscription…</p>}
        {invitation && tokenEmail ? <InvitationEmailForm key={invitation} taux={invitation} token={tokenEmail} onRetour={() => setInvitation(null)} /> : <div className="space-y-2">
          {CANAUX.map((c) => (
            <div key={c.id} className="rounded-lg border border-border p-2.5">
              <p className="mb-1.5 text-sm font-medium">{c.label}</p>
              <div className="flex flex-wrap gap-2">
                {TAUX.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={t === 15 ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => copier(c.id, t)}
                    disabled={!jeton(c.id, t) || liens.isError}
                  >
                    {copie === `${c.id}-${t}` ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    Copier {t} %
                  </Button>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-950"><Mail className="size-4" />Email · via Gmail</p>
            <div className="flex flex-wrap gap-2">{TAUX.map((t) => <Button key={t} size="sm" variant={t === 15 ? 'default' : 'outline'} className="flex-1" disabled={!jeton('email', t) || liens.isError} onClick={() => setInvitation(t)}>Envoyer {t} %</Button>)}</div>
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  )
}
