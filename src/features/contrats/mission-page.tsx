import { Link2Off } from 'lucide-react'

import { BrandLogo } from '@/components/brand-logo'

/**
 * Les anciens liens « /mission/<jeton de projet> ».
 *
 * CE QU'ILS FAISAIENT, ET POURQUOI ILS NE LE FONT PLUS
 *
 * Ils redirigeaient vers l'espace de l'artisan TITULAIRE ACTUEL du chantier,
 * en renvoyant son jeton maître. Or un tel lien est attaché au chantier, pas à
 * l'artisan : quand le chantier passait d'un artisan A à un artisan B, le lien
 * que A avait reçu ouvrait désormais TOUT l'espace de B — ses chantiers, les
 * coordonnées de ses clients, ses devis. La fonction renvoyait aussi l'identité
 * du client sans condition de signature, et les échanges de tous les artisans
 * du chantier. (Prouvé par l'audit sécurité : 37 chantiers ont eu plusieurs
 * artisans.)
 *
 * Un jeton de chantier ne peut pas dire QUI clique : aucune redirection n'est
 * sûre. La fonction ne renvoie plus rien (migration 0157), et la page explique
 * où trouver le bon lien. Plus aucun écran n'émet ces liens depuis que l'espace
 * artisan unique les a remplacés.
 */
export function MissionPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-secondary px-6 text-center">
      <BrandLogo className="h-9" />
      <Link2Off className="size-8 text-muted-foreground" />
      <div className="max-w-sm space-y-2">
        <p className="text-lg font-semibold">Ce lien a été remplacé</p>
        <p className="text-sm text-muted-foreground">
          Vos chantiers sont désormais tous réunis dans votre espace artisan personnel. Ouvrez
          le lien que Celexia vous a envoyé pour y accéder. Si vous ne le retrouvez pas,
          contactez Celexia : nous vous le renverrons.
        </p>
      </div>
    </div>
  )
}
