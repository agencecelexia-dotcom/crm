import { Loader2, ScanSearch } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { LIBELLES_TOIT, materiauDeBdnb } from './materiaux'
import { MESSAGES_PHOTO, useLireToit, useMateriauxToit } from './use-photos-facade'

/**
 * La couverture du toit : lue par Claude sur la photo aérienne de l'IGN (par
 * la pré-mesure, ou d'un appui ici), sinon déclarée à la BDNB — chacune dite
 * pour ce qu'elle est.
 */
export function MateriauToit({ token, cleabs, bdnb }: { token: string; cleabs: string | null; bdnb: string | null | undefined }) {
  const { data: m, isLoading } = useMateriauxToit(token, cleabs, true)
  const lire = useLireToit(token, cleabs)
  const t = m?.toit?.meme_batiment ? m.toit : null
  const declare = materiauDeBdnb(bdnb)

  if (isLoading) return null
  return (
    <div className="space-y-1.5 rounded-xl border border-border p-2.5 text-xs">
      {t && t.materiau !== 'indetermine' ? (
        <p>
          Couverture&nbsp;: <strong className="text-foreground">{LIBELLES_TOIT[t.materiau]}</strong> ({t.couleur})
          <span className="text-muted-foreground">
            {' '}— lue sur la photo aérienne de l’IGN à {m!.resolution_cm} cm
            {t.confiance !== 'haute' ? `, confiance ${t.confiance}` : ''}.
          </span>
        </p>
      ) : t ? (
        <p className="text-muted-foreground">La photo aérienne ne permet pas de dire le matériau du toit.</p>
      ) : declare ? (
        <p>
          Couverture&nbsp;: <strong className="text-foreground">{LIBELLES_TOIT[declare]}</strong>
          <span className="text-muted-foreground"> — déclarée à la BDNB, pas vue.</span>
        </p>
      ) : null}
      {t && (t.fenetres_toit != null || t.cheminees != null) && (
        <p className="text-muted-foreground">
          {t.fenetres_toit != null && `${t.fenetres_toit} fenêtre${t.fenetres_toit > 1 ? 's' : ''} de toit`}
          {t.fenetres_toit != null && t.cheminees != null && ' · '}
          {t.cheminees != null && `${t.cheminees} cheminée${t.cheminees > 1 ? 's' : ''}`}, comptées sur la photo à 5 cm.
        </p>
      )}
      {t?.panneaux_solaires && <p className="text-muted-foreground">Peut-être des panneaux solaires sur le toit : à vérifier.</p>}
      {t?.remarque && t.confiance !== 'haute' && <p className="text-muted-foreground">{t.remarque}</p>}
      {!t && (
        <Button size="sm" variant="outline" className="min-h-9" disabled={lire.isPending || !cleabs} onClick={() => lire.mutate()}>
          {lire.isPending ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
          {lire.isPending ? 'Lecture de la photo aérienne…' : 'Lire le matériau du toit'}
        </Button>
      )}
      {lire.error && (
        <p className="text-[#B45309]">
          {MESSAGES_PHOTO[lire.error instanceof Error ? lire.error.message : ''] ?? 'La lecture a échoué : réessayez.'}
        </p>
      )}
    </div>
  )
}
