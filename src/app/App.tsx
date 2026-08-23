import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AppProviders } from './providers'
import { AppLayout } from './layout/app-layout'
import { AuthProvider } from '@/lib/auth/auth-provider'
import { ProtectedRoute } from '@/lib/auth/protected-route'
import { RouteFondateur } from '@/lib/auth/route-fondateur'
import { AccueilSelonRole } from '@/features/accueil-selon-role'
import { EquipePage } from '@/features/equipe/equipe-page'
import { MonPipePage } from '@/features/commercial/mon-pipe-page'
import { ReprisesPage } from '@/features/equipe/reprises-page'
import { VueCommercialPage } from '@/features/equipe/vue-commercial-page'
import { ErrorBoundary } from '@/components/error-boundary'
import { PageIntrouvable } from '@/features/page-introuvable'

import { LoginPage } from '@/features/auth/login-page'
import { DefinirMotDePassePage } from '@/features/auth/definir-mot-de-passe-page'
import { SignerPage } from '@/features/contrats/signer-page'
import { MissionPage } from '@/features/contrats/mission-page'
import { EspaceArtisanPage } from '@/features/contrats/espace-artisan-page'
import { InscriptionArtisanPage } from '@/features/artisans/pages/inscription-artisan-page'
const CartePage = lazy(() => import('@/features/carte/carte-page').then((m) => ({ default: m.CartePage })))
import { CommissionsPage } from '@/features/commissions/commissions-page'
import { TachesPage } from '@/features/taches/taches-page'
const CouverturePage = lazy(() => import('@/features/couverture/couverture-page').then((m) => ({ default: m.CouverturePage })))
import { NotesPage } from '@/features/notes/notes-page'
import { AppelPage } from '@/features/appel/appel-page'
import { AReattribuerPage } from '@/features/projets/pages/a-reattribuer-page'
import { ProjetsListPage } from '@/features/projets/pages/projets-list-page'
import { CorbeillePage } from '@/features/projets/pages/corbeille-page'
import { ProjetNewPage } from '@/features/projets/pages/projet-new-page'
import { ProjetEditPage } from '@/features/projets/pages/projet-edit-page'
import { ProjetDetailPage } from '@/features/projets/pages/projet-detail-page'
import { ArtisansListPage } from '@/features/artisans/pages/artisans-list-page'
const ArtisansStatsPage = lazy(() => import('@/features/artisans/pages/artisans-stats-page').then((m) => ({ default: m.ArtisansStatsPage })))
import { ArtisansEcartesPage } from '@/features/artisans/pages/artisans-ecartes-page'
const ArtisansZonesPage = lazy(() => import('@/features/artisans/pages/artisans-zones-page').then((m) => ({ default: m.ArtisansZonesPage })))
import { ArtisanNewPage } from '@/features/artisans/pages/artisan-new-page'
import { ArtisanDetailPage } from '@/features/artisans/pages/artisan-detail-page'
import { ArtisanEditPage } from '@/features/artisans/pages/artisan-edit-page'
import { ParametresSignaturePage } from '@/features/parametres/signature-page'
import { AutomatisationsPage } from '@/features/automatisations/automatisations-page'

/**
 * Attente d'un écran chargé à la demande.
 *
 * La carte (Leaflet) et les graphiques (recharts) pèsent ensemble plus de
 * 500 kB. Les charger au démarrage ralentissait l'ouverture du CRM pour tout le
 * monde, alors que ces écrans sont consultés ponctuellement.
 */
function EcranEnChargement() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  )
}

// Point d'entrée applicatif : providers globaux + routage.
export default function App() {
  return (
    <AppProviders>
      <AuthProvider>
        <BrowserRouter>
          <ErrorBoundary>
          <Suspense fallback={<EcranEnChargement />}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            {/* Arrivée depuis un e-mail d'invitation : la personne a un compte
                mais pas encore de mot de passe. Publique par nécessité — le
                jeton du lien fait foi, et l'inscription libre est fermée côté
                Supabase, donc cette page ne peut pas servir à créer un compte. */}
            <Route path="/bienvenue" element={<DefinirMotDePassePage />} />
            {/* Pages publiques (sans authentification).
                Chacune a sa PROPRE frontière d'erreur : un plantage sur l'une
                ne doit pas emporter les autres, et un artisan en train de
                signer doit voir un message plutôt qu'un écran blanc. */}
            <Route
              path="/signer/:token"
              element={<ErrorBoundary><SignerPage /></ErrorBoundary>}
            />
            {/* Espace artisan par projet : signature → dossier client → dépôt devis */}
            <Route
              path="/mission/:token"
              element={<ErrorBoundary><MissionPage /></ErrorBoundary>}
            />
            {/* Espace artisan UNIQUE (un lien par artisan) : contrat + tous ses chantiers */}
            <Route
              path="/artisan/:token"
              element={<ErrorBoundary><EspaceArtisanPage /></ErrorBoundary>}
            />
            {/* Auto-inscription artisan (lien public externe : WhatsApp/Facebook…) */}
            <Route
              path="/rejoindre"
              element={<ErrorBoundary><InscriptionArtisanPage /></ErrorBoundary>}
            />
            <Route
              path="/rejoindre/:canal"
              element={<ErrorBoundary><InscriptionArtisanPage /></ErrorBoundary>}
            />

            {/* Privé (nécessite une session) */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                {/* L'accueil dépend du rôle : le fondateur pilote l'agence,
                    le commercial travaille ses leads. */}
                <Route path="/" element={<AccueilSelonRole />} />
                <Route path="/taches" element={<TachesPage />} />
                <Route path="/carte" element={<CartePage />} />

                <Route path="/appel" element={<AppelPage />} />
                <Route path="/projets" element={<ProjetsListPage />} />
                <Route path="/projets/a-reattribuer" element={<AReattribuerPage />} />
                {/* Les chantiers repris par le commercial connecté : périmètre
                    exclusif, invisible aux autres commerciaux (0116). */}
                <Route path="/mon-pipe" element={<MonPipePage />} />
                <Route path="/projets/corbeille" element={<CorbeillePage />} />
                <Route path="/projets/new" element={<ProjetNewPage />} />
                <Route path="/projets/:id" element={<ProjetDetailPage />} />
                <Route path="/projets/:id/edit" element={<ProjetEditPage />} />

                <Route path="/artisans" element={<ArtisansListPage />} />
                <Route path="/artisans/stats" element={<ArtisansStatsPage />} />
                <Route path="/artisans/ecartes" element={<ArtisansEcartesPage />} />
                <Route path="/artisans/zones" element={<ArtisansZonesPage />} />
                <Route path="/artisans/new" element={<ArtisanNewPage />} />
                <Route path="/artisans/:id" element={<ArtisanDetailPage />} />
                <Route path="/artisans/:id/edit" element={<ArtisanEditPage />} />

                <Route path="/parametres/signature" element={<ParametresSignaturePage />} />

                {/* Réservé aux fondateurs : commissions, vivier de
                    prospection, réglages d'automatisation. Un commercial qui
                    force l'URL est renvoyé à l'accueil ; la RLS lui renverrait
                    de toute façon une liste vide. */}
                <Route element={<RouteFondateur />}>
                  <Route path="/commissions" element={<CommissionsPage />} />
                  <Route path="/notes" element={<NotesPage />} />
                  <Route path="/couverture" element={<CouverturePage />} />
                  <Route path="/parametres/automatisations" element={<AutomatisationsPage />} />
                  <Route path="/equipe" element={<EquipePage />} />
                  {/* L'espace d'un commercial, en lecture seule. */}
                  <Route path="/equipe/:id" element={<VueCommercialPage />} />
                  {/* Suivi des chantiers repris par chaque commercial. */}
                  <Route path="/reprises" element={<ReprisesPage />} />
                </Route>
              </Route>
            </Route>

            {/* 404 explicite. Avant : redirection muette vers "/", donc vers
                /login pour un visiteur non authentifié — un artisan avec un
                lien tronqué se retrouvait bloqué sans explication. */}
            <Route path="*" element={<PageIntrouvable />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
      </AuthProvider>
    </AppProviders>
  )
}
