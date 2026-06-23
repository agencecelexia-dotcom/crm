import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { METIERS, SOUS_METIERS, DEPARTEMENTS, DEPARTEMENT_NOM } from '@/lib/constants'
import { CpVilleFields } from '@/components/cp-ville-fields'
import { geocoder } from '@/lib/geocoding'
import { SocieteSearch } from './societe-search'
import type { ResultatEntreprise } from '@/lib/entreprise'
import type { Artisan, ArtisanInput, ZoneCouverte } from '@/types/database'

// Validation : seul le nom est obligatoire (saisie au fil de l'eau).
const schema = z.object({
  nom: z.string().min(1, 'Nom requis'),
  prenom: z.string().optional(),
  societe: z.string().optional(),
  telephone: z.string().optional(),
  email: z.string().email('Email invalide').or(z.literal('')).optional(),
  metiers: z.array(z.string()),
  sous_metiers: z.array(z.string()),
  rayon_km: z.string().optional(), // parsé en nombre au submit
  departements_couverts: z.string().optional(), // "35 44 56" → array au submit
  adresse: z.string().optional(),
  ville: z.string().optional(),
  code_postal: z.string().optional(),
  nb_salaries: z.string().optional(),
  annees_experience: z.string().optional(),
  assurance_rc_pro: z.string().optional(), // 'oui' | 'non' | ''
  assurance_decennale: z.string().optional(),
  specificites: z.string().optional(),
  // Société (pour le contrat)
  forme_juridique: z.string().optional(),
  capital_social: z.string().optional(),
  siren: z.string().optional(),
  ville_immatriculation: z.string().optional(),
  representant: z.string().optional(),
  qualite_representant: z.string().optional(),
  taux_commission: z.string().optional(), // en %, parsé au submit
})

type FormValues = z.infer<typeof schema>

// Validation stricte (lien public d'auto-inscription) : tous les champs clés requis.
const strictSchema = schema.extend({
  telephone: z.string().min(6, 'Téléphone requis'),
  email: z.string().email('Email requis et valide'),
  societe: z.string().min(1, 'Société requise'),
  siren: z.string().min(1, 'SIREN / SIRET requis'),
  adresse: z.string().min(1, 'Adresse requise'),
  code_postal: z.string().min(1, 'Code postal requis'),
  ville: z.string().min(1, 'Ville requise'),
  metiers: z.array(z.string()).min(1, 'Choisis au moins un métier'),
})

// Convertit un artisan existant en valeurs de formulaire.
function valeursParDefaut(artisan?: Artisan): FormValues {
  return {
    nom: artisan?.nom ?? '',
    prenom: artisan?.prenom ?? '',
    societe: artisan?.societe ?? '',
    telephone: artisan?.telephone ?? '',
    email: artisan?.email ?? '',
    metiers: artisan?.metiers ?? [],
    sous_metiers: artisan?.sous_metiers ?? [],
    rayon_km: artisan?.rayon_km != null ? String(artisan.rayon_km) : '',
    departements_couverts: artisan?.departements_couverts?.join(' ') ?? '',
    adresse: artisan?.adresse ?? '',
    ville: artisan?.ville ?? '',
    code_postal: artisan?.code_postal ?? '',
    nb_salaries: artisan?.nb_salaries != null ? String(artisan.nb_salaries) : '',
    annees_experience: artisan?.annees_experience != null ? String(artisan.annees_experience) : '',
    assurance_rc_pro: artisan?.assurance_rc_pro == null ? '' : artisan.assurance_rc_pro ? 'oui' : 'non',
    assurance_decennale:
      artisan?.assurance_decennale == null ? '' : artisan.assurance_decennale ? 'oui' : 'non',
    specificites: artisan?.specificites ?? '',
    forme_juridique: artisan?.forme_juridique ?? '',
    capital_social: artisan?.capital_social ?? '',
    siren: artisan?.siren ?? '',
    ville_immatriculation: artisan?.ville_immatriculation ?? '',
    representant: artisan?.representant ?? '',
    qualite_representant: artisan?.qualite_representant ?? '',
    taux_commission: String(
      artisan?.taux_commission != null ? Math.round(artisan.taux_commission * 100) : 10,
    ),
  }
}

export function ArtisanForm({
  artisan,
  onSubmit,
  submitting,
  submitLabel = 'Enregistrer',
  hideCommission = false,
  strict = false,
}: {
  artisan?: Artisan
  onSubmit: (input: ArtisanInput) => void
  submitting?: boolean
  submitLabel?: string
  hideCommission?: boolean // masque le taux de commission (lien public artisan)
  strict?: boolean // tous les champs clés obligatoires (auto-inscription)
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(strict ? strictSchema : schema),
    defaultValues: valeursParDefaut(artisan),
  })
  const [zoneMode, setZoneMode] = useState<'rayon' | 'departements'>(
    artisan?.departements_couverts?.length ? 'departements' : 'rayon',
  )
  // Zones d'intervention multiples (ville + rayon). Seed depuis l'existant ou le rayon historique.
  const [zones, setZones] = useState<ZoneCouverte[]>(
    artisan?.zones_couvertes?.length
      ? artisan.zones_couvertes
      : artisan?.rayon_km != null && artisan?.ville
        ? [
            {
              ville: artisan.ville,
              lat: artisan.latitude,
              lon: artisan.longitude,
              rayon_km: artisan.rayon_km,
            },
          ]
        : [],
  )
  const [villeZone, setVilleZone] = useState('')
  const [rayonZone, setRayonZone] = useState(30)
  const [ajoutZone, setAjoutZone] = useState(false)
  // Départements : saisie normée (sélection + ajout en chips).
  const [deptsList, setDeptsList] = useState<string[]>(artisan?.departements_couverts ?? [])
  const [deptToAdd, setDeptToAdd] = useState('')
  const ajouterDept = () => {
    if (deptToAdd && !deptsList.includes(deptToAdd)) setDeptsList((d) => [...d, deptToAdd])
    setDeptToAdd('')
  }
  const retirerDept = (c: string) => setDeptsList((d) => d.filter((x) => x !== c))

  async function ajouterZone() {
    const v = villeZone.trim()
    if (!v) return toast.error('Indique une ville')
    setAjoutZone(true)
    try {
      const c = await geocoder(`${v}, France`)
      if (!c) return toast.error('Ville introuvable')
      setZones((z) => [...z, { ville: v, lat: c.lat, lon: c.lon, rayon_km: rayonZone }])
      setVilleZone('')
    } finally {
      setAjoutZone(false)
    }
  }
  const retirerZone = (i: number) => setZones((z) => z.filter((_, idx) => idx !== i))

  function handleSubmit(values: FormValues) {
    // Normalisation vers le type ArtisanInput (chaînes vides → null).
    const clean = (v?: string) => (v && v.trim() ? v.trim() : null)
    const num = (v?: string) => (v && v.trim() ? parseInt(v, 10) : null)
    const ouiNon = (v?: string) => (v === 'oui' ? true : v === 'non' ? false : null)
    const nbSal = num(values.nb_salaries)
    const useDepts = zoneMode === 'departements'
    // Zone obligatoire en mode strict (villes OU au moins un département).
    if (strict) {
      const zoneOk = useDepts ? deptsList.length > 0 : zones.length > 0
      if (!zoneOk) {
        toast.error('Indique ta zone : au moins une ville (+ rayon) ou des départements.')
        return
      }
    }
    onSubmit({
      nom: values.nom.trim(),
      prenom: clean(values.prenom),
      societe: clean(values.societe),
      telephone: clean(values.telephone),
      email: clean(values.email),
      metiers: values.metiers ?? [],
      sous_metiers: values.sous_metiers ?? [],
      zone_intervention: null, // champ retiré (zones/départements suffisent)
      rayon_km: null, // remplacé par zones_couvertes (villes + rayon)
      departements_couverts: useDepts ? deptsList : [],
      zones_couvertes: useDepts ? [] : zones,
      adresse: clean(values.adresse),
      ville: clean(values.ville),
      code_postal: clean(values.code_postal),
      specificites: clean(values.specificites),
      nb_salaries: nbSal,
      annees_experience: num(values.annees_experience),
      assurance_rc_pro: ouiNon(values.assurance_rc_pro),
      assurance_decennale: ouiNon(values.assurance_decennale),
      // 0 salarié → Entreprise Individuelle (si la forme n'est pas déjà renseignée)
      forme_juridique: clean(values.forme_juridique) ?? (nbSal === 0 ? 'EI' : null),
      capital_social: clean(values.capital_social),
      siren: clean(values.siren),
      ville_immatriculation: clean(values.ville_immatriculation),
      representant: clean(values.representant),
      qualite_representant: clean(values.qualite_representant),
      taux_commission: (() => {
        const t = parseFloat((values.taux_commission ?? '').replace(',', '.'))
        return Number.isFinite(t) && t >= 0 ? t / 100 : 0.1
      })(),
      // Coordonnées recalculées par le hook au moment du save.
      latitude: null,
      longitude: null,
    })
  }

  const metiersSeles = useWatch({ control: form.control, name: 'metiers' }) ?? []
  const sousMetiersSeles = useWatch({ control: form.control, name: 'sous_metiers' }) ?? []
  // CP/Ville observés pour l'autocomplétion croisée.
  const cpVal = useWatch({ control: form.control, name: 'code_postal' }) ?? ''
  const villeVal = useWatch({ control: form.control, name: 'ville' }) ?? ''
  const nbSalVal = useWatch({ control: form.control, name: 'nb_salaries' }) ?? ''

  function toggleMetier(m: string) {
    const set = new Set(metiersSeles)
    if (set.has(m)) {
      set.delete(m)
      // En retirant un métier, on retire aussi ses sous-métiers cochés.
      const aRetirer = new Set(SOUS_METIERS[m] ?? [])
      form.setValue(
        'sous_metiers',
        sousMetiersSeles.filter((s) => !aRetirer.has(s)),
        { shouldDirty: true },
      )
    } else {
      set.add(m)
    }
    form.setValue('metiers', [...set], { shouldDirty: true })
  }

  function toggleSousMetier(s: string) {
    const set = new Set(sousMetiersSeles)
    if (set.has(s)) set.delete(s)
    else set.add(s)
    form.setValue('sous_metiers', [...set], { shouldDirty: true })
  }

  // Auto-remplissage depuis le résultat de recherche d'entreprise.
  function appliquerEntreprise(r: ResultatEntreprise) {
    const opt = { shouldDirty: true }
    if (r.raison_sociale) form.setValue('societe', r.raison_sociale, opt)
    if (r.siren) form.setValue('siren', r.siren, opt)
    if (r.forme_juridique) form.setValue('forme_juridique', r.forme_juridique, opt)
    if (r.ville) form.setValue('ville_immatriculation', r.ville, opt)
    if (r.representant) form.setValue('representant', r.representant, opt)
    if (r.qualite_representant) form.setValue('qualite_representant', r.qualite_representant, opt)
    // Adresse du siège (utile aussi pour la carte)
    if (r.adresse) form.setValue('adresse', r.adresse, opt)
    if (r.code_postal) form.setValue('code_postal', r.code_postal, opt)
    if (r.ville) form.setValue('ville', r.ville, opt)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="nom"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nom *</FormLabel>
              <FormControl>
                <Input className="h-11" placeholder="Dupont" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="prenom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prénom</FormLabel>
                <FormControl>
                  <Input className="h-11" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="societe"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Société</FormLabel>
                <FormControl>
                  <Input className="h-11" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="telephone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Téléphone</FormLabel>
                <FormControl>
                  <Input type="tel" className="h-11" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" className="h-11" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Sélection des métiers (chips multi-sélection) */}
        <FormItem>
          <FormLabel>Métiers</FormLabel>
          <div className="flex flex-wrap gap-2">
            {METIERS.map((m) => {
              const actif = metiersSeles.includes(m)
              return (
                <button
                  type="button"
                  key={m}
                  onClick={() => toggleMetier(m)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm transition-colors',
                    actif
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:bg-accent',
                  )}
                >
                  {m}
                </button>
              )
            })}
          </div>
          <FormDescription>Sélectionne un ou plusieurs métiers.</FormDescription>
        </FormItem>

        {/* Sous-métiers : se déroulent pour chaque métier sélectionné.
            On coche précisément ce que l'artisan sait faire. */}
        {metiersSeles.length > 0 && (
          <div className="space-y-4 rounded-xl border border-border bg-secondary/40 p-3">
            <p className="text-sm font-medium">
              Précise ce qu'il fait exactement
            </p>
            {metiersSeles.map((m) => (
              <div key={m} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {m}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(SOUS_METIERS[m] ?? []).map((s) => {
                    const actif = sousMetiersSeles.includes(s)
                    return (
                      <button
                        type="button"
                        key={s}
                        onClick={() => toggleSousMetier(s)}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-sm transition-colors',
                          actif
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card text-foreground hover:bg-accent',
                        )}
                      >
                        {s}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Zone d'intervention : rayon autour de l'adresse OU départements desservis */}
        <FormItem>
          <FormLabel>Zone d'intervention</FormLabel>
          <div className="flex flex-wrap gap-1.5">
            {(['rayon', 'departements'] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                onClick={() => setZoneMode(mode)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm transition-colors',
                  zoneMode === mode
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-accent',
                )}
              >
                {mode === 'rayon' ? 'Villes + rayon' : 'Départements'}
              </button>
            ))}
          </div>
          {zoneMode === 'rayon' ? (
            <div className="mt-2 space-y-2">
              {zones.map((z, i) => (
                <div
                  key={`${z.ville}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border p-2"
                >
                  <span className="text-sm">
                    <b>{z.ville}</b> — {z.rayon_km} km
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    onClick={() => retirerZone(i)}
                    aria-label="Retirer"
                  >
                    ✕
                  </Button>
                </div>
              ))}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  className="h-11 flex-1"
                  placeholder="Ville (ex. Nantes)"
                  value={villeZone}
                  onChange={(e) => setVilleZone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      ajouterZone()
                    }
                  }}
                />
                <Select value={String(rayonZone)} onValueChange={(v) => setRayonZone(Number(v))}>
                  <SelectTrigger className="h-11 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[15, 30, 50, 80, 120, 200, 300].map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r} km
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" className="h-11" onClick={ajouterZone} disabled={ajoutZone}>
                  {ajoutZone ? <Loader2 className="size-4 animate-spin" /> : '+'} Ajouter
                </Button>
              </div>
              <FormDescription>
                Ajoute une ou plusieurs villes avec leur rayon. Idéal pour des secteurs séparés
                (ex. <b>Nantes 50 km</b> ET <b>Paris 30 km</b>, sans couvrir entre les deux).
              </FormDescription>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {deptsList.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {deptsList.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground"
                    >
                      {c} — {DEPARTEMENT_NOM(c)}
                      <button
                        type="button"
                        onClick={() => retirerDept(c)}
                        className="ml-0.5 opacity-80 hover:opacity-100"
                        aria-label="Retirer"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Select value={deptToAdd} onValueChange={setDeptToAdd}>
                  <SelectTrigger className="h-11 flex-1">
                    <SelectValue placeholder="Choisir un département…" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTEMENTS.filter((d) => !deptsList.includes(d.code)).map((d) => (
                      <SelectItem key={d.code} value={d.code}>
                        {d.code} — {d.nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={ajouterDept}
                  disabled={!deptToAdd}
                >
                  + Ajouter
                </Button>
              </div>
              <FormDescription>
                Sélectionne un département puis « Ajouter ». Répète pour en couvrir plusieurs.
              </FormDescription>
            </div>
          )}
        </FormItem>

        <FormField
          control={form.control}
          name="adresse"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Adresse</FormLabel>
              <FormControl>
                <Input className="h-11" placeholder="12 rue des Lilas" {...field} />
              </FormControl>
              <FormDescription>
                Géocodée à l'enregistrement. Le <strong>rayon (km)</strong> ci-dessus s'applique
                <strong> autour de cette adresse</strong> — c'est ce qui sert à proposer les artisans
                proches d'un client (la région reste juste indicative).
              </FormDescription>
            </FormItem>
          )}
        />

        <CpVilleFields
          codePostal={cpVal}
          ville={villeVal}
          onChange={(cp, v) => {
            form.setValue('code_postal', cp, { shouldDirty: true })
            form.setValue('ville', v, { shouldDirty: true })
          }}
        />

        {/* ----- Profil de l'entreprise ----- */}
        <div className="space-y-4 rounded-xl border border-border p-3">
          <p className="text-sm font-semibold">Profil de l'entreprise</p>

          <FormItem>
            <FormLabel>Nombre de salariés</FormLabel>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0 text-lg"
                onClick={() =>
                  form.setValue(
                    'nb_salaries',
                    String(Math.max(0, (parseInt(nbSalVal || '0', 10) || 0) - 1)),
                    { shouldDirty: true },
                  )
                }
              >
                −
              </Button>
              <Input
                className="h-11 w-20 text-center"
                inputMode="numeric"
                value={nbSalVal}
                onChange={(e) =>
                  form.setValue('nb_salaries', e.target.value.replace(/\D/g, ''), {
                    shouldDirty: true,
                  })
                }
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0 text-lg"
                onClick={() =>
                  form.setValue('nb_salaries', String((parseInt(nbSalVal || '0', 10) || 0) + 1), {
                    shouldDirty: true,
                  })
                }
              >
                +
              </Button>
              {nbSalVal === '0' && (
                <span className="text-xs text-muted-foreground">→ Entreprise individuelle (EI)</span>
              )}
            </div>
          </FormItem>

          <FormField
            control={form.control}
            name="annees_experience"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Années d'expérience</FormLabel>
                <FormControl>
                  <Input type="number" inputMode="numeric" className="h-11" placeholder="Ex. 8" {...field} />
                </FormControl>
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="assurance_rc_pro"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assurance RC Pro</FormLabel>
                  <Select value={field.value || ''} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="oui">Oui</SelectItem>
                      <SelectItem value="non">Non</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="assurance_decennale"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Garantie décennale</FormLabel>
                  <Select value={field.value || ''} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="oui">Oui</SelectItem>
                      <SelectItem value="non">Non</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* ----- Société (pour le contrat) ----- */}
        <div className="space-y-4 rounded-xl border border-border p-3">
          <p className="text-sm font-semibold">Société (pour le contrat)</p>

          <SocieteSearch onSelect={appliquerEntreprise} />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="forme_juridique"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Forme juridique</FormLabel>
                  <FormControl>
                    <Input className="h-11" placeholder="SARL, SASU…" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capital_social"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Capital (€)</FormLabel>
                  <FormControl>
                    <Input className="h-11" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="siren"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SIREN</FormLabel>
                  <FormControl>
                    <Input className="h-11" inputMode="numeric" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ville_immatriculation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ville d'immatriculation</FormLabel>
                  <FormControl>
                    <Input className="h-11" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="representant"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Représentant</FormLabel>
                  <FormControl>
                    <Input className="h-11" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="qualite_representant"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Qualité</FormLabel>
                  <FormControl>
                    <Input className="h-11" placeholder="Gérant, Président…" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>

          {!hideCommission && (
            <FormField
              control={form.control}
              name="taux_commission"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Taux de commission par défaut (% TTC)</FormLabel>
                  <FormControl>
                    <Input type="number" inputMode="decimal" className="h-11" {...field} />
                  </FormControl>
                  <FormDescription>
                    Repris dans le contrat et proposé par défaut sur ses projets (modifiable par projet).
                  </FormDescription>
                </FormItem>
              )}
            />
          )}
        </div>

        <FormField
          control={form.control}
          name="specificites"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Spécificités</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  placeholder="Ce qu'il fait exactement, qualités, notes…"
                  {...field}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <Button type="submit" className="h-11 w-full" disabled={submitting}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitLabel}
        </Button>
      </form>
    </Form>
  )
}
