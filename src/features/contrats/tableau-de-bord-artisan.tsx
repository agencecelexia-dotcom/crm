import { AlertTriangle, Euro, Hourglass, Target, TrendingUp, Wallet, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { StatTile } from './stat-tile'
import type { CranFunnelStats, StatsEspaceArtisan } from '@/types/database'

/**
 * Un cran du funnel.
 *
 * `atteint` est monotone : il inclut les dossiers ensuite perdus. Affiché
 * seul, il se lit comme un nombre d'affaires gagnées — c'est exactement le
 * malentendu qu'avait produit « Devis signé : 8 » à côté de « 2 gagnés ».
 * On montre donc systématiquement la décomposition.
 */
function CranFunnel({
  label,
  cran,
  total,
  taux,
  ton,
}: {
  label: string
  cran: CranFunnelStats
  total: number
  taux: number | null
  ton: string
}) {
  const largeur = total > 0 ? Math.max(4, Math.round((cran.atteint / total) * 100)) : 0
  // Part encore vivante ou gagnée, sur la barre : le perdu reste en creux.
  const partVivante =
    cran.atteint > 0 ? Math.round(((cran.actif + cran.gagne) / cran.atteint) * 100) : 0

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="montant text-sm font-semibold tabular-nums">{cran.atteint}</span>
          {taux != null && (
            <span className="text-xs text-muted-foreground tabular-nums">{taux} %</span>
          )}
        </span>
      </div>

      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full transition-all', ton)} style={{ width: `${(largeur * partVivante) / 100}%` }} />
        <div
          className="h-full bg-[#DC2626]/30 transition-all"
          style={{ width: `${(largeur * (100 - partVivante)) / 100}%` }}
        />
      </div>

      {/* Décomposition explicite : atteint = actif + perdu + gagné. */}
      <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums">
        {cran.actif > 0 && <span>{cran.actif} en cours</span>}
        {cran.gagne > 0 && <span className="text-[#16A34A]">{cran.gagne} gagné{cran.gagne > 1 ? 's' : ''}</span>}
        {cran.perdu > 0 && <span className="text-[#DC2626]">{cran.perdu} perdu{cran.perdu > 1 ? 's' : ''}</span>}
      </p>
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
export function TableauDeBordArtisan({
  stats,
  onFiltrer,
}: {
  stats: StatsEspaceArtisan
  /** Rend les urgences cliquables : un tableau de bord non actionnable est
   *  de la décoration (audit §2). */
  onFiltrer?: (f: 'urgents') => void
}) {
  const urgences =
    stats.rappels_echus + stats.jamais_contactes_48h + stats.devis_sans_reponse_15j

  return (
    <div className="mb-6 space-y-4">
      {/* À faire aujourd'hui — en tête, car c'est la question de l'artisan
          quand il ouvre l'app. Masqué s'il n'y a rien à traiter. */}
      {urgences > 0 && (
        <div className="rounded-2xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#B45309]">
              <AlertTriangle className="size-4" />
              À faire aujourd'hui
            </p>
            {onFiltrer && (
              <button
                type="button"
                onClick={() => onFiltrer('urgents')}
                className="rounded-full border border-[#B45309]/30 bg-card px-2.5 py-1 text-xs font-medium text-[#B45309] transition-colors hover:bg-[#F59E0B]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Voir ces chantiers
              </button>
            )}
          </div>
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
        <StatTile
          icon={XCircle}
          label="Chantiers perdus"
          valeur={String(stats.perdus)}
          sousLabel={`${formatEuros(stats.montant_perdu)} de devis`}
          tone={stats.perdus > 0 ? 'danger' : 'default'}
        />
        <StatTile
          icon={Hourglass}
          label="En cours"
          valeur={String(stats.en_cours)}
          sousLabel={`sur ${stats.leads_recus} chantiers reçus`}
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
            cran={stats.funnel.contacte}
            total={stats.leads_recus}
            taux={stats.taux_contact}
            ton="bg-[#0EA5E9]"
          />
          <CranFunnel
            label="RDV pris"
            cran={stats.funnel.rdv_pris}
            total={stats.leads_recus}
            taux={stats.taux_rdv}
            ton="bg-[#7C3AED]"
          />
          <CranFunnel
            label="Devis envoyé"
            cran={stats.funnel.devis_envoye}
            total={stats.leads_recus}
            taux={stats.taux_devis}
            ton="bg-[#F59E0B]"
          />
          <CranFunnel
            label="Devis signé"
            cran={stats.funnel.devis_signe}
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

      {/* Une étape « signé » sans PDF ni montant ne peut fonder aucune
          commission : on le dit, plutôt que de la compter silencieusement. */}
      {stats.signatures_declarees_sans_preuve > 0 && (
        <p className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-3 text-xs text-[#92400E]">
          <strong className="tabular-nums">{stats.signatures_declarees_sans_preuve}</strong>{' '}
          chantier{stats.signatures_declarees_sans_preuve > 1 ? 's ont' : ' a'} été marqué
          {stats.signatures_declarees_sans_preuve > 1 ? 's' : ''} « devis signé » sans devis
          déposé ni montant saisi. Complétez-les : sans justificatif, ces montants ne peuvent
          pas être comptés.
        </p>
      )}

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
