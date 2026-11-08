import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { formatEuros } from '@/lib/format'

export interface PointMois {
  label: string
  ca: number
  commission: number
}

/** Chargé à la demande pour garder recharts hors du démarrage des autres pages. */
export function GraphiqueCa({ data }: { data: PointMois[] }) {
  return (
    <figure aria-label="Évolution du chiffre d’affaires signé et des commissions sur les six derniers mois">
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-2"><span className="h-0.5 w-5 bg-primary" />CA signé</span>
        <span className="flex items-center gap-2"><span className="h-0.5 w-5 bg-[#71717a]" />Commission acquise</span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickMargin={12} minTickGap={12} />
          <YAxis tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} width={48} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v / 1000)} k€` : `${v} €`} />
          <Tooltip formatter={(value) => formatEuros(Number(value))} contentStyle={{ borderRadius: 8, borderColor: 'var(--border)', fontSize: 12 }} />
          <Line type="monotone" dataKey="ca" name="CA signé" stroke="var(--primary)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="commission" name="Commission acquise" stroke="#71717a" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Afficher les valeurs du graphique</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Chiffre d’affaires et commissions par mois de signature</caption>
            <thead><tr className="border-b border-border text-xs text-muted-foreground"><th scope="col" className="py-2 text-left font-medium">Mois</th><th scope="col" className="py-2 text-right font-medium">CA signé</th><th scope="col" className="py-2 text-right font-medium">Commission</th></tr></thead>
            <tbody>{data.map((m) => <tr key={m.label} className="border-b border-border last:border-0"><th scope="row" className="py-2 text-left font-normal">{m.label}</th><td className="py-2 text-right tabular-nums">{formatEuros(m.ca)}</td><td className="py-2 text-right tabular-nums">{formatEuros(m.commission)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
