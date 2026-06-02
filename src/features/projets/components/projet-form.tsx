import { useForm, useWatch } from 'react-hook-form'
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
import { cn } from '@/lib/utils'
import { METIERS } from '@/lib/constants'
import type { Projet, ProjetInput } from '@/types/database'

// Formulaire d'appel rapide : champs courts, saisissables pendant l'appel.
const schema = z.object({
  client_nom: z.string().min(1, 'Nom du client requis'),
  client_telephone: z.string().optional(),
  client_email: z.string().email('Email invalide').or(z.literal('')).optional(),
  client_adresse: z.string().optional(),
  client_code_postal: z.string().optional(),
  client_ville: z.string().optional(),
  metiers: z.array(z.string()).min(1, 'Choisis au moins un type de projet'),
  description: z.string().optional(),
  budget_estime: z.string().optional(), // parsé en nombre au submit
})

type FormValues = z.infer<typeof schema>

function valeursParDefaut(projet?: Projet): FormValues {
  return {
    client_nom: projet?.client_nom ?? '',
    client_telephone: projet?.client_telephone ?? '',
    client_email: projet?.client_email ?? '',
    client_adresse: projet?.client_adresse ?? '',
    client_code_postal: projet?.client_code_postal ?? '',
    client_ville: projet?.client_ville ?? '',
    metiers: projet?.metiers?.length
      ? projet.metiers
      : projet?.metier
        ? [projet.metier]
        : [],
    description: projet?.description ?? '',
    budget_estime: projet?.budget_estime != null ? String(projet.budget_estime) : '',
  }
}

export function ProjetForm({
  projet,
  onSubmit,
  submitting,
  submitLabel = 'Enregistrer',
}: {
  projet?: Projet
  onSubmit: (input: ProjetInput) => void
  submitting?: boolean
  submitLabel?: string
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: valeursParDefaut(projet),
  })
  // Métiers sélectionnés (un projet peut concerner plusieurs corps de métier).
  const metiersSeles = useWatch({ control: form.control, name: 'metiers' }) ?? []
  function toggleMetier(m: string) {
    const set = new Set(metiersSeles)
    if (set.has(m)) set.delete(m)
    else set.add(m)
    form.setValue('metiers', [...set], { shouldDirty: true, shouldValidate: true })
  }

  function handleSubmit(values: FormValues) {
    const clean = (v?: string) => (v && v.trim() ? v.trim() : null)
    const budget = parseFloat((values.budget_estime ?? '').replace(',', '.'))
    onSubmit({
      client_nom: values.client_nom.trim(),
      client_telephone: clean(values.client_telephone),
      client_email: clean(values.client_email),
      client_adresse: clean(values.client_adresse),
      client_code_postal: clean(values.client_code_postal),
      client_ville: clean(values.client_ville),
      metiers: values.metiers,
      metier: values.metiers[0], // 1er métier (colonne NOT NULL, compat)
      sous_metier: null,
      description: clean(values.description),
      budget_estime: Number.isFinite(budget) && budget > 0 ? budget : null,
      // Champs gérés ailleurs : on conserve l'existant pour une édition.
      latitude: projet?.latitude ?? null,
      longitude: projet?.longitude ?? null,
      artisan_id: projet?.artisan_id ?? null,
      statut: projet?.statut ?? 'nouveau',
      montant_devis: projet?.montant_devis ?? null,
      montant_devis_signe: projet?.montant_devis_signe ?? null,
      taux_commission: projet?.taux_commission ?? 0.1,
      commission_encaissee: projet?.commission_encaissee ?? false,
      date_signature: projet?.date_signature ?? null,
      contrat_url: projet?.contrat_url ?? null,
      devis_url: projet?.devis_url ?? null,
      devis_signe_url: projet?.devis_signe_url ?? null,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="client_nom"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nom du client *</FormLabel>
              <FormControl>
                <Input className="h-11" placeholder="Mme Martin" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="client_telephone"
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
            name="client_email"
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

        {/* Type(s) de projet — un client peut demander plusieurs corps de métier */}
        <FormField
          control={form.control}
          name="metiers"
          render={() => (
            <FormItem>
              <FormLabel>Type(s) de projet *</FormLabel>
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
              <FormDescription>
                Sélectionne tous les corps de métier concernés (ex. portail + clôture + toiture) ;
                détaille le reste dans la description.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="client_adresse"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Adresse</FormLabel>
              <FormControl>
                <Input className="h-11" placeholder="8 av. de la République" {...field} />
              </FormControl>
              <FormDescription>
                Géocodée à l'enregistrement (pour la carte et la proximité artisan).
              </FormDescription>
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="client_code_postal"
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
            name="client_ville"
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
          name="budget_estime"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Budget estimé (€)</FormLabel>
              <FormControl>
                <Input type="number" inputMode="numeric" className="h-11" {...field} />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description du projet</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  placeholder="Détails de la demande client…"
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
