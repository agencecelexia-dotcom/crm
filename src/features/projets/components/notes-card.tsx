import { useState } from 'react'
import { StickyNote, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatDateHeure } from '@/lib/format'
import { useNotes, useAddNote } from '../hooks/use-notes'

// Espace notes rapides : Thomas/Antoine ajoutent des notes qui s'accumulent (suivi).
export function NotesCard({ projetId }: { projetId: string }) {
  const { data: notes, isLoading } = useNotes(projetId)
  const add = useAddNote()
  const [texte, setTexte] = useState('')

  function ajouter() {
    const contenu = texte.trim()
    if (!contenu) return
    add.mutate(
      { projetId, contenu },
      {
        onSuccess: () => setTexte(''),
        onError: (e) =>
          toast.error('Note non enregistrée', {
            description: e instanceof Error ? e.message : undefined,
          }),
      },
    )
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <StickyNote className="size-4" />
          Notes {notes && notes.length > 0 && `(${notes.length})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Saisie rapide */}
        <div className="space-y-2">
          <Textarea
            rows={2}
            placeholder="Note rapide (suivi d'appel, relance, info client…)"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl + Entrée pour ajouter vite
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                ajouter()
              }
            }}
          />
          <Button onClick={ajouter} disabled={add.isPending || !texte.trim()} size="sm" className="w-full">
            {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Ajouter la note
          </Button>
        </div>

        {/* Fil des notes */}
        {isLoading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !notes || notes.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">Aucune note pour l'instant.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-border bg-secondary/40 p-3">
                <p className="whitespace-pre-wrap text-sm">{n.contenu}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {n.auteur ? `${n.auteur} · ` : ''}
                  {formatDateHeure(n.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
