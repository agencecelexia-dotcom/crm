import {
  Home, Map, FolderKanban, Users, StickyNote, PenTool, Zap,
  BadgeEuro, ListChecks, Target, UserCog, RotateCcw, Briefcase,
  Compass, Image, Box, Ruler, PhoneCall, type LucideIcon,
} from 'lucide-react'

export type NavigationItem = {
  to: string
  label: string
  icon: LucideIcon
  fondateurSeul?: boolean
  commercialSeul?: boolean
  creationLeadRequise?: boolean
  /** Routes voisines qui possèdent leur propre entrée. */
  exclure?: string[]
}

const GROUPES: { titre: string; items: NavigationItem[] }[] = [
  {
    titre: 'Pilotage',
    items: [
      { to: '/', label: 'Tableau de bord', icon: Home },
      { to: '/taches', label: 'À faire', icon: ListChecks, fondateurSeul: true },
      { to: '/commissions', label: 'Commissions', icon: BadgeEuro, fondateurSeul: true },
      { to: '/reprises', label: 'Suivi des reprises', icon: RotateCcw, fondateurSeul: true },
    ],
  },
  {
    titre: 'Activité',
    items: [
      { to: '/projets', label: 'Projets', icon: FolderKanban, exclure: ['/projets/a-reattribuer'] },
      { to: '/projets/a-reattribuer', label: 'À réattribuer', icon: RotateCcw },
      { to: '/mon-pipe', label: 'Mes reprises', icon: Briefcase, commercialSeul: true },
      { to: '/artisans', label: 'Artisans', icon: Users },
      { to: '/appel', label: 'Prise d’appel', icon: PhoneCall, creationLeadRequise: true },
      { to: '/carte', label: 'Carte', icon: Map },
      { to: '/couverture', label: 'Prospection locale', icon: Target, fondateurSeul: true },
    ],
  },
  {
    titre: 'Outils',
    items: [
      { to: '/maison-3d', label: 'Maison 3D', icon: Box },
      { to: '/metres-a-verifier', label: 'Métrés à vérifier', icon: Ruler },
      { to: '/notes', label: 'Notes', icon: StickyNote, fondateurSeul: true },
      { to: '/creatives', label: 'Visuels publicitaires', icon: Image, fondateurSeul: true },
      { to: '/business-plan', label: 'Business plan', icon: Compass, fondateurSeul: true },
    ],
  },
  {
    titre: 'Administration',
    items: [
      { to: '/equipe', label: 'Équipe', icon: UserCog, fondateurSeul: true },
      { to: '/parametres/automatisations', label: 'Automatisations', icon: Zap, fondateurSeul: true },
      { to: '/parametres/signature', label: 'Ma signature', icon: PenTool },
    ],
  },
]

/** Même visibilité sur ordinateur et mobile. Les droits restent appliqués en base. */
export function navigationPourRole(estFondateur: boolean, peutCreerLead: boolean) {
  return GROUPES.map((groupe) => ({
    ...groupe,
    items: groupe.items.filter((item) =>
      (estFondateur ? !item.commercialSeul : !item.fondateurSeul)
      && (!item.creationLeadRequise || peutCreerLead)),
  })).filter((groupe) => groupe.items.length > 0)
}

export function navigationActive(item: NavigationItem, pathname: string) {
  if (item.to === '/') return pathname === '/'
  if (item.exclure?.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return false
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}
