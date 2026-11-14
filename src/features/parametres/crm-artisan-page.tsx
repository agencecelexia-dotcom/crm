import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ECRANS } from '@/features/contrats/ecrans-espace'
import { useFonctionnalitesArtisan, useModifierFonctionnaliteArtisan } from './fonctionnalites-artisan'

export function CrmArtisanPage() {
  const query = useFonctionnalitesArtisan()
  const modifier = useModifierFonctionnaliteArtisan()
  return <div className="max-w-3xl">
    <PageHeader titre="CRM artisan" sousTitre="Choisissez les rubriques accessibles à tous vos artisans et partenaires." />
    <p className="mb-6 rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm leading-relaxed text-violet-950">
      Désactiver une rubrique masque son menu et ses boutons dans l’espace artisan. Les documents et les données sont conservés pour une réactivation ultérieure. Les espaces déjà ouverts se mettent à jour sous 30 secondes.
    </p>
    {query.isError ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
      Réglages indisponibles. Aucun changement n’a été appliqué.
      <Button variant="outline" className="ml-3" onClick={() => void query.refetch()}>Réessayer</Button>
    </div> : <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {ECRANS.map(({ cle, titre, detail, Icone }) => <div key={cle} className="flex items-center gap-4 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icone className="size-5" /></span>
        <div className="min-w-0 flex-1"><label htmlFor={`feature-${cle}`} className="font-medium">{titre}</label>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
          <p className="mt-1 text-xs text-muted-foreground">{cle === 'chantiers' ? 'Rubrique principale · toujours accessible' : query.isPending ? 'Chargement…' : query.data?.[cle] ? 'Visible dans l’espace artisan' : 'Masquée · données conservées'}</p>
        </div>
        <Switch id={`feature-${cle}`} checked={cle === 'chantiers' || query.data?.[cle] === true}
          disabled={cle === 'chantiers' || query.isPending || modifier.isPending}
          onCheckedChange={(active) => {
            if (cle === 'chantiers') return
            modifier.mutate({ cle, active }, {
              onSuccess: () => toast.success(`${titre} ${active ? 'activé' : 'désactivé'}`),
              onError: () => toast.error('Modification refusée ou connexion interrompue. Le réglage précédent est conservé.'),
            })
          }} />
      </div>)}
    </div>}
    <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Le dépôt d’un PDF existant dans un chantier reste disponible pour le suivi. Désactiver « Mes devis » retire le générateur de devis.</p>
  </div>
}
