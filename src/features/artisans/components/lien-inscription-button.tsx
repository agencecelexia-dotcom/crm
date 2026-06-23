import { useState } from 'react'
import { Link2, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

export function LienInscriptionButton() {
  const [copie, setCopie] = useState<string | null>(null)
  const [pct, setPct] = useState(10) // taux de commission porté par le lien
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const lien = (id: string) =>
    `${origin}/rejoindre${id ? '/' + id : ''}${pct !== 10 ? `?taux=${pct}` : ''}`

  async function copier(id: string) {
    try {
      await navigator.clipboard.writeText(lien(id))
      setCopie(id)
      toast.success('Lien copié')
      window.setTimeout(() => setCopie((c) => (c === id ? null : c)), 1500)
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
          <DialogTitle>Lien d'inscription artisan</DialogTitle>
          <DialogDescription>
            Partage ce lien (WhatsApp, Facebook…). L'artisan remplit lui-même sa fiche et apparaît
            ici, tagué selon le canal choisi.
          </DialogDescription>
        </DialogHeader>
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-border p-2.5">
          <span className="text-sm font-medium">Commission du contrat :</span>
          <Input
            type="number"
            inputMode="numeric"
            value={String(pct)}
            onChange={(e) => setPct(Math.min(30, Math.max(5, Number(e.target.value) || 10)))}
            className="h-9 w-16 text-center"
          />
          <span className="text-sm text-muted-foreground">%</span>
          {pct !== 10 && (
            <span className="text-xs text-muted-foreground">→ liens dédiés {pct} %</span>
          )}
        </div>

        <div className="space-y-2">
          {CANAUX.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{c.label}</p>
                <p className="truncate text-xs text-muted-foreground">{lien(c.id)}</p>
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => copier(c.id)}>
                {copie === c.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                Copier
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
