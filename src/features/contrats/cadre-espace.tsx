import type { ReactNode } from 'react'
import { ChevronRight, Check, Lock, LifeBuoy } from 'lucide-react'

import { BrandLogo } from '@/components/brand-logo'
import { cn } from '@/lib/utils'
import { ECRANS, type VueEspace } from './ecrans-espace'
import { MenuEspace } from './menu-espace'

export function CadreEspace({ vue, onAller, nom, societe, signe, nbChantiers, children }: {
  vue: VueEspace
  onAller: (vue: VueEspace) => void
  nom: string
  societe: string | null
  signe: boolean
  nbChantiers: number
  children: ReactNode
}) {
  const courant = ECRANS.find((e) => e.cle === vue) ?? ECRANS[0]
  const principaux = ECRANS.filter((e) => ['chantiers', 'devis', 'entreprise'].includes(e.cle))
  const titresRapides = { chantiers: 'Chantiers', devis: 'Devis', entreprise: 'Entreprise' }

  return (
    <div className="min-h-dvh bg-background">
      <a href="#espace-contenu" className="sr-only fixed left-4 top-4 z-[100] rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground focus:not-sr-only">Aller au contenu</a>
      <aside className="crm-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 flex-col md:flex">
        <div className="px-6 pb-8 pt-7">
          <button type="button" onClick={() => onAller('chantiers')} aria-label="Celexia — mes chantiers" className="rounded-md"><BrandLogo sombre className="h-7" /></button>
          <p className="mt-3 text-xs text-[#a5a5af]">Votre espace artisan</p>
        </div>
        <nav aria-label="Navigation de l’espace artisan" className="min-h-0 flex-1 overflow-y-auto px-3">
          <p className="mb-2 px-3 text-[11px] font-medium text-[#a5a5af]">Votre activité</p>
          <ul className="space-y-1">
            {ECRANS.filter((e) => e.cle !== 'aide').map(({ cle, titre, Icone }) => (
              <li key={cle}><button type="button" aria-current={cle === vue ? 'page' : undefined} onClick={() => onAller(cle)} className={cn('flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] transition-colors', cle === vue ? 'bg-white/9 font-medium text-white ring-1 ring-inset ring-white/8' : 'text-[#b9b9c3] hover:bg-white/5 hover:text-white')}>
                <Icone className={cn('size-4 shrink-0', cle === vue && 'text-[#b6a1f0]')} strokeWidth={1.5} aria-hidden />
                <span className="flex-1">{titre}</span>
                {cle === 'chantiers' && <span className="text-xs tabular-nums text-[#a5a5af]">{nbChantiers}</span>}
              </button></li>
            ))}
          </ul>
          <div className="mt-7 border-t border-white/10 pt-4">
            <button type="button" aria-current={vue === 'aide' ? 'page' : undefined} onClick={() => onAller('aide')} className={cn('flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] transition-colors', vue === 'aide' ? 'bg-white/9 text-white' : 'text-[#b9b9c3] hover:bg-white/5 hover:text-white')}><LifeBuoy className="size-4" strokeWidth={1.5} aria-hidden />Aide et contact</button>
          </div>
        </nav>
        <div className="mx-4 mt-6 border-t border-white/10 py-5">
          <p className="mb-3 text-[11px] text-[#a5a5af]">En partenariat avec Celexia</p>
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-sm font-medium" aria-hidden>{nom.trim().charAt(0).toUpperCase()}</span>
            <div className="min-w-0"><p className="truncate text-xs font-medium text-white" title={societe || nom}>{societe || nom}</p><p className="mt-1 truncate text-[11px] text-[#a5a5af]" title={nom}>{societe ? nom : 'Artisan partenaire'}</p></div>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-border bg-card md:ml-60">
        <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-8">
          <button type="button" onClick={() => onAller('chantiers')} className="rounded-md md:hidden" aria-label="Celexia — mes chantiers"><BrandLogo className="h-6" /></button>
          <div className="hidden min-w-0 items-center gap-2 text-xs md:flex"><span className="text-muted-foreground">Espace artisan</span><ChevronRight className="size-3 text-muted-foreground/60" aria-hidden /><span className="font-medium">{courant.titre}</span></div>
          <button type="button" onClick={() => onAller('entreprise')} className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground">{signe ? <Check className="size-3.5 text-emerald-700" aria-hidden /> : <Lock className="size-3.5 text-amber-700" aria-hidden />}{signe ? 'Contrat signé' : 'Contrat à signer'}</button>
        </div>
      </header>

      <main id="espace-contenu" tabIndex={-1} className="min-w-0 outline-none md:ml-60">
        <div className="mx-auto max-w-[1360px] px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 md:px-8 md:pb-12 md:pt-8">{children}</div>
      </main>

      <nav aria-label="Accès rapides artisan" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="mx-auto flex max-w-2xl items-stretch">
          {principaux.map(({ cle, titre, Icone }) => <button key={cle} type="button" aria-label={titre} aria-current={cle === vue ? 'page' : undefined} onClick={() => onAller(cle)} className={cn('flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors', cle === vue ? 'bg-primary/5 text-primary' : 'text-muted-foreground hover:bg-muted')}><Icone className="size-[18px]" strokeWidth={1.5} aria-hidden /><span>{titresRapides[cle as keyof typeof titresRapides]}</span></button>)}
          <MenuEspace vue={vue} onAller={onAller} compteurs={{ chantiers: nbChantiers }} />
        </div>
      </nav>
    </div>
  )
}
