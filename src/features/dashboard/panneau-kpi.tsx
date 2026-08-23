import { useState } from 'react'
import { Clock, Euro, Target, TrendingUp, Users } from 'lucide-react'

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format'
import { useKpiAgence, useKpiParArtisan } from './use-kpi'

/** Périodes proposées. « Tout » sert de référence, les autres de tendance. */
const PERIODES = [
  { cle: 'tout', label: 'Tout' },
  { cle: '90', label: '90 jours' },
  { cle: '30', label: '30 jours' },
] as const

function debutDe(cle: string): string | undefined {
  if (cle === 'tout') return undefined
  const d = new Date()
  d.setDate(d.getDate() - Number(cle))
  return d.toISOString().slice(0, 10)
}

/**
 * Indicateurs de l'agence.
 *
 * Tout vient de `kpi_agence()` — une seule source, donc plus de compteurs qui
 * se contredisent sur le même écran. Chaque taux affiche son dénominateur en
 * sous-titre : « sur les devis envoyés » et « sur tout ce qui est transmis »
 * ne donnent pas le même chiffre, et c'est normal.
 */
export function PanneauKpi() {
  const [periode, setPeriode] = useState<string>('tout')
  const { data, isLoading, isError, refetch } = useKpiAgence(debutDe(periode))
  const { data: parArtisan } = useKpiParArtisan(debutDe(periode))

  if (isLoading) return <Skeleton className="mb-4 h-96 w-full rounded-2xl" />
  if (isError || !data) {
    return (
      <Card className="mb-4 rounded-2xl border-destructive/30 bg-destructive/5">
        <CardContent className="py-4 text-sm">
          <p className="font-medium">Impossible de charger les indicateurs.</p>
          <button onClick={() => void refetch()} className="mt-1 text-xs underline">
            Réessayer
          </button>
        </CardContent>
      </Card>
    )
  }

  // Un délai calculé sur trop peu de dossiers n'a pas de sens : on le dit
  // plutôt que d'afficher un chiffre qui semble solide.
  const delaiFiable = data.delai_signature_n >= 5

  return (
    <div className="mb-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitre>
          <Target className="mr-1.5 inline size-4 text-primary" />
          Indicateurs
        </CardTitre>
        <div className="flex gap-1 rounded-full bg-muted p-1">
          {PERIODES.map((p) => (
            <button
              key={p.cle}
              type="button"
              onClick={() => setPeriode(p.cle)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                periode === p.cle
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Le parcours d'un lead, de gauche à droite ---- */}
      <Card className="rounded-2xl border-border/70 shadow-card">
        <CardHeader className="pb-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Parcours des {data.leads_transmis} chantiers transmis
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Cran label="Transmis" valeur={data.leads_transmis} />
            <Cran label="Ouverts" valeur={data.contactes} taux={data.taux_ouverture_sur_transmis} />
            <Cran label="RDV pris" valeur={data.rdv_pris} />
            <Cran label="Devis envoyés" valeur={data.devis_envoyes} taux={data.taux_devis_sur_transmis} />
            <Cran label="Signés" valeur={data.signes} ton="bon" />
            <Cran label="Perdus" valeur={data.perdus} ton="mauvais" />
          </div>

          {data.jamais_ouverts > 0 && (
            <p className="mt-3 rounded-lg bg-[#F59E0B]/10 p-2.5 text-xs text-[#92400E]">
              <strong className="tabular-nums">{data.jamais_ouverts}</strong> chantiers n'ont
              jamais été ouverts par l'artisan à qui ils ont été confiés.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- Deux taux, deux dénominateurs ---- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Tuile
          icon={TrendingUp}
          label="Taux de signature"
          valeur={data.taux_signature_sur_devis != null ? `${data.taux_signature_sur_devis} %` : '—'}
          detail="sur les chantiers arrivés au devis"
          ton="bon"
        />
        <Tuile
          icon={Target}
          label="Conversion globale"
          valeur={data.taux_conversion_global != null ? `${data.taux_conversion_global} %` : '—'}
          detail="sur tout ce qui a été transmis, rendus compris"
        />
      </div>

      {/* ---- Délais ---- */}
      <Card className="rounded-2xl border-border/70 shadow-card">
        <CardHeader className="pb-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Clock className="size-3.5" />
            Délais médians
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <Cran label="→ 1er contact" valeur={data.delai_ouverture_j ?? '—'} unite="j" />
            <Cran
              label="→ signature"
              valeur={delaiFiable ? (data.delai_signature_j ?? '—') : '—'}
              unite="j"
              ton="bon"
            />
            <Cran label="devis → signature" valeur={data.delai_devis_signe_j ?? '—'} unite="j" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {delaiFiable
              ? `Mesuré sur ${data.delai_signature_n} chantiers signés, depuis l'envoi à l'artisan.`
              : `Pas encore assez de signatures pour un délai fiable (${data.delai_signature_n} observations, 5 minimum).`}
          </p>
        </CardContent>
      </Card>

      {/* ---- Argent ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tuile icon={Euro} label="CA signé" valeur={formatEuros(data.ca_signe)}
               detail={`${data.signes} chantiers`} ton="bon" />
        <Tuile icon={TrendingUp} label="Panier médian"
               valeur={data.panier_median != null ? formatEuros(data.panier_median) : '—'}
               detail={data.panier_moyen != null ? `moyenne ${formatEuros(data.panier_moyen)}` : ''} />
        <Tuile icon={Euro} label="Devis moyen envoyé"
               valeur={data.devis_moyen_envoye != null ? formatEuros(data.devis_moyen_envoye) : '—'}
               detail={data.devis_median_envoye != null ? `médiane ${formatEuros(data.devis_median_envoye)}` : ''} />
        <Tuile icon={Euro} label="Commission à encaisser"
               valeur={formatEuros(data.commission_a_encaisser)}
               detail={`${formatEuros(data.commission_encaissee)} déjà encaissés`}
               ton={data.commission_a_encaisser > 0 ? 'attention' : 'defaut'} />
      </div>

      {/* ---- Comparaison des artisans ---- */}
      {parArtisan && parArtisan.length > 0 && (
        <Card className="rounded-2xl border-border/70 shadow-card">
          <CardHeader className="pb-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="size-3.5" />
              Par artisan
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-1.5 font-medium">Artisan</th>
                    <th className="pb-1.5 text-right font-medium">Reçus</th>
                    <th className="pb-1.5 text-right font-medium">Devis</th>
                    <th className="pb-1.5 text-right font-medium">Signés</th>
                    <th className="pb-1.5 text-right font-medium">Conv.</th>
                    <th className="pb-1.5 text-right font-medium">Délai</th>
                    <th className="pb-1.5 text-right font-medium">CA</th>
                  </tr>
                </thead>
                <tbody>
                  {parArtisan
                    .filter((a) => a.leads_transmis >= 3)
                    .slice(0, 10)
                    .map((a) => (
                      <tr key={a.artisan_id} className="border-b border-border/50 last:border-0">
                        <td className="py-1.5 pr-2">{a.artisan_nom}</td>
                        <td className="py-1.5 text-right tabular-nums">{a.leads_transmis}</td>
                        <td className="py-1.5 text-right tabular-nums">{a.devis_envoyes}</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">{a.signes}</td>
                        <td className={cn('py-1.5 text-right tabular-nums',
                          a.taux_conversion_global != null && a.taux_conversion_global >= 20 && 'text-[#16A34A]')}>
                          {a.taux_conversion_global != null ? `${a.taux_conversion_global} %` : '—'}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {a.delai_signature_j != null ? `${a.delai_signature_j} j` : '—'}
                        </td>
                        <td className="montant py-1.5 text-right tabular-nums">
                          {a.ca_signe > 0 ? formatEuros(a.ca_signe) : '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Artisans ayant reçu au moins 3 chantiers. « Conv. » porte sur tout ce qui leur a
              été transmis, chantiers rendus compris.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Cran({
  label,
  valeur,
  taux,
  unite,
  ton = 'defaut',
}: {
  label: string
  valeur: number | string
  taux?: number | null
  unite?: string
  ton?: 'defaut' | 'bon' | 'mauvais'
}) {
  return (
    <div>
      <p className="font-mono text-xl font-semibold tabular-nums">
        <span
          className={cn(
            ton === 'bon' && 'text-[#16A34A]',
            ton === 'mauvais' && 'text-[#DC2626]',
          )}
        >
          {valeur}
        </span>
        {unite && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{unite}</span>}
        {taux != null && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{taux} %</span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function Tuile({
  icon: Icon,
  label,
  valeur,
  detail,
  ton = 'defaut',
}: {
  icon: typeof Euro
  label: string
  valeur: string
  detail?: string
  ton?: 'defaut' | 'bon' | 'attention'
}) {
  return (
    <Card
      className={cn(
        'rounded-2xl border-border/70 p-4 shadow-card',
        ton === 'bon' && 'border-[#22C55E]/25 bg-[#22C55E]/5',
        ton === 'attention' && 'border-[#F59E0B]/25 bg-[#F59E0B]/5',
      )}
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </p>
      <p className="montant mt-1 text-xl font-semibold tabular-nums">{valeur}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </Card>
  )
}
