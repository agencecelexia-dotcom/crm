import { useMemo, useState } from 'react'
import { Plus, Trash2, Loader2, Eye, Send, Save, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { uploaderDevisGenere } from '@/lib/storage'
import type { ArtisanEspace } from '@/types/database'
import { telechargerDevis, devisEnBlob, type DevisData } from './devis-pdf'
import {
  useCreerDevis,
  useSetDevisPdf,
  useEnvoyerDevis,
  envoyerDevisPdfEmail,
  type DevisPayload,
} from './use-devis'

const UNITES = ['u', 'm²', 'ml', 'm³', 'forfait', 'h', 'j', 'ens.']

// Montant avec centimes (les devis ont besoin du détail à 2 décimales).
const euro2 = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    n || 0,
  ) + ' €'

interface LigneState {
  designation: string
  quantite: string
  unite: string
  prix_unitaire: string
}

export interface DevisInitial {
  affectation_token?: string
  client_nom?: string | null
  client_adresse?: string | null
  client_cp?: string | null
  client_ville?: string | null
  client_email?: string | null
  client_tel?: string | null
  objet?: string | null
}

export function DevisBuilder({
  token,
  vendeur,
  initial,
  onClose,
  onDone,
}: {
  token: string
  vendeur: ArtisanEspace
  initial?: DevisInitial
  onClose: () => void
  onDone?: () => void
}) {
  const creer = useCreerDevis(token)
  const setPdf = useSetDevisPdf(token)
  const envoyer = useEnvoyerDevis(token)
  const [busy, setBusy] = useState(false)
  const [enTeteOuvert, setEnTeteOuvert] = useState(false)

  // En-tête entreprise (éditable, pré-rempli)
  const [ent, setEnt] = useState({
    nom: vendeur.societe && vendeur.societe !== 'ZACHARI METBACH' ? vendeur.societe : 'METBACH RÉNOVATION',
    adresse: vendeur.adresse ?? '',
    cp: vendeur.code_postal ?? '',
    ville: vendeur.ville ?? '',
    siren: vendeur.siren ?? '',
    forme: vendeur.forme_juridique ?? '',
    tel: vendeur.telephone ?? '',
    email: vendeur.email ?? '',
  })
  const majEnt = (k: keyof typeof ent, v: string) => setEnt((p) => ({ ...p, [k]: v }))

  // Client
  const [cli, setCli] = useState({
    nom: initial?.client_nom ?? '',
    adresse: initial?.client_adresse ?? '',
    cp: initial?.client_cp ?? '',
    ville: initial?.client_ville ?? '',
    email: initial?.client_email ?? '',
    tel: initial?.client_tel ?? '',
  })
  const majCli = (k: keyof typeof cli, v: string) => setCli((p) => ({ ...p, [k]: v }))

  const [objet, setObjet] = useState(initial?.objet ?? '')
  const [lignes, setLignes] = useState<LigneState[]>([
    { designation: '', quantite: '1', unite: 'u', prix_unitaire: '' },
  ])
  const [acompte, setAcompte] = useState('30')
  const [conditions, setConditions] = useState(
    'Devis gratuit, valable 1 mois. Acompte à la commande, solde à la fin des travaux.',
  )
  const [validite] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [today] = useState(() => new Date().toISOString())

  const num = (s: string) => parseFloat(s.replace(',', '.')) || 0
  const total = useMemo(
    () => lignes.reduce((s, l) => s + num(l.quantite) * num(l.prix_unitaire), 0),
    [lignes],
  )

  function majLigne(i: number, k: keyof LigneState, v: string) {
    setLignes((arr) => arr.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)))
  }
  const ajouterLigne = () =>
    setLignes((arr) => [...arr, { designation: '', quantite: '1', unite: 'u', prix_unitaire: '' }])
  const retirerLigne = (i: number) => setLignes((arr) => arr.filter((_, idx) => idx !== i))

  function construireData(numero: string): DevisData {
    return {
      numero,
      date: today,
      dateValidite: validite,
      vendeur: {
        nom: ent.nom,
        adresse: ent.adresse,
        cp: ent.cp,
        ville: ent.ville,
        siren: ent.siren,
        forme: ent.forme,
        tel: ent.tel,
        email: ent.email,
      },
      client: { nom: cli.nom, adresse: cli.adresse, cp: cli.cp, ville: cli.ville, tel: cli.tel, email: cli.email },
      objet,
      lignes: lignes
        .filter((l) => l.designation.trim())
        .map((l) => ({
          designation: l.designation.trim(),
          quantite: num(l.quantite),
          unite: l.unite,
          prix_unitaire: num(l.prix_unitaire),
        })),
      total,
      acomptePct: acompte.trim() ? num(acompte) : null,
      conditions,
    }
  }

  function valider(): boolean {
    if (!cli.nom.trim()) {
      toast.error('Indiquez le nom du client')
      return false
    }
    if (!lignes.some((l) => l.designation.trim())) {
      toast.error('Ajoutez au moins une ligne')
      return false
    }
    return true
  }

  async function apercu() {
    if (!lignes.some((l) => l.designation.trim())) return toast.error('Ajoutez au moins une ligne')
    await telechargerDevis(construireData('APERÇU'))
  }

  // Enregistre (DB + PDF) ; envoie l'email si demandé ; sinon télécharge.
  async function enregistrer(avecEnvoi: boolean) {
    if (!valider()) return
    setBusy(true)
    try {
      const payload: DevisPayload = {
        affectation_token: initial?.affectation_token,
        client_nom: cli.nom,
        client_adresse: cli.adresse,
        client_cp: cli.cp,
        client_ville: cli.ville,
        client_email: cli.email,
        client_tel: cli.tel,
        objet,
        lignes: construireData('x').lignes,
        total,
        acompte_pct: acompte.trim() ? num(acompte) : null,
        conditions,
        date_validite: validite,
      }
      const { id, numero } = await creer.mutateAsync(payload)
      const blob = await devisEnBlob(construireData(numero))
      const url = await uploaderDevisGenere(token, numero, blob)
      await setPdf.mutateAsync({ id, url })

      if (avecEnvoi) {
        await envoyer.mutateAsync(id) // met à jour le CRM si le devis vient d'un projet
        if (vendeur.email) {
          await envoyerDevisPdfEmail({ email: vendeur.email, numero, client_nom: cli.nom, pdf: blob })
          toast.success(`Devis ${numero} envoyé à ${vendeur.email} (PDF en pièce jointe)`)
        } else {
          toast.success(`Devis ${numero} créé — ajoute ton email dans l'en-tête pour l'envoi`)
        }
      } else {
        await telechargerDevis(construireData(numero))
        toast.success(`Devis ${numero} enregistré`)
      }
      onDone?.()
      onClose()
    } catch (e) {
      toast.error('Échec', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="flex max-h-[92dvh] flex-col overflow-hidden">
        <SheetHeader>
          <SheetTitle>Créer un devis</SheetTitle>
          <SheetDescription>
            Remplissez les lignes (prix par ligne, total automatique), prévisualisez, puis
            téléchargez ou recevez le PDF par email.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-2">
          {/* En-tête entreprise (repliable) */}
          <div className="rounded-xl border border-border">
            <button
              type="button"
              onClick={() => setEnTeteOuvert((v) => !v)}
              className="flex w-full items-center justify-between p-3 text-sm font-medium"
            >
              En-tête : {ent.nom}
              <ChevronDown className={`size-4 transition-transform ${enTeteOuvert ? 'rotate-180' : ''}`} />
            </button>
            {enTeteOuvert && (
              <div className="grid grid-cols-2 gap-2 border-t border-border p-3">
                <Champ label="Nom / société" value={ent.nom} onChange={(v) => majEnt('nom', v)} className="col-span-2" />
                <Champ label="Adresse" value={ent.adresse} onChange={(v) => majEnt('adresse', v)} className="col-span-2" />
                <Champ label="Code postal" value={ent.cp} onChange={(v) => majEnt('cp', v)} />
                <Champ label="Ville" value={ent.ville} onChange={(v) => majEnt('ville', v)} />
                <Champ label="SIREN" value={ent.siren} onChange={(v) => majEnt('siren', v)} />
                <Champ label="Forme juridique" value={ent.forme} onChange={(v) => majEnt('forme', v)} />
                <Champ label="Téléphone" value={ent.tel} onChange={(v) => majEnt('tel', v)} />
                <Champ label="Email" value={ent.email} onChange={(v) => majEnt('email', v)} />
              </div>
            )}
          </div>

          {/* Client */}
          <div className="space-y-2">
            <p className="text-sm font-semibold">Client</p>
            <div className="grid grid-cols-2 gap-2">
              <Champ label="Nom" value={cli.nom} onChange={(v) => majCli('nom', v)} className="col-span-2" />
              <Champ label="Adresse" value={cli.adresse} onChange={(v) => majCli('adresse', v)} className="col-span-2" />
              <Champ label="Code postal" value={cli.cp} onChange={(v) => majCli('cp', v)} />
              <Champ label="Ville" value={cli.ville} onChange={(v) => majCli('ville', v)} />
              <Champ label="Email" value={cli.email} onChange={(v) => majCli('email', v)} />
              <Champ label="Téléphone" value={cli.tel} onChange={(v) => majCli('tel', v)} />
            </div>
          </div>

          {/* Objet */}
          <Champ label="Objet du devis" value={objet} onChange={setObjet} placeholder="Ex. Fourniture et pose de menuiseries" />

          {/* Lignes */}
          <div className="space-y-2">
            <p className="text-sm font-semibold">Prestations</p>
            {lignes.map((l, i) => (
              <div key={i} className="space-y-2 rounded-xl border border-border p-2.5">
                <Textarea
                  placeholder="Désignation (ex. Fenêtre PVC 2 vantaux, pose comprise)"
                  value={l.designation}
                  onChange={(e) => majLigne(i, 'designation', e.target.value)}
                  rows={2}
                  aria-label="Désignation"
                />
                {/* Rangée 1 : quantité + unité + total de ligne + supprimer */}
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="Qté"
                    value={l.quantite}
                    onChange={(e) => majLigne(i, 'quantite', e.target.value)}
                    className="h-11 w-16 shrink-0"
                    aria-label="Quantité"
                  />
                  <Select value={l.unite} onValueChange={(v) => majLigne(i, 'unite', v)}>
                    <SelectTrigger className="h-11 w-24 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITES.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="min-w-0 flex-1 truncate text-right text-sm font-medium">
                    {euro2(num(l.quantite) * num(l.prix_unitaire))}
                  </span>
                  {lignes.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0 text-muted-foreground"
                      onClick={() => retirerLigne(i)}
                      aria-label="Retirer la ligne"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                {/* Rangée 2 : prix unitaire en pleine largeur (grande zone tactile mobile) */}
                <div className="relative">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="Prix unitaire"
                    value={l.prix_unitaire}
                    onChange={(e) => majLigne(i, 'prix_unitaire', e.target.value)}
                    className="h-11 w-full pr-8"
                    aria-label="Prix unitaire"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={ajouterLigne}>
              <Plus className="size-4" />
              Ajouter une ligne
            </Button>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between rounded-xl bg-primary/5 p-3">
            <span className="text-sm font-medium">Net à payer</span>
            <span className="montant text-xl font-semibold text-primary">{euro2(total)}</span>
          </div>
          <p className="text-xs text-muted-foreground">TVA non applicable, art. 293 B du CGI.</p>

          <div className="grid grid-cols-2 gap-2">
            <Champ label="Acompte (%)" value={acompte} onChange={setAcompte} type="number" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Conditions</Label>
            <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} rows={2} />
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2 border-t border-border p-4 sm:grid-cols-3">
          <Button variant="outline" onClick={apercu} disabled={busy}>
            <Eye className="size-4" />
            Aperçu
          </Button>
          <Button variant="outline" onClick={() => enregistrer(false)} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Enregistrer
          </Button>
          <Button onClick={() => enregistrer(true)} disabled={busy} className="col-span-2 sm:col-span-1">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Enregistrer & me l'envoyer
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Champ({
  label,
  value,
  onChange,
  className,
  type,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  className?: string
  type?: string
  placeholder?: string
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-xs">{label}</Label>
      <Input
        className="h-10"
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
