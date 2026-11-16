import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { STATUTS } from '@/lib/constants'
import { useCreateProjet } from '../hooks/use-projets'
import type { ProjetInput, StatutProjet } from '@/types/database'

// Ajout ultra-rapide d'un prospect : on a souvent juste un numéro de téléphone
// (appel manqué, SMS sans réponse). Rien n'est obligatoire : un démarcheur ou un
// faux lead se note parfois sans même un numéro.
export function QuickProspectDialog() {
  const navigate = useNavigate()
  const create = useCreateProjet()
  const [open, setOpen] = useState(false)
  const [tel, setTel] = useState('')
  const [nom, setNom] = useState('')
  const [ville, setVille] = useState('')
  const [note, setNote] = useState('')
  const [statut, setStatut] = useState<StatutProjet>('a_rappeler')

  function reset() {
    setTel(''); setNom(''); setVille(''); setNote(''); setStatut('a_rappeler')
  }

  function creer() {
    if (create.isPending) return
    const input: ProjetInput = {
      // Sans nom, on affiche le numéro ; sans rien, un libellé neutre
      // (client_nom est NOT NULL en base).
      client_nom: nom.trim() || tel.trim() || 'Sans nom',
      client_telephone: tel.trim() || null,
      client_email: null,
      client_adresse: null,
      client_code_postal: null,
      client_ville: ville.trim() || null,
      latitude: null,
      longitude: null,
      metier: '',
      metiers: [],
      sous_metier: null,
      description: note.trim() || null,
      budget_estime: null,
      artisan_id: null,
      statut,
      montant_devis: null,
      montant_devis_signe: null,
      taux_commission: 0.1,
      commission_encaissee: false,
      date_signature: null,
      contrat_url: null,
      devis_url: null,
      devis_signe_url: null,
    }
    create.mutate(input, {
      onSuccess: (p) => {
        toast.success('Prospect ajouté')
        setOpen(false)
        reset()
        navigate(`/projets/${p.id}`)
      },
      onError: (e) =>
        toast.error('Ajout impossible', {
          description: e instanceof Error ? e.message : undefined,
        }),
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Nouveau projet
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau projet</DialogTitle>
          <DialogDescription>
            Rien n'est obligatoire : note ce que tu as (appel manqué, SMS…) et complète le
            reste (métier, adresse, artisan…) plus tard depuis la fiche.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => { event.preventDefault(); creer() }} className="min-w-0 space-y-4">
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="qp-tel">Téléphone (optionnel)</Label>
            <Input
              id="qp-tel"
              type="tel"
              autoComplete="tel"
              className="h-11"
              placeholder="06 12 34 56 78"
              value={tel}
              onChange={(e) => setTel(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qp-nom">Nom (optionnel)</Label>
              <Input id="qp-nom" className="h-11" value={nom} onChange={(e) => setNom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qp-ville">Ville (optionnel)</Label>
              <Input id="qp-ville" className="h-11" value={ville} onChange={(e) => setVille(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qp-statut">Statut</Label>
            <Select value={statut} onValueChange={(v) => setStatut(v as StatutProjet)}>
              <SelectTrigger id="qp-statut" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a_rappeler">{STATUTS.a_rappeler.label}</SelectItem>
                <SelectItem value="nouveau">{STATUTS.nouveau.label}</SelectItem>
                {/* Pas des prospects : ces fiches sortent du pipeline et des
                    statistiques, et sont cachées de la liste (onglet Masqués).
                    Elles servent seulement à reconnaître le numéro. */}
                <SelectItem value="demarchage">{STATUTS.demarchage.label}</SelectItem>
                <SelectItem value="lead_pourri">{STATUTS.lead_pourri.label}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qp-note">Note (optionnel)</Label>
            <Textarea
              id="qp-note"
              rows={2}
              placeholder="Ex : appel manqué, a laissé un SMS pour une clôture…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button type="submit" disabled={create.isPending} className="w-full">
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            Ajouter
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-h-11 w-full whitespace-normal text-muted-foreground"
            onClick={() => {
              setOpen(false)
              navigate('/projets/new')
            }}
          >
            Saisie complète (métier, adresse, budget…)
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
