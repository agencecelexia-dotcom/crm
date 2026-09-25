import { Check, Loader2, MapPin } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { Batiment } from './bati-ign'
import type { MaisonChantier } from './use-batiment-chantier'

/**
 * Ce qu'on sait de la maison sélectionnée, en une ligne — ou une question.
 *
 * - Reliée officiellement à l'adresse, ou déjà confirmée : un simple repère.
 * - Retrouvée avec un doute (autre commune, autre numéro, pas de lien
 *   officiel) : les chiffres restent affichés, et l'écran demande « C'est bien
 *   la maison ? ». Un « Oui » la retient pour l'agence et pour la suite.
 * - Introuvable : ce qu'il faut faire.
 */
export function BandeauMaison({
  maison,
  choisi,
  retenue,
  cherchee,
  enCours,
  onOui,
  onAutre,
}: {
  maison: MaisonChantier | null
  choisi: Batiment | null
  /** La maison vient d'une adresse cherchée à la main, pas de celle du dossier. */
  cherchee: boolean
  /** La maison confirmée pendant cette visite. */
  retenue: string | null
  enCours: boolean
  onOui: () => void
  onAutre: () => void
}) {
  if (!maison) return null
  const cible = maison.principal?.cleabs ?? null
  const surLaCible = !!choisi?.cleabs && choisi.cleabs === cible

  if (choisi?.cleabs && (choisi.cleabs === retenue || (surLaCible && maison.confiance === 'confirmee'))) {
    return <Repere texte="Maison confirmée" />
  }
  if (surLaCible && maison.confiance === 'officielle') {
    return <Repere texte={cherchee ? 'Maison reliée à l’adresse cherchée' : 'Maison reliée à l’adresse du chantier'} />
  }
  if (surLaCible && maison.confiance === 'a_confirmer') {
    return (
      <div className="space-y-2 rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/5 p-2.5">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-[#B45309]" />
          <div className="min-w-0 text-xs text-[#92400E]">
            <p className="text-sm font-semibold text-[#B45309]">C’est bien la maison ?</p>
            <p>{pourquoi(maison)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button className="min-h-11" disabled={enCours} onClick={onOui}>
            {enCours ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Oui, c’est elle
          </Button>
          <Button variant="outline" className="min-h-11" onClick={onAutre}>
            Choisir une autre
          </Button>
        </div>
      </div>
    )
  }
  if (!choisi && maison.message) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-2.5">
        <MapPin className="mt-0.5 size-4 shrink-0 text-[#B45309]" />
        <p className="text-xs text-[#B45309]">{maison.message}</p>
      </div>
    )
  }
  return null
}

/** La raison du doute, dite avec les mots du dossier. */
function pourquoi(m: MaisonChantier): string {
  const adresse = m.adresse_retrouvee ?? 'l’adresse du chantier'
  if (m.commune_differente && m.commune_saisie) return `Adresse retrouvée : ${adresse} (noté : ${m.commune_saisie}).`
  if (m.numero_saisi) return `Adresse retrouvée : ${adresse} (noté : n° ${m.numero_saisi}).`
  if (m.methode === 'proximite') return `C’est la maison la plus proche de ${adresse}.`
  if (m.methode === 'contenant') return `C’est le bâtiment situé au point de ${adresse}.`
  return `Adresse retrouvée : ${adresse}.`
}

function Repere({ texte }: { texte: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium text-[#16A34A]">
      <Check className="size-3.5 shrink-0" />
      {texte}
    </p>
  )
}
