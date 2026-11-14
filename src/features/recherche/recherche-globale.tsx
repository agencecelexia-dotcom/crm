import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Building2, FolderKanban, Loader2, Search, UserRound } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { formatTel } from '@/lib/format'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { StatutBadge } from '@/components/statut-badge'
import type { StatutProjet } from '@/types/database'

type Resultat = {
  id: string; type: 'projet' | 'artisan' | 'partenaire'; nom: string; ville: string | null;
  telephone: string | null; email: string | null; detail: string | null; statut: StatutProjet | null; masque: boolean;
}
type Reponse = { resultats: Resultat[]; total: number }
const TYPES = {
  projet: { libelle: 'Projet', Icone: FolderKanban, couleur: 'bg-blue-50 text-blue-700' },
  artisan: { libelle: 'Artisan', Icone: UserRound, couleur: 'bg-slate-100 text-slate-700' },
  partenaire: { libelle: 'Partenaire', Icone: Building2, couleur: 'bg-violet-50 text-violet-700' },
}

export function RechercheGlobale({ onFermer }: { onFermer: () => void }) {
  const [saisie, setSaisie] = useState('')
  const [recherche, setRecherche] = useState('')
  const navigation = useNavigate()
  const versFiche = useRef(false)
  const focusPrecedent = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => {
    const timer = window.setTimeout(() => setRecherche(saisie.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [saisie])
  const query = useQuery({
    queryKey: ['recherche-globale', recherche],
    enabled: recherche.length >= 2,
    retry: false,
    staleTime: 30_000,
    gcTime: 60_000,
    queryFn: async ({ signal }): Promise<Reponse> => {
      const { data, error } = await supabase.rpc('recherche_globale', { p_recherche: recherche }).abortSignal(signal)
      if (error) throw error
      if (!data || !Array.isArray(data.resultats)) throw new Error('Réponse de recherche invalide')
      return data as Reponse
    },
  })
  const attente = saisie.trim() !== recherche || query.isLoading
  const resultats = !attente && recherche.length >= 2 ? query.data?.resultats ?? [] : []
  function ouvrir(r: Resultat) {
    versFiche.current = true
    navigation(`/${r.type === 'projet' ? 'projets' : 'artisans'}/${r.id}`)
    onFermer()
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onFermer() }}>
    <DialogContent className="top-[max(1rem,8dvh)] flex max-h-[80dvh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" onCloseAutoFocus={(e) => {
      e.preventDefault()
      if (versFiche.current) document.getElementById('contenu-principal')?.focus()
      else focusPrecedent.current?.focus()
    }}>
      <DialogHeader className="shrink-0 px-5 pb-3 pt-5 pr-12 text-left">
        <DialogTitle>Recherche globale</DialogTitle>
        <DialogDescription>Projets, artisans et partenaires — y compris les fiches masquées.</DialogDescription>
      </DialogHeader>
      <Command shouldFilter={false} className="min-h-0 rounded-none">
        <CommandInput value={saisie} onValueChange={setSaisie} maxLength={160} autoFocus aria-label="Rechercher dans tout le CRM" placeholder="Téléphone, email, nom, ville, métier…" className="h-12 text-base sm:text-sm" />
        <CommandList className="max-h-[min(54dvh,480px)] px-2 py-2" aria-label="Résultats de la recherche">
          {saisie.trim().length < 2 ? <div className="px-4 py-8 text-center text-sm text-muted-foreground"><Search className="mx-auto mb-3 size-5" aria-hidden /><p>Saisissez au moins deux caractères.</p><p className="mt-2 text-xs">Un numéro, une adresse email, une entreprise ou une ville.</p></div>
            : attente ? <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />Recherche…</p>
            : query.isError ? <div role="alert" className="space-y-3 px-4 py-6 text-center text-sm"><p>La recherche n’est pas disponible pour le moment.</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Réessayer</Button></div>
            : !resultats.length ? <p role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune fiche trouvée. Essayez un autre nom, numéro ou email.</p>
            : <CommandGroup heading={`${query.data!.total} résultat${query.data!.total > 1 ? 's' : ''}`}>
              {resultats.map((r) => {
                const { libelle, Icone, couleur } = TYPES[r.type]
                return <CommandItem key={`${r.type}:${r.id}`} value={`${r.type}:${r.id}`} onSelect={() => ouvrir(r)} className="my-1 items-start gap-3 rounded-lg px-3 py-3 data-[selected=true]:bg-primary/10">
                  <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${couleur}`}><Icone className="size-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium">{r.nom}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span className="font-medium text-muted-foreground">{libelle}</span>{r.ville && <span className="text-muted-foreground">· {r.ville}</span>}{r.masque && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-700">{r.type === 'projet' ? 'Masqué' : 'Écarté'}</span>}{r.statut && <StatutBadge statut={r.statut} />}</span>
                    {r.detail && <span className="mt-1 block truncate text-xs text-muted-foreground" title={r.detail}>{r.detail}</span>}
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{r.telephone && <span className="tabular-nums">{formatTel(r.telephone)}</span>}{r.email && <span className="break-all">{r.email}</span>}</span>
                  </span>
                  <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                </CommandItem>
              })}
            </CommandGroup>}
        </CommandList>
      </Command>
      <div className="shrink-0 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        {query.data && query.data.total > 30 ? '30 premières fiches affichées. Ajoutez un nom ou un code postal pour préciser.' : 'Sélectionnez une fiche pour l’ouvrir directement.'}
        <span className="mt-1 hidden sm:block">↑ ↓ pour naviguer · Entrée pour ouvrir · Échap pour fermer</span>
      </div>
    </DialogContent>
  </Dialog>
}
