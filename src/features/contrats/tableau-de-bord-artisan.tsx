import { AlertTriangle, Euro, Hourglass, Target, TrendingUp, Wallet } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { StatTile } from './stat-tile'
import type { StatsEspaceArtisan } from '@/types/database'

/** Un cran du funnel, avec son taux de passage depuis le cran précédent. */
function CranFunnel({
  label,
  valeur,
  total,
  taux,
  ton,
}: {
  label: string
  valeur: number
  total: number
  taux: number | null
  ton: string
}) {
  const largeur = total > 0 ? Math.max(4, Math.round((valeur / total) * 100)) : 0
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="montant text-sm font-semibold tabular-nums">{valeur}</span>
          {taux != null && (
            <span className="text-xs text-muted-foreground tabular-nums">{taux} %</span>
          )}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', ton)}
          style={{ width: `${largeur}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Tableau de bord de l'artisan.
 *
 * Remplace l'ancien `ResumeArtisan`, qui filtrait sur le champ `statut` et
 * reproduisait donc les écarts relevés à l'audit : les devis chiffrés sur un
 * dossier « en attente » étaient invisibles, et un chantier passé en
 * « Terminé » sortait du chiffre d'affaires.
 *
 * Tout vient désormais de `stats_artisan_faits()` : une base unique pour le
 * CA, les devis et la commission, qui divergeaient auparavant dans la même page.
 */
export function TableauDeBordArtisan({ stats }: { stats: StatsEspaceArtisan }) {
  const urgences =
    stats.rappels_echus + stats.jamais_contactes_48h + stats.devis_sans_reponse_15j

  return (
    <div className="mb-6 space-y-4">
      {/* À faire aujourd'hui — en tête, car c'est la question de l'artisan
          quand il ouvre l'app. Masqué s'il n'y a rien à traiter. */}
      {urgences > 0 && (
        <div className="rounded-2xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#B45309]">
            <AlertTriangle className="size-4" />
            À faire aujourd'hui
          </p>
          <ul className="space-y-1 text-sm text-[#92400E]">
            {stats.rappels_echus > 0 && (
              <li>
                <strong className="tabular-nums">{stats.rappels_echus}</strong> rappel
                {stats.rappels_echus > 1 ? 's' : ''} à passer
              </li>
            )}
            {stats.jamais_contactes_48h > 0 && (
              <li>
                <strong className="tabular-nums">{stats.jamais_contactes_48h}</strong> chantier
                {stats.jamais_contactes_48h > 1 ? 's' : ''} jamais contacté
                {stats.jamais_contactes_48h > 1 ? 's' : ''} depuis plus de 48 h
              </li>
            )}
            {stats.devis_sans_reponse_15j > 0 && (
              <li>
                <strong className="tabular-nums">{stats.devis_sans_reponse_15j}</strong> devis sans
                réponse depuis plus de 15 jours
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Argent */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={Euro}
          label="Chiffre d'affaires signé"
          valeur={formatEuros(stats.ca_signe)}
          sousLabel={`${stats.gagnes} chantier${stats.gagnes > 1 ? 's' : ''} gagné${stats.gagnes > 1 ? 's' : ''}`}
          tone="success"
        />
        <StatTile
          icon={Hourglass}
          label="Pipe en cours"
          valeur={formatEuros(stats.pipe_en_cours)}
          sousLabel="devis chiffrés, non tranchés"
          tone="brand"
        />
        <StatTile
          icon={TrendingUp}
          label="Panier médian"
          valeur={formatEuros(stats.panier_median)}
          sousLabel={`moyenne ${formatEuros(stats.panier_moyen)}`}
        />
        <StatTile
          icon={Wallet}
          label="Commission à régler"
          valeur={formatEuros(stats.commission_due)}
          sousLabel={`${formatEuros(stats.commission_reglee)} déjà réglés`}
          tone={stats.commission_due > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Funnel — chaque cran est cumulatif : « a atteint au moins cette étape ». */}
      <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Target className="size-4 text-primary" />
            Votre parcours
          </p>
          <span className="text-xs text-muted-foreground">
            {stats.leads_recus} chantiers reçus
          </span>
        </div>

        <div className="space-y-3">
          <CranFunnel
            label="Client contacté"
            valeur={stats.contactes}
            total={stats.leads_recus}
            taux={stats.taux_contact}
            ton="bg-[#0EA5E9]"
          />
          <CranFunnel
            label="RDV pris"
            valeur={stats.rdv}
            total={stats.leads_recus}
            taux={stats.taux_rdv}
            ton="bg-[#7C3AED]"
          />
          <CranFunnel
            label="Devis envoyé"
            valeur={stats.devis_envoyes}
            total={stats.leads_recus}
            taux={stats.taux_devis}
            ton="bg-[#F59E0B]"
          />
          <CranFunnel
            label="Devis signé"
            valeur={stats.devis_signes}
            total={stats.leads_recus}
            taux={stats.taux_signature}
            ton="bg-[#22C55E]"
          />
        </div>

        {/* Délais : médianes, insensibles aux saisies rétroactives. */}
        {(stats.delai_contact_j != null || stats.delai_devis_j != null) && (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            Délais médians :
            {stats.delai_contact_j != null && (
              <> réception → contact <strong>{stats.delai_contact_j} j</strong></>
            )}
            {stats.delai_devis_j != null && (
              <> · → devis <strong>{stats.delai_devis_j} j</strong></>
            )}
            {stats.delai_signature_j != null && (
              <> · devis → signature <strong>{stats.delai_signature_j} j</strong></>
            )}
          </p>
        )}
      </div>

      {/* Ce que les abandons après chiffrage ont coûté : l'information la plus
          actionnable pour l'artisan comme pour l'agence. */}
      {stats.montant_perdu > 0 && (
        <p className="text-xs text-muted-foreground">
          {stats.perdus} chantier{stats.perdus > 1 ? 's' : ''} perdu
          {stats.perdus > 1 ? 's' : ''}, représentant{' '}
          <strong className="montant">{formatEuros(stats.montant_perdu)}</strong> de devis chiffrés.
          {stats.taux_refus_avant_devis != null && (
            <> {stats.taux_refus_avant_devis} % des chantiers reçus ont été refusés avant chiffrage.</>
          )}
        </p>
      )}
    </div>
  )
}
