import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatEuros } from '@/lib/format'

/**
 * Les deux graphiques du tableau de bord, isolés dans leur propre fichier.
 *
 * `recharts` pèse 361 kB. Importé depuis `dashboard-page.tsx`, il était chargé
 * au démarrage du CRM pour tout le monde — y compris pour un commercial qui ne
 * voit jamais ces graphiques. Isolé ici, il n'est téléchargé qu'au moment où
 * ces blocs s'affichent réellement.
 */

export interface PointStatut {
  statut: string
  label: string
  count: number
  color: string
}

export function GraphiqueStatuts({ data }: { data: PointStatut[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ left: -20 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10 }}
          interval={0}
          angle={-15}
          textAnchor="end"
          height={50}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip cursor={{ fill: 'transparent' }} />
        <Bar dataKey="count" name="Projets" radius={[4, 4, 0, 0]}>
          {data.map((s) => (
            <Cell key={s.statut} fill={s.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export interface PointMois {
  label: string
  ca: number
  commission: number
}

export function GraphiqueCa({ data }: { data: PointMois[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          width={44}
          tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : `${v}`)}
        />
        <Tooltip formatter={(value) => formatEuros(Number(value))} />
        <Line type="monotone" dataKey="ca" name="CA" stroke="#7C3AED" strokeWidth={2} dot={false} />
        <Line
          type="monotone"
          dataKey="commission"
          name="Commission"
          stroke="#22C55E"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
