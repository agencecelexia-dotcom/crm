import { useState } from 'react'
import { Loader2, Lock, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { usePatchProjet } from '../hooks/use-projets'

// Notes internes PRIVÉES (agence uniquement). Jamais visibles par l'artisan :
// la colonne projets.notes_internes n'est renvoyée par aucune RPC artisan
// (get_espace_artisan / get_mission_by_token = liste blanche de champs).
export function NotesInternesCard({
  projetId,
  valeur,
}: {
  projetId: string
  valeur: string | null
}) {
  const patch = usePatchProjet()
  const [texte, setTexte] = useState(valeur ?? '')

  // Resynchronise quand la valeur d'origine change (navigation vers un autre
  // projet, refetch…) — pattern React « ajuster l'état pendant le rendu ».
  const [valeurPrec, setValeurPrec] = useState(valeur)
  if (valeur !== valeurPrec) {
    setValeurPrec(valeur)
    setTexte(valeur ?? '')
  }

  const modifie = texte !== (valeur ?? '')

  function enregistrer() {
    patch.mutate(
      { id: projetId, patch: { notes_internes: texte.trim() ? texte : null } },
      {
        onSuccess: () => toast.success('Notes internes enregistrées'),
        onError: (e) =>
          toast.error('Enregistrement impossible', {
            description: e instanceof Error ? e.message : undefined,
          }),
      },
    )
  }

  return (
    <Card className="mb-4 border-[#F59E0B]/40 bg-[#FEF3C7]/30">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
          <Lock className="size-4 text-[#B45309]" />
          Notes internes
          <span className="text-xs font-normal text-muted-foreground">
            privé — l'artisan ne les voit pas
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          placeholder="Infos privées sur ce projet : marge, négociation, historique d'appels, points de vigilance…"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          rows={4}
        />
        <Button size="sm" onClick={enregistrer} disabled={patch.isPending || !modifie}>
          {patch.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Enregistrer
        </Button>
      </CardContent>
    </Card>
  )
}
