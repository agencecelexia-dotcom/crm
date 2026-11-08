import { useEffect } from 'react'
import {
  Phone,
  Calendar,
  FileText,
  CheckCircle2,
  Hourglass,
  XCircle,
  LogOut,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatDateHeure } from '@/lib/format'
import { supabase } from '@/lib/supabase/client'

export interface SuiviFil {
  id?: string
  auteur: 'artisan' | 'agence' | string
  type: string
  statut: string | null
  message: string | null
  created_at: string
  lu_at?: string | null
}

/**
 * Icônes du fil.
 *
 * Remplace les emojis codés en dur (🛠 📞 🗓 📄 ✅ ⏳ 🎉) qui donnaient un
 * aspect prototype et coexistaient mal avec les icônes vectorielles du reste
 * de l'interface (audit §9).
 */
const ICONE_STATUT: Record<string, LucideIcon> = {
  contacte: Phone,
  rdv_pris: Calendar,
  en_attente: Hourglass,
  devis_envoye: FileText,
  devis_signe: CheckCircle2,
  termine: CheckCircle2,
  perdu: XCircle,
}

const ICONE_TYPE: Record<string, LucideIcon> = {
  appel: Phone,
  retrait: LogOut,
  consigne: AlertTriangle,
  note: MessageSquare,
}

function iconeDe(s: SuiviFil): LucideIcon {
  if (s.statut && ICONE_STATUT[s.statut]) return ICONE_STATUT[s.statut]
  return ICONE_TYPE[s.type] ?? MessageSquare
}

/**
 * Fil de discussion d'un chantier, partagé entre l'agence et l'artisan.
 *
 * Avant, tous les événements étaient attribués à « Artisan » et l'agence ne
 * pouvait pas répondre : la boucle « tenez-nous informés » était à sens unique
 * (audit §5). Les messages de l'agence sont désormais visuellement distincts,
 * et une consigne prioritaire est mise en avant.
 *
 * L'accusé de lecture part à l'ouverture, une seule fois par montage.
 */
export function FilDiscussion({
  suivis,
  token,
  onLu,
}: {
  suivis: SuiviFil[]
  /** Token d'affectation — déclenche l'accusé de lecture s'il est fourni. */
  token?: string
  onLu?: () => void
}) {
  const nonLus = suivis.filter((s) => s.auteur === 'agence' && !s.lu_at).length

  useEffect(() => {
    if (!token || nonLus === 0) return
    let annule = false
    void (async () => {
      const { error } = await supabase.rpc('marquer_lu_by_token', { p_token: token })
      if (!annule && !error) onLu?.()
    })()
    return () => {
      annule = true
    }
    // Volontairement sur le token seul : l'accusé ne doit partir qu'une fois
    // par chantier consulté, pas à chaque re-rendu du fil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (suivis.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Aucun échange pour l'instant.
      </p>
    )
  }

  return (
    <ol className="space-y-3">
      {suivis.map((s, i) => {
        const Icone = iconeDe(s)
        const estAgence = s.auteur === 'agence'
        const consigne = s.type === 'consigne'

        return (
          <li
            key={s.id ?? `${s.created_at}-${i}`}
            className={cn(
              'flex gap-3 rounded-lg border p-3',
              consigne
                ? 'border-amber-200 bg-amber-50/50'
                : estAgence
                  ? 'border-border bg-muted/30'
                  : 'border-border bg-card',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md',
                consigne
                  ? 'text-amber-700'
                  : estAgence
                    ? 'text-foreground'
                    : 'text-muted-foreground',
              )}
            >
              <Icone className="size-4" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="flex items-center gap-1 text-sm font-semibold">
                  {estAgence ? 'Celexia' : 'Vous'}
                </span>
                {consigne && (
                  <span className="text-xs font-medium text-amber-700">
                    À traiter
                  </span>
                )}
                <time
                  dateTime={s.created_at}
                  className="w-full text-xs tabular-nums text-muted-foreground sm:w-auto"
                >
                  {formatDateHeure(s.created_at)}
                </time>
              </p>

              {s.message && (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{s.message}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
