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
  const [erreur, setErreur] = useState<string | null>(null)

  async function rechercher() {
    if (loading) return
    if (q.trim().length < 3) return setErreur('Saisissez au moins 3 caractères pour rechercher une entreprise.')
    setErreur(null)
    setLoading(true)
    try {
      const r = await rechercherEntreprises(q)
      setResultats(r)
    } catch {
      setErreur('La recherche est indisponible. Vous pouvez réessayer ou remplir les champs ci-dessous.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
      <p className="text-sm font-medium">Rechercher l'entreprise (auto-remplissage)</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          className="h-12 min-w-0 sm:flex-1"
          placeholder="Nom de société, SIREN ou SIRET…"
          aria-label="Rechercher votre entreprise"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void rechercher()
            }
          }}
        />
        <Button type="button" onClick={rechercher} disabled={loading} className="h-12 shrink-0">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Chercher
        </Button>
      </div>
      {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
      {resultats?.length === 0 && <p role="status" className="text-sm text-muted-foreground">Aucune entreprise trouvée. Essayez son SIREN ou remplissez les champs ci-dessous.</p>}

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
        Sélectionnez votre entreprise dans les résultats. Vous pourrez vérifier et modifier les informations remplies. Source : annuaire des entreprises (gouv.fr).
      </p>
    </div>
  )
}
