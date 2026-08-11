import { Phone, Mail, HelpCircle } from 'lucide-react'

import { TEL_APPORTEUR } from '@/lib/constants'
import { formatTel } from '@/lib/format'

/**
 * Pied de page du portail artisan.
 *
 * L'audit relevait son absence totale : aucun contact Celexia, aucune aide,
 * aucun rappel du fonctionnement. Un artisan bloqué sur un chantier n'avait
 * aucun moyen de joindre l'agence depuis l'outil.
 */
export function PiedDePageArtisan() {
  return (
    <footer className="mt-12 border-t border-border pt-6 text-sm">
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <p className="mb-2 font-medium">Une question sur un chantier ?</p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`tel:${TEL_APPORTEUR}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Phone className="size-4 text-primary" />
              {formatTel(TEL_APPORTEUR)}
            </a>
            <a
              href="mailto:agence.celexia@gmail.com"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Mail className="size-4 text-primary" />
              agence.celexia@gmail.com
            </a>
          </div>
        </div>

        <details className="rounded-xl border border-border bg-card/50 p-3">
          <summary className="cursor-pointer font-medium">
            <HelpCircle className="mr-1.5 inline size-4 text-primary" />
            Comment ça marche ?
          </summary>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted-foreground">
            <li>Celexia vous transmet un chantier : vous recevez un lien.</li>
            <li>
              Vous appelez le client, puis vous avancez l'étape dans votre espace après
              chaque action.
            </li>
            <li>Vous déposez votre devis, puis le devis signé par le client.</li>
            <li>
              À la signature, une commission est due à Celexia sur le montant du devis,
              au taux prévu dans votre contrat d'engagement.
            </li>
          </ol>
          <p className="mt-3 text-muted-foreground">
            Tenez les étapes à jour : c'est ce qui nous évite de vous relancer, et ce qui
            nous permet de vous envoyer des chantiers mieux ciblés.
          </p>
        </details>

        <p className="text-xs text-muted-foreground">
          Celexia — mise en relation client ↔ artisan. Vos coordonnées et celles de vos
          clients ne sont utilisées que pour le suivi de vos chantiers.
        </p>
      </div>
    </footer>
  )
}
