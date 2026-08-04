import { Link, useLocation } from 'react-router-dom'
import { Compass, LinkIcon, Phone } from 'lucide-react'

import { BrandLogo } from '@/components/brand-logo'
import { Button } from '@/components/ui/button'
import { TEL_APPORTEUR } from '@/lib/constants'

/** Préfixes des liens envoyés aux artisans par email / WhatsApp. */
const PREFIXES_ARTISAN = ['/artisan/', '/mission/', '/signer/']

/**
 * Page 404.
 *
 * Avant, `App.tsx` renvoyait toute URL inconnue vers `/` — donc vers `/login`
 * pour un visiteur non authentifié. Un artisan dont le client de messagerie
 * avait tronqué un lien à token (32 caractères) atterrissait sur un écran de
 * connexion qu'il ne pouvait pas franchir, sans la moindre explication.
 * On distingue donc les deux publics.
 */
export function PageIntrouvable() {
  const { pathname } = useLocation()
  const lienArtisanTronque = PREFIXES_ARTISAN.some((p) => pathname.startsWith(p))

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 py-12 text-center">
      <BrandLogo className="h-9 mix-blend-multiply" />

      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        {lienArtisanTronque ? <LinkIcon className="size-6" /> : <Compass className="size-6" />}
      </span>

      {lienArtisanTronque ? (
        <>
          <div className="max-w-sm">
            <p className="font-display text-lg tracking-tight">Ce lien semble incomplet</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Il a peut-être été coupé par votre messagerie. Ouvrez-le depuis le message
              d'origine, ou contactez Celexia et nous vous le renverrons.
            </p>
          </div>
          <Button asChild variant="outline">
            <a href={`tel:${TEL_APPORTEUR}`}>
              <Phone className="size-4" />
              Appeler Celexia
            </a>
          </Button>
        </>
      ) : (
        <>
          <div className="max-w-sm">
            <p className="font-display text-lg tracking-tight">Cette page n'existe pas</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              L'adresse <span className="font-mono text-xs">{pathname}</span> ne correspond à
              aucune page.
            </p>
          </div>
          <Button asChild>
            <Link to="/">Retour à l'accueil</Link>
          </Button>
        </>
      )}
    </div>
  )
}
