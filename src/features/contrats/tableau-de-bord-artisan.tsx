import { AlertTriangle, ArrowRight, Euro, Hourglass, Wallet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatEuros } from '@/lib/format'
import { StatTile } from './stat-tile'
import { urgenceChantier } from './urgence-chantier'
import type { CranFunnelStats, ProjetEspace, StatsEspaceArtisan } from '@/types/database'

/** Une étape atteinte inclut les dossiers perdus ensuite : décomposition explicite. */
function CranFunnel({ label, cran, total, taux }: {
  label: string
  cran: CranFunnelStats
  total: number
  taux: number | null
}) {
  const largeur = total > 0 ? Math.min(100, (cran.atteint / total) * 100) : 0
  const partVivante = cran.atteint > 0 ? ((cran.actif + cran.gagne) / cran.atteint) * 100 : 0
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px]">{label}</span>
        <span className="text-[13px] font-medium tabular-nums">{cran.atteint}{taux != null && <span className="ml-2 text-xs font-normal text-muted-foreground">{taux} %</span>}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-sm bg-muted" aria-hidden>
        <div className="h-full bg-primary/70" style={{ width: `${largeur * partVivante / 100}%` }} />
        <div className="h-full bg-muted-foreground/35" style={{ width: `${largeur * (100 - partVivante) / 100}%` }} />
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
        <span>{cran.actif} en cours</span><span>{cran.gagne} gagné{cran.gagne > 1 ? 's' : ''}</span><span>{cran.perdu} perdu{cran.perdu > 1 ? 's' : ''}</span>
      </p>
    </div>
  )
}

/** Tous les montants proviennent de stats_artisan_faits(), sans recalcul local. */
export function TableauDeBordArtisan({ stats, projets, onFiltrer }: {
  stats: StatsEspaceArtisan
  projets?: ProjetEspace[]
  onFiltrer?: (f: 'urgents') => void
}) {
  const urgencesVisibles = projets?.map(urgenceChantier).filter((u) => u.niveau === 'critique' || u.niveau === 'haute')
  const nombreParGroupe = (groupe: string) => urgencesVisibles?.filter((u) => u.groupe === groupe).length ?? 0
  const lignesUrgentes = (urgencesVisibles ? [
    { nombre: nombreParGroupe('nouveaux'), libelle: nombreParGroupe('nouveaux') > 1 ? 'nouveaux chantiers à contacter' : 'nouveau chantier à contacter' },
    { nombre: nombreParGroupe('rdv'), libelle: 'rendez-vous à mettre à jour' },
    { nombre: nombreParGroupe('relances'), libelle: nombreParGroupe('relances') > 1 ? 'chantiers à rappeler ou à contacter' : 'chantier à rappeler ou à contacter' },
    { nombre: nombreParGroupe('devis'), libelle: 'devis à relancer' },
  ] : [
    { nombre: stats.rappels_echus, libelle: `rappel${stats.rappels_echus > 1 ? 's' : ''} à passer` },
    { nombre: stats.jamais_contactes_48h, libelle: `chantier${stats.jamais_contactes_48h > 1 ? 's' : ''} sans contact depuis 48 h` },
    { nombre: stats.devis_sans_reponse_15j, libelle: 'devis sans mise à jour depuis 15 jours' },
  ]).filter((l) => l.nombre > 0)
  const urgences = lignesUrgentes.reduce((total, ligne) => total + ligne.nombre, 0)

  return (
    <section aria-label="Synthèse de votre activité" className="mb-6 space-y-3">
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4">
        <StatTile grouped icon={Euro} label="CA signé" valeur={formatEuros(stats.ca_signe)} sousLabel={`${stats.gagnes} chantier${stats.gagnes > 1 ? 's' : ''} gagné${stats.gagnes > 1 ? 's' : ''}`} />
        <StatTile grouped icon={Hourglass} label="Devis en cours" valeur={formatEuros(stats.pipe_en_cours)} sousLabel="Devis chiffrés, non tranchés" />
        <StatTile grouped icon={Wallet} label="Commission à régler" valeur={formatEuros(stats.commission_due)} sousLabel={`${formatEuros(stats.commission_reglee)} déjà réglés`} tone="brand" />
        <StatTile grouped icon={Hourglass} label="Avant signature" valeur={String(stats.en_cours)} sousLabel={`Sur ${stats.leads_recus} chantiers reçus`} />
      </div>

      {urgences > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex sm:flex-wrap sm:gap-x-5 sm:px-5">
          <p className="flex items-center gap-2 text-[13px] font-medium"><AlertTriangle className="size-4 shrink-0 text-amber-700" aria-hidden />À traiter</p>
          <ul className="col-span-2 row-start-2 flex min-w-0 flex-wrap gap-x-5 gap-y-2 sm:flex-1">
            {lignesUrgentes.map((l) => <li key={l.libelle} className="text-xs text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{l.nombre}</span> {l.libelle}</li>)}
          </ul>
          {onFiltrer && <Button variant="outline" size="sm" className="col-start-2 row-start-1" aria-label="Voir ces chantiers" onClick={() => onFiltrer('urgents')}><span className="sm:hidden">Voir</span><span className="hidden sm:inline">Voir ces chantiers</span><ArrowRight className="size-3.5" aria-hidden /></Button>}
        </div>
      )}

      {stats.signatures_declarees_sans_preuve > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 text-xs leading-relaxed text-amber-900" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p><span className="font-medium tabular-nums">{stats.signatures_declarees_sans_preuve}</span> chantier{stats.signatures_declarees_sans_preuve > 1 ? 's ont' : ' a'} été marqué{stats.signatures_declarees_sans_preuve > 1 ? 's' : ''} « devis signé » sans devis déposé ni montant saisi. Complétez-les : sans justificatif, ces montants ne peuvent pas être comptés.</p>
        </div>
      )}

      <details className="rounded-xl border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium sm:px-5">Parcours, délais et résultats détaillés</summary>
        <div className="space-y-6 border-t border-border p-4 sm:p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div><p className="text-xs text-muted-foreground">Montant médian des devis</p><p className="montant mt-2 text-2xl font-medium">{formatEuros(stats.panier_median)}</p><p className="mt-1 text-xs text-muted-foreground">Moyenne : {formatEuros(stats.panier_moyen)}</p></div>
            <div><p className="text-xs text-muted-foreground">Chantiers perdus</p><p className="montant mt-2 text-2xl font-medium">{stats.perdus}</p><p className="mt-1 text-xs text-muted-foreground">{formatEuros(stats.montant_perdu)} de devis chiffrés</p></div>
          </div>
          {stats.funnel && (
            <div className="border-t border-border pt-5">
              <h3 className="text-sm font-medium">Parcours des {stats.leads_recus} chantiers reçus</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Chaque étape compte les chantiers qui l’ont atteinte, y compris ceux perdus ensuite. Le détail distingue les dossiers en cours, gagnés et perdus.</p>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <CranFunnel label="Client contacté" cran={stats.funnel.contacte} total={stats.leads_recus} taux={stats.taux_contact} />
                <CranFunnel label="Rendez-vous pris" cran={stats.funnel.rdv_pris} total={stats.leads_recus} taux={stats.taux_rdv} />
                <CranFunnel label="Devis envoyé" cran={stats.funnel.devis_envoye} total={stats.leads_recus} taux={stats.taux_devis} />
                <CranFunnel label="Devis signé" cran={stats.funnel.devis_signe} total={stats.leads_recus} taux={stats.taux_signature} />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Taux : contact sur les chantiers reçus ; rendez-vous sur les clients contactés ; devis sur les rendez-vous pris ; signature sur les devis dont l’issue est connue.</p>
              {(stats.delai_contact_j != null || stats.delai_devis_j != null || stats.delai_signature_j != null) && (
                <div className="mt-5 border-t border-border pt-5">
                  <h3 className="mb-3 text-sm font-medium">Délais médians</h3>
                  <dl className="grid gap-4 sm:grid-cols-3">
                    {stats.delai_contact_j != null && <div><dt className="text-xs text-muted-foreground">Réception → contact</dt><dd className="mt-1 text-sm tabular-nums">{stats.delai_contact_j} j <span className="text-xs text-muted-foreground">({stats.delai_contact_n} observations)</span></dd></div>}
                    {stats.delai_devis_j != null && <div><dt className="text-xs text-muted-foreground">Réception → devis</dt><dd className="mt-1 text-sm tabular-nums">{stats.delai_devis_j} j <span className="text-xs text-muted-foreground">({stats.delai_devis_n} observations)</span></dd></div>}
                    {stats.delai_signature_j != null && <div><dt className="text-xs text-muted-foreground">Devis → signature</dt><dd className="mt-1 text-sm tabular-nums">{stats.delai_signature_j} j <span className="text-xs text-muted-foreground">({stats.delai_signature_n} observations)</span></dd></div>}
                  </dl>
                </div>
              )}
              {stats.delai_signature_j == null && stats.funnel.devis_signe.atteint > 0 && <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Délai de signature non calculable : pas assez de chantiers où le devis a été déposé avant d’être marqué signé.</p>}
            </div>
          )}
          {(stats.montant_perdu > 0 || stats.taux_refus_avant_devis != null) && <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">{stats.perdus} chantier{stats.perdus > 1 ? 's' : ''} perdu{stats.perdus > 1 ? 's' : ''}, représentant <span className="font-medium tabular-nums text-foreground">{formatEuros(stats.montant_perdu)}</span> de devis chiffrés.{stats.taux_refus_avant_devis != null && <> {stats.taux_refus_avant_devis} % des chantiers reçus ont été refusés avant chiffrage.</>}</p>}
        </div>
      </details>
    </section>
  )
}
