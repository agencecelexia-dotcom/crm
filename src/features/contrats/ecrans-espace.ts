import { Building2, FileText, HardHat, LifeBuoy, Wallet } from 'lucide-react'

/**
 * Les cinq écrans de l'espace artisan.
 *
 * Tout tenait auparavant sur une seule page : contrat, tableau de bord,
 * identité, assurances, devis, chantiers, relevé de commissions et mentions.
 * Il fallait faire défiler seize cents pixels pour atteindre ses devis.
 */
export type VueEspace = 'chantiers' | 'devis' | 'commissions' | 'entreprise' | 'aide'

export const ECRANS: {
  cle: VueEspace
  titre: string
  detail: string
  Icone: typeof HardHat
}[] = [
  {
    cle: 'chantiers',
    titre: 'Mes chantiers',
    detail: 'Les affaires en cours et leur suivi',
    Icone: HardHat,
  },
  {
    cle: 'devis',
    titre: 'Mes devis',
    detail: 'Créer, retrouver et envoyer un devis',
    Icone: FileText,
  },
  {
    cle: 'commissions',
    titre: 'Commissions',
    detail: 'Le détail de ce qui est dû',
    Icone: Wallet,
  },
  {
    cle: 'entreprise',
    titre: 'Mon entreprise',
    detail: 'Contrat, identité, assurances',
    Icone: Building2,
  },
  { cle: 'aide', titre: 'Aide et contact', detail: 'Nous joindre', Icone: LifeBuoy },
]

