import { useState } from 'react'
import { StickyNote, Loader2, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page-header'
import { EmptyState } from '@/components/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateHeure } from '@/lib/format'
import {
  useNotesGenerales,
  useAddNoteGenerale,
  useDeleteNoteGenerale,
} from './use-notes-generales'

// Bloc-notes général de l'agence (non rattaché à un client/projet).
export function NotesPage() {
  const { data: notes, isLoading } = useNotesGenerales()
  const add = useAddNoteGenerale()
  const del = useDeleteNoteGenerale()
  const [texte, setTexte] = useState('')

  function ajouter() {
    const contenu = texte.trim()
    if (!contenu) return
    add.mutate(contenu, {
      onSuccess: () => setTexte(''),
      onError: (e) =>
        toast.error('Note non enregistrée', {
          description: e instanceof Error ? e.message : undefined,
        }),
    })
  }

  return (
    <div>
      <PageHeader titre="Notes" sousTitre="Bloc-notes de l'agence" />

      {/* Saisie rapide */}
      <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
        <CardContent className="space-y-2 py-4">
          <Textarea
            rows={3}
            placeholder="Écris une note… (idée, rappel, info, à faire…)"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                ajouter()
              }
            }}
          />
          <Button onClick={ajouter} disabled={add.isPending || !texte.trim()} className="w-full">
            {add.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Ajouter
          </Button>
        </CardContent>
      </Card>

      {/* Fil des notes */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : !notes || notes.length === 0 ? (
        <EmptyState icon={StickyNote} titre="Aucune note" description="Tes notes apparaîtront ici." />
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id}>
              <Card className="rounded-2xl border-border/70 shadow-card">
                <CardContent className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm">{n.contenu}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {n.auteur ? `${n.auteur} · ` : ''}
                      {formatDateHeure(n.created_at)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => del.mutate(n.id)}
                    aria-label="Supprimer la note"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
