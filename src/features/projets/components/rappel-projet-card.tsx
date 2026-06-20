import { useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAjouterRappel } from '@/features/taches/use-taches'

// Programme un rappel daté lié à ce projet : email à l'échéance (« T'AS DU TAFF »)
// + tâche dans « À faire ». S'appuie sur le même moteur que la to-do.
export function RappelProjetCard({ projetId }: { projetId: string }) {
  const rappeler = useAjouterRappel()
  const [titre, setTitre] = useState('')
  const [quand, setQuand] = useState('')
  const [pour, setPour] = useState('')

  function creer() {
    if (!titre.trim()) return toast.error('Que faut-il faire ?')
    if (!quand) return toast.error('Choisis une date de rappel')
    rappeler.mutate(
      {
        titre: titre.trim(),
        rappel_at: new Date(quand).toISOString(),
        pour: pour.trim() || undefined,
        projet_id: projetId,
      },
      {
        onSuccess: () => {
          toast.success('Rappel programmé — email à l\'heure dite')
          setTitre('')
          setQuand('')
          setPour('')
        },
        onError: (e) =>
          toast.error('Échec', { description: e instanceof Error ? e.message : undefined }),
      },
    )
  }

  return (
    <Card className="mb-4 border-[#7C3AED]/30 bg-[#7C3AED]/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4 text-[#7C3AED]" />
          Programmer un rappel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input
          placeholder="Que faut-il faire ? (ex. Rappeler le client pour le devis)"
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          className="h-11"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="datetime-local"
            value={quand}
            onChange={(e) => setQuand(e.target.value)}
            className="h-11 flex-1"
          />
          <Input
            placeholder="Pour qui ? (objet du mail, ex. Thomas)"
            value={pour}
            onChange={(e) => setPour(e.target.value)}
            className="h-11 flex-1"
          />
        </div>
        <Button size="sm" onClick={creer} disabled={rappeler.isPending}>
          {rappeler.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Clock className="size-4" />
          )}
          Programmer le rappel
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Tu recevras un email à l'heure dite, et la tâche t'attendra dans « À faire ».
        </p>
      </CardContent>
    </Card>
  )
}
