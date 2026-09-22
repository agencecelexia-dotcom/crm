import { useRef, useState } from 'react'
import { Building2, Check, ImageUp, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { uploaderLogo } from '@/lib/storage'
import { useEnregistrerIdentite, useIdentite, type IdentiteArtisan } from './use-identite'

const TYPES_LOGO = ['image/png', 'image/jpeg', 'image/webp']

/**
 * L'identité de l'entreprise, saisie une fois pour toutes les devis.
 *
 * Elle n'est pas un réglage parmi d'autres : sans elle, chaque devis part avec
 * un en-tête incomplet et des mentions manquantes. D'où la liste de ce qui
 * manque, affichée en clair — un artisan doit savoir quoi faire, pas où il en
 * est sur une barre de progression.
 */
export function CarteIdentite({ token }: { token: string }) {
  const { data: id } = useIdentite(token)
  const [ouvert, setOuvert] = useState(false)

  if (!id) return null
  const complet = id.manquants.length === 0

  return (
    <>
      <Card className="rounded-2xl border-border/70 p-4 shadow-card">
        <div className="flex items-start gap-3">
          {id.logo_url ? (
            <img
              src={id.logo_url}
              alt=""
              className="size-12 shrink-0 rounded-lg border border-border object-contain p-1"
            />
          ) : (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="size-5 text-primary" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{id.societe || 'Mon entreprise'}</p>
            {complet ? (
              <Badge className="mt-1 gap-1 border-[#22C55E]/25 bg-[#22C55E]/10 text-xs text-[#16A34A]">
                <ShieldCheck className="size-3.5" />
                Devis conformes
              </Badge>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                À compléter : {id.manquants.join(', ')}
              </p>
            )}
          </div>
        </div>
        <Button
          variant={complet ? 'outline' : 'default'}
          className="mt-3 w-full"
          onClick={() => setOuvert(true)}
        >
          {complet ? 'Modifier mon entreprise' : 'Compléter mon entreprise'}
        </Button>
      </Card>

      {ouvert && <FeuilleIdentite token={token} identite={id} onClose={() => setOuvert(false)} />}
    </>
  )
}

function FeuilleIdentite({
  token,
  identite,
  onClose,
}: {
  token: string
  identite: IdentiteArtisan
  onClose: () => void
}) {
  const enregistrer = useEnregistrerIdentite(token)
  const fichier = useRef<HTMLInputElement>(null)
  const [envoiLogo, setEnvoiLogo] = useState(false)
  const [logo, setLogo] = useState(identite.logo_url ?? '')
  const [f, setF] = useState({
    societe: identite.societe ?? '',
    adresse: identite.adresse ?? '',
    code_postal: identite.code_postal ?? '',
    ville: identite.ville ?? '',
    telephone: identite.telephone ?? '',
    email: identite.email ?? '',
    forme_juridique: identite.forme_juridique ?? '',
    capital_social: identite.capital_social ?? '',
    siren: identite.siren ?? '',
    ville_immatriculation: identite.ville_immatriculation ?? '',
    tva_intracom: identite.tva_intracom ?? '',
    code_ape: identite.code_ape ?? '',
    garantie_zone: identite.garantie_zone ?? '',
    mediateur_nom: identite.mediateur_nom ?? '',
    mediateur_url: identite.mediateur_url ?? '',
    iban: identite.iban ?? '',
    bic: identite.bic ?? '',
    conditions_paiement: identite.conditions_paiement ?? '',
    acompte_defaut: identite.acompte_defaut != null ? String(identite.acompte_defaut) : '30',
    tva_mode_defaut: identite.tva_mode_defaut ?? 'franchise',
  })
  const maj = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  // Les CGV ne sont éditées que par ceux qui ont un texte à eux ; les autres
  // gardent celui par défaut sans avoir à l'ouvrir.
  const [cgv, setCgv] = useState(identite.cgv)
  const [cgvOuvertes, setCgvOuvertes] = useState(false)

  async function deposerLogo(file: File) {
    if (!TYPES_LOGO.includes(file.type)) {
      toast.error('Format non reconnu', { description: 'PNG, JPEG ou WebP.' })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Fichier trop lourd', { description: '2 Mo maximum.' })
      return
    }
    setEnvoiLogo(true)
    try {
      setLogo(await uploaderLogo(token, file))
      toast.success('Logo déposé — enregistrez pour l’appliquer à vos devis')
    } catch (e) {
      toast.error('Dépôt impossible', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setEnvoiLogo(false)
    }
  }

  function soumettre() {
    enregistrer.mutate(
      {
        ...f,
        logo_url: logo,
        // Une chaîne vide REMET les conditions par défaut ; ne rien envoyer
        // laisse en place ce qui existe déjà.
        ...(cgvOuvertes ? { cgv: cgv.trim() === identite.cgv.trim() ? '' : cgv } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Entreprise enregistrée')
          onClose()
        },
        onError: (e) =>
          toast.error('Échec', { description: e instanceof Error ? e.message : undefined }),
      },
    )
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="flex max-h-[92dvh] flex-col overflow-hidden">
        <SheetHeader>
          <SheetTitle>Mon entreprise</SheetTitle>
          <SheetDescription>
            Renseignée une fois, elle figure sur tous vos devis : en-tête, immatriculation,
            assurance, conditions générales.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-2">
          {/* Logo */}
          <section className="space-y-2">
            <p className="text-sm font-semibold">Logo</p>
            <div className="flex items-center gap-3">
              {logo ? (
                <img
                  src={logo}
                  alt="Logo de l’entreprise"
                  className="size-16 shrink-0 rounded-lg border border-border object-contain p-1"
                />
              ) : (
                <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border">
                  <ImageUp className="size-5 text-muted-foreground" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <input
                  ref={fichier}
                  type="file"
                  accept={TYPES_LOGO.join(',')}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void deposerLogo(file)
                    e.target.value = ''
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={envoiLogo}
                  onClick={() => fichier.current?.click()}
                >
                  {envoiLogo ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />}
                  {logo ? 'Remplacer' : 'Choisir un logo'}
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">PNG, JPEG ou WebP, 2 Mo max.</p>
              </div>
            </div>
          </section>

          <Section titre="Coordonnées">
            <Champ label="Raison sociale" value={f.societe} onChange={(v) => maj('societe', v)} large />
            <Champ label="Adresse" value={f.adresse} onChange={(v) => maj('adresse', v)} large />
            <Champ label="Code postal" value={f.code_postal} onChange={(v) => maj('code_postal', v)} />
            <Champ label="Ville" value={f.ville} onChange={(v) => maj('ville', v)} />
            <Champ label="Téléphone" value={f.telephone} onChange={(v) => maj('telephone', v)} />
            <Champ label="Email" value={f.email} onChange={(v) => maj('email', v)} />
          </Section>

          <Section titre="Immatriculation">
            <Champ
              label="Forme juridique"
              value={f.forme_juridique}
              onChange={(v) => maj('forme_juridique', v)}
              placeholder="SARL, SAS, EI…"
            />
            <Champ
              label="Capital social"
              value={f.capital_social}
              onChange={(v) => maj('capital_social', v)}
              placeholder="10 000 €"
            />
            <Champ label="SIREN" value={f.siren} onChange={(v) => maj('siren', v)} />
            <Champ
              label="Ville d’immatriculation"
              value={f.ville_immatriculation}
              onChange={(v) => maj('ville_immatriculation', v)}
            />
            <Champ
              label="N° TVA intracom."
              value={f.tva_intracom}
              onChange={(v) => maj('tva_intracom', v)}
              placeholder="FR12345678901"
            />
            <Champ label="Code APE" value={f.code_ape} onChange={(v) => maj('code_ape', v)} placeholder="4399C" />
          </Section>

          <Section titre="Assurance">
            <div className="col-span-2 rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
              {identite.assurance.decennale_assureur ? (
                <>
                  Décennale : {identite.assurance.decennale_assureur}
                  {identite.assurance.decennale_police && ` — police n° ${identite.assurance.decennale_police}`}
                </>
              ) : (
                'Déposez votre attestation décennale dans le coffre pour qu’elle figure sur vos devis.'
              )}
            </div>
            <Champ
              label="Zone de garantie décennale"
              value={f.garantie_zone}
              onChange={(v) => maj('garantie_zone', v)}
              placeholder="France métropolitaine"
              large
            />
          </Section>

          <Section titre="Paiement">
            <Champ label="IBAN" value={f.iban} onChange={(v) => maj('iban', v)} large />
            <Champ label="BIC" value={f.bic} onChange={(v) => maj('bic', v)} />
            <Champ
              label="Acompte par défaut (%)"
              value={f.acompte_defaut}
              onChange={(v) => maj('acompte_defaut', v)}
            />
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Régime de TVA par défaut</Label>
              <Select
                value={f.tva_mode_defaut}
                onValueChange={(v) => maj('tva_mode_defaut', v)}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="franchise">Sans TVA (art. 293 B)</SelectItem>
                  <SelectItem value="normal">Avec TVA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Champ
              label="Conditions de paiement"
              value={f.conditions_paiement}
              onChange={(v) => maj('conditions_paiement', v)}
              placeholder="Solde à 30 jours fin de mois."
              large
            />
          </Section>

          <Section titre="Médiateur de la consommation">
            <div className="col-span-2 text-xs text-muted-foreground">
              Obligatoire pour tout professionnel vendant à des particuliers (art. L612-1 du Code
              de la consommation).
            </div>
            <Champ
              label="Nom du médiateur"
              value={f.mediateur_nom}
              onChange={(v) => maj('mediateur_nom', v)}
              large
            />
            <Champ
              label="Site du médiateur"
              value={f.mediateur_url}
              onChange={(v) => maj('mediateur_url', v)}
              large
            />
          </Section>

          {/* CGV */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Conditions générales</p>
              {!cgvOuvertes && (
                <Button variant="ghost" size="sm" onClick={() => setCgvOuvertes(true)}>
                  Modifier
                </Button>
              )}
            </div>
            {cgvOuvertes ? (
              <>
                <Textarea
                  value={cgv}
                  onChange={(e) => setCgv(e.target.value)}
                  rows={12}
                  className="font-mono text-xs"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setCgv(identite.cgv)}
                >
                  <RotateCcw className="size-4" />
                  Revenir aux conditions par défaut
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {identite.cgv_personnalisees
                  ? 'Vos conditions personnalisées sont imprimées en dernière page de chaque devis.'
                  : 'Onze articles adaptés aux marchés de travaux avec un particulier sont imprimés '
                    + 'en dernière page de chaque devis. Vous pouvez les reprendre.'}
              </p>
            )}
          </section>
        </div>

        <div className="border-t border-border p-4">
          <Button className="w-full" onClick={soumettre} disabled={enregistrer.isPending}>
            {enregistrer.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Enregistrer
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-sm font-semibold">{titre}</p>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  )
}

function Champ({
  label,
  value,
  onChange,
  placeholder,
  large,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  large?: boolean
}) {
  return (
    <div className={`space-y-1.5 ${large ? 'col-span-2' : ''}`}>
      <Label className="text-xs">{label}</Label>
      <Input
        className="h-10"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
