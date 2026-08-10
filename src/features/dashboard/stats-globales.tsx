import { FileText, Wallet, Target, Hourglass, Inbox, TrendingUp } from 'lucide-react'

import { KpiTile } from '@/components/kpi-tile'
import { SectionTitre } from '@/components/section-titre'
import { Skeleton } from '@/components/ui/skeleton'
import { formatEuros } from '@/lib/format'
import { useStatsAgence } from './use-stats-agence'

/**
 * Bandeau « depuis le début » en tête du tableau de bord.
 *
 * Le reste du tableau de bord raisonne sur le MOIS COURANT, ce qui est utile
 * au pilotage court terme mais empêche de voir où on en est globalement.
 * Ces chiffres-ci sont cumulés sur toute la base et calculés en SQL — les
 * devis vivent sur `affectations` (un par artisan affecté), table que la page
 * ne charge pas : les compter côté front revenait à en ignorer une partie.
 */
export function StatsGlobales() {
  const { data: s, isLoading, isError, refetch } = useStatsAgence()

  if (isLoading) {
    return (
      <div className="mb-6">
        <SectionTitre>Depuis le début</SectionTitre>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !s) {
    return (
      <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="font-medium">Impossible de charger les statistiques globales.</p>
        <button onClick={() => void refetch()} className="mt-1 text-xs underline">
          Réessayer
        </button>
      </div>
    )
  }

  // Taux calculé sur les dossiers TRANCHÉS (gagnés + perdus + morts) : inclure
  // les dossiers encore en cours écraserait artificiellement le résultat.
  const taux =
    s.conversion_tranches > 0
      ? Math.round((s.conversion_gagnes / s.conversion_tranches) * 100)
      : null

  const devisMoyen = s.devis_deposes > 0 ? s.devis_montant_total / s.devis_deposes : 0

  return (
    <div className="mb-6">
      <SectionTitre>Depuis le début</SectionTitre>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile
          icon={FileText}
          label="Devis déposés"
          valeur={String(s.devis_deposes)}
          sousLabel={`${formatEuros(s.devis_montant_total)} chiffrés`}
        />
        <KpiTile
          icon={TrendingUp}
          label="Devis médian"
          valeur={formatEuros(s.devis_montant_median)}
          sousLabel={`moyenne ${formatEuros(devisMoyen)}`}
        />
        <KpiTile
          icon={Target}
          label="Taux de conversion"
          valeur={taux != null ? `${taux} %` : '—'}
          sousLabel={`${s.conversion_gagnes} gagnés / ${s.conversion_tranches} tranchés`}
          tone={taux != null && taux >= 50 ? 'success' : 'warning'}
        />
        <KpiTile
          icon={Wallet}
          label="Commission à encaisser"
          valeur={formatEuros(s.commission_a_encaisser)}
          sousLabel={`${formatEuros(s.commission_encaissee)} déjà encaissés`}
          tone={s.commission_a_encaisser > 0 ? 'brand' : 'default'}
        />
        <KpiTile
          icon={Hourglass}
          label="Commission potentielle"
          valeur={formatEuros(s.commission_potentielle)}
          sousLabel="sur devis envoyés, non signés"
        />
        <KpiTile
          icon={Inbox}
          label="Non attribués"
          valeur={String(s.non_attribues)}
          sousLabel={`${s.en_attente} en attente · ${s.a_rappeler} à rappeler`}
          tone={s.non_attribues > 0 ? 'warning' : 'success'}
        />
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {s.projets_total} projets au total · {s.termines} terminés · {s.perdus} perdus ·{' '}
        {s.morts} morts · {s.artisans_actifs}/{s.artisans_total} artisans avec au moins un
        chantier · CA signé {formatEuros(s.ca_signe)}
      </p>
    </div>
  )
}
