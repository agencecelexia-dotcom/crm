import { useId, useRef, useState } from 'react'
import { Building2, Check, ImageUp, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
  const { data: id, isLoading, isError, refetch } = useIdentite(token)
  const [ouvert, setOuvert] = useState(false)

  if (isLoading) return <div className="h-48 animate-pulse rounded-xl border border-border bg-muted" aria-label="Chargement de l’entreprise" />
  if (isError || !id) return <div role="alert" className="rounded-xl border border-border bg-card p-5"><p className="text-sm">Les informations de votre entreprise sont indisponibles</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>Réessayer</Button></div>
  const complet = id.manquants.length === 0

  return (
    <>
      <Card className="gap-0 overflow-hidden rounded-xl border-border p-0 shadow-none">
        <div className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:p-6">
          <div className="flex w-full min-w-0 flex-1 items-start gap-4">
            {id.logo_url ? <img src={id.logo_url} alt="Logo de l’entreprise" className="size-12 shrink-0 rounded-lg border border-border object-contain p-2 sm:size-16" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-muted sm:size-16"><Building2 className="size-6 text-muted-foreground" strokeWidth={1.5} aria-hidden /></span>}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Identité de l’entreprise</p>
              <h2 className="mt-1 break-words font-display text-xl font-medium">{id.societe || 'Raison sociale à renseigner'}</h2>
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">{complet ? <><ShieldCheck className="size-3.5 shrink-0" aria-hidden />Informations complètes pour vos devis</> : <>À compléter : {id.manquants.join(', ')}</>}</p>
            </div>
          </div>
          <Button type="button" variant={complet ? 'outline' : 'default'} size="sm" className="min-h-11 w-full sm:min-h-0 sm:w-auto sm:shrink-0" onClick={() => setOuvert(true)}>{complet ? 'Modifier' : 'Compléter'}</Button>
        </div>
        <dl className="grid gap-x-8 gap-y-5 border-t border-border p-5 text-[13px] sm:grid-cols-2 sm:p-6">
          <div><dt className="text-xs text-muted-foreground">Adresse</dt><dd className="mt-1 leading-relaxed">{[id.adresse, [id.code_postal, id.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Non renseignée'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Coordonnées</dt><dd className="mt-1 break-words leading-relaxed">{id.telephone || 'Téléphone non renseigné'}<br />{id.email || 'Email non renseigné'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Immatriculation</dt><dd className="mt-1 tabular-nums">{id.siren ? `SIREN ${id.siren}` : 'SIREN non renseigné'}{id.forme_juridique && ` · ${id.forme_juridique}`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Régime de TVA</dt><dd className="mt-1">{id.tva_mode_defaut == null ? 'Non renseigné' : id.tva_mode_defaut === 'normal' ? 'Avec TVA' : 'Franchise en base de TVA'}</dd></div>
        </dl>
        <p className="border-t border-border px-5 py-4 text-xs leading-relaxed text-muted-foreground sm:px-6">Ces informations sont reprises sur vos devis : en-tête, immatriculation, assurance et conditions générales.</p>
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
  const formId = useId()
  const tvaId = useId()
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
  const [cgvParDefaut, setCgvParDefaut] = useState(false)
  const [etatInitial] = useState(JSON.stringify({ f, logo, cgv }))
  function fermer() {
    if (enregistrer.isPending || envoiLogo) return
    const modifie = JSON.stringify({ f, logo, cgv }) !== etatInitial || cgvParDefaut
    if (!modifie || window.confirm('Abandonner les modifications de votre entreprise ?')) onClose()
  }

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
    const acompte = Number(f.acompte_defaut.replace(',', '.'))
    if (!Number.isFinite(acompte) || acompte < 0 || acompte > 100 || !Number.isInteger(acompte)) return toast.error('L’acompte doit être un entier entre 0 et 100 %')
    enregistrer.mutate(
      {
        ...f,
        logo_url: logo,
        // Une chaîne vide REMET les conditions par défaut ; ne rien envoyer
        // laisse en place ce qui existe déjà.
        ...(cgvParDefaut ? { cgv: '' } : cgv !== identite.cgv ? { cgv } : {}),
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
    <Sheet open onOpenChange={(o) => !o && fermer()}>
      <SheetContent side="bottom" className="mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl">
        <SheetHeader className="border-b border-border px-5 py-5 sm:px-6">
          <SheetTitle>Mon entreprise</SheetTitle>
          <SheetDescription>
            Renseignée une fois, elle figure sur tous vos devis : en-tête, immatriculation,
            assurance, conditions générales.
          </SheetDescription>
        </SheetHeader>

        <form id={formId} onSubmit={(e) => { e.preventDefault(); if (!enregistrer.isPending && !envoiLogo) soumettre() }} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          {/* Logo */}
          <section className="space-y-2">
            <p className="text-sm font-medium">Logo</p>
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
                <Button type="button"
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
            <div className="sm:col-span-2 rounded-lg bg-muted/40 p-2.5 text-xs text-muted-foreground">
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
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs" htmlFor={tvaId}>Régime de TVA par défaut</Label>
              <Select
                value={f.tva_mode_defaut}
                onValueChange={(v) => maj('tva_mode_defaut', v)}
              >
                <SelectTrigger id={tvaId} className="h-11 w-full">
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
            <div className="sm:col-span-2 text-xs text-muted-foreground">
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
              <p className="text-sm font-medium">Conditions générales</p>
              {!cgvOuvertes && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setCgvOuvertes(true)}>
                  Modifier
                </Button>
              )}
            </div>
            {cgvOuvertes ? (
              <>
                <Textarea
                  aria-label="Conditions générales de vente"
                  value={cgv}
                  onChange={(e) => { setCgv(e.target.value); setCgvParDefaut(false) }}
                  rows={12}
                  className="text-sm leading-relaxed"
                />
                <Button type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => { if (window.confirm('Remplacer vos conditions personnalisées par les conditions par défaut ?')) setCgvParDefaut(true) }}
                >
                  <RotateCcw className="size-4" />
                  {cgvParDefaut ? 'Conditions par défaut appliquées à l’enregistrement' : 'Revenir aux conditions par défaut'}
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
        </form>

        <div className="border-t border-border bg-card px-5 py-4 sm:px-6">
          <Button type="submit" form={formId} className="w-full sm:ml-auto sm:flex sm:w-auto" disabled={enregistrer.isPending || envoiLogo}>
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
    <section className="space-y-3 border-t border-border pt-5">
      <p className="text-sm font-medium">{titre}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
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
  // Sans lien entre l’étiquette et le champ, un lecteur d’écran annonce
  // « champ de saisie » sans dire lequel.
  const id = useId()
  return (
    <div className={`space-y-1.5 ${large ? 'sm:col-span-2' : ''}`}>
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <Input
        id={id}
        className="h-11"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
