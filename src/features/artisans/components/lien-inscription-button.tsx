import { useState } from 'react'
import { Link2, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
  { id: '', label: 'Lien général' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'leboncoin', label: 'Leboncoin' },
]

// Taux de commission proposés (liens fixes distincts, pas de champ à régler).
const TAUX = [10, 15]

export function LienInscriptionButton() {
  const [copie, setCopie] = useState<string | null>(null)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const lien = (id: string, taux: number) =>
    `${origin}/rejoindre${id ? '/' + id : ''}${taux !== 10 ? `?taux=${taux}` : ''}`

  async function copier(id: string, taux: number) {
    const cle = `${id}-${taux}`
    try {
      await navigator.clipboard.writeText(lien(id, taux))
      setCopie(cle)
      toast.success(`Lien ${taux}% copié`)
      window.setTimeout(() => setCopie((c) => (c === cle ? null : c)), 1500)
    } catch {
      toast.error('Copie impossible — copie le lien à la main')
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Lien d'inscription" title="Lien d'inscription">
          <Link2 className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Liens d'inscription artisan</DialogTitle>
          <DialogDescription>
            Deux liens distincts par canal : <b>10 %</b> (standard) et <b>15 %</b> (commission
            majorée). Copie celui qu'il te faut — le contrat s'adapte automatiquement.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
