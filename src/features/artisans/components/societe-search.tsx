import { useState } from 'react'
import { Search, Loader2, Building2 } from 'lucide-react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { rechercherEntreprises, type ResultatEntreprise } from '@/lib/entreprise'

// Recherche d'entreprise (nom ou SIREN) → liste de résultats à choisir.
// Au clic, on remonte le résultat choisi au formulaire pour auto-remplir.
export function SocieteSearch({
  onSelect,
}: {
  onSelect: (r: ResultatEntreprise) => void
}) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [resultats, setResultats] = useState<ResultatEntreprise[] | null>(null)

  async function rechercher() {
    if (q.trim().length < 3) return toast.error('Tape au moins 3 caractères')
    setLoading(true)
    try {
      const r = await rechercherEntreprises(q)
      setResultats(r)
      if (r.length === 0) toast.info('Aucune entreprise trouvée')
    } catch {
      toast.error('Recherche indisponible')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
      <p className="text-sm font-medium">Rechercher l'entreprise (auto-remplissage)</p>
      <div className="flex gap-2">
        <Input
          className="h-11 flex-1 min-w-0"
          placeholder="Nom de société ou SIREN…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void rechercher()
            }
          }}
        />
        <Button type="button" onClick={rechercher} disabled={loading} className="h-11 shrink-0">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Chercher
        </Button>
      </div>

      {resultats && resultats.length > 0 && (
        <ul className="space-y-1.5">
          {resultats.map((r) => (
            <li key={r.siren}>
              <button
                type="button"
                onClick={() => {
                  onSelect(r)
                  setResultats(null)
                  setQ('')
                  toast.success('Infos société remplies')
                }}
                className="flex w-full items-start gap-2 rounded-lg border border-border bg-card p-2.5 text-left text-sm transition-colors hover:bg-accent/50"
              >
                <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.raison_sociale}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.forme_juridique && `${r.forme_juridique} · `}
                    SIREN {r.siren}
                    {r.ville && ` · ${r.ville}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Source : annuaire des entreprises (gouv.fr). Choisis le bon établissement ;
        les champs restent modifiables. Le capital n'est pas fourni (à saisir).
      </p>
    </div>
  )
}
