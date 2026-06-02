import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'

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
import { METIERS, SOUS_METIERS, REGIONS } from '@/lib/constants'
import type { Artisan, ArtisanInput } from '@/types/database'

// Validation : seul le nom est obligatoire (saisie au fil de l'eau).
const schema = z.object({
  nom: z.string().min(1, 'Nom requis'),
  prenom: z.string().optional(),
  societe: z.string().optional(),
  telephone: z.string().optional(),
  email: z.string().email('Email invalide').or(z.literal('')).optional(),
  metiers: z.array(z.string()),
  sous_metiers: z.array(z.string()),
  zone_intervention: z.string().optional(),
  rayon_km: z.string().optional(), // parsé en nombre au submit
  adresse: z.string().optional(),
  ville: z.string().optional(),
  code_postal: z.string().optional(),
  specificites: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

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
    zone_intervention: artisan?.zone_intervention ?? '',
    rayon_km: artisan?.rayon_km != null ? String(artisan.rayon_km) : '',
    adresse: artisan?.adresse ?? '',
    ville: artisan?.ville ?? '',
    code_postal: artisan?.code_postal ?? '',
    specificites: artisan?.specificites ?? '',
  }
}

export function ArtisanForm({
  artisan,
  onSubmit,
  submitting,
  submitLabel = 'Enregistrer',
}: {
  artisan?: Artisan
  onSubmit: (input: ArtisanInput) => void
  submitting?: boolean
  submitLabel?: string
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: valeursParDefaut(artisan),
  })

  function handleSubmit(values: FormValues) {
    // Normalisation vers le type ArtisanInput (chaînes vides → null).
    const clean = (v?: string) => (v && v.trim() ? v.trim() : null)
    const rayon = parseInt(values.rayon_km ?? '', 10)
    onSubmit({
      nom: values.nom.trim(),
      prenom: clean(values.prenom),
      societe: clean(values.societe),
      telephone: clean(values.telephone),
      email: clean(values.email),
      metiers: values.metiers ?? [],
      sous_metiers: values.sous_metiers ?? [],
      zone_intervention: clean(values.zone_intervention),
      rayon_km: Number.isFinite(rayon) && rayon > 0 ? rayon : null,
      adresse: clean(values.adresse),
      ville: clean(values.ville),
      code_postal: clean(values.code_postal),
      specificites: clean(values.specificites),
      // Coordonnées recalculées par le hook au moment du save.
      latitude: null,
      longitude: null,
    })
  }

  const metiersSeles = form.watch('metiers') ?? []
  const sousMetiersSeles = form.watch('sous_metiers') ?? []

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

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="zone_intervention"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Région</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="h-11 w-full">
                      <SelectValue placeholder="Choisir" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="rayon_km"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Rayon (km)</FormLabel>
                <FormControl>
                  <Input type="number" inputMode="numeric" className="h-11" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

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

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="code_postal"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Code postal</FormLabel>
                <FormControl>
                  <Input inputMode="numeric" className="h-11" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ville"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ville</FormLabel>
                <FormControl>
                  <Input className="h-11" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
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
