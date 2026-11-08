import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AppProviders } from './providers'
import { AppLayout } from './layout/app-layout'
import { AuthProvider } from '@/lib/auth/auth-provider'
import { ProtectedRoute } from '@/lib/auth/protected-route'
import { RouteFondateur } from '@/lib/auth/route-fondateur'
const AccueilSelonRole = lazy(() => import('@/features/accueil-selon-role').then((m) => ({ default: m.AccueilSelonRole })))
const EquipePage = lazy(() => import('@/features/equipe/equipe-page').then((m) => ({ default: m.EquipePage })))
const MonPipePage = lazy(() => import('@/features/commercial/mon-pipe-page').then((m) => ({ default: m.MonPipePage })))
const ReprisesPage = lazy(() => import('@/features/equipe/reprises-page').then((m) => ({ default: m.ReprisesPage })))
const BusinessPlanPage = lazy(() => import('@/features/business-plan/business-plan-page').then((m) => ({ default: m.BusinessPlanPage })))
const CreativesPage = lazy(() => import('@/features/creatives/creatives-page').then((m) => ({ default: m.CreativesPage })))
const VueCommercialPage = lazy(() => import('@/features/equipe/vue-commercial-page').then((m) => ({ default: m.VueCommercialPage })))
import { ErrorBoundary } from '@/components/error-boundary'
import { PageIntrouvable } from '@/features/page-introuvable'

import { LoginPage } from '@/features/auth/login-page'
const DefinirMotDePassePage = lazy(() => import('@/features/auth/definir-mot-de-passe-page').then((m) => ({ default: m.DefinirMotDePassePage })))
const SignerPage = lazy(() => import('@/features/contrats/signer-page').then((m) => ({ default: m.SignerPage })))
const MissionPage = lazy(() => import('@/features/contrats/mission-page').then((m) => ({ default: m.MissionPage })))
// Différé : l'espace artisan est une route PUBLIQUE par jeton, que personne de
// l'agence n'ouvre jamais — et il emmène avec lui tout le générateur de devis
// (modèles, entretien, identité, jsPDF). Le laisser dans le bundle initial le
// faisait télécharger par tout le monde, pour n'être utilisé par presque
// personne.
const EspaceArtisanPage = lazy(() =>
  import('@/features/contrats/espace-artisan-page').then((m) => ({ default: m.EspaceArtisanPage })),
)
const InscriptionArtisanPage = lazy(() => import('@/features/artisans/pages/inscription-artisan-page').then((m) => ({ default: m.InscriptionArtisanPage })))
const CartePage = lazy(() => import('@/features/carte/carte-page').then((m) => ({ default: m.CartePage })))
const MetragesAVerifierPage = lazy(() =>
  import('@/features/metre/metrages-a-verifier-page').then((m) => ({ default: m.MetragesAVerifierPage })),
)
const Maison3DPage = lazy(() =>
  import('@/features/metre/maison-3d-page').then((m) => ({ default: m.Maison3DPage })),
)
const CommissionsPage = lazy(() => import('@/features/commissions/commissions-page').then((m) => ({ default: m.CommissionsPage })))
const TachesPage = lazy(() => import('@/features/taches/taches-page').then((m) => ({ default: m.TachesPage })))
const CouverturePage = lazy(() => import('@/features/couverture/couverture-page').then((m) => ({ default: m.CouverturePage })))
const NotesPage = lazy(() => import('@/features/notes/notes-page').then((m) => ({ default: m.NotesPage })))
const AppelPage = lazy(() => import('@/features/appel/appel-page').then((m) => ({ default: m.AppelPage })))
const AReattribuerPage = lazy(() => import('@/features/projets/pages/a-reattribuer-page').then((m) => ({ default: m.AReattribuerPage })))
const ProjetsListPage = lazy(() => import('@/features/projets/pages/projets-list-page').then((m) => ({ default: m.ProjetsListPage })))
const CorbeillePage = lazy(() => import('@/features/projets/pages/corbeille-page').then((m) => ({ default: m.CorbeillePage })))
const ProjetNewPage = lazy(() => import('@/features/projets/pages/projet-new-page').then((m) => ({ default: m.ProjetNewPage })))
const ProjetEditPage = lazy(() => import('@/features/projets/pages/projet-edit-page').then((m) => ({ default: m.ProjetEditPage })))
const ProjetDetailPage = lazy(() => import('@/features/projets/pages/projet-detail-page').then((m) => ({ default: m.ProjetDetailPage })))
const ArtisansListPage = lazy(() => import('@/features/artisans/pages/artisans-list-page').then((m) => ({ default: m.ArtisansListPage })))
const ArtisansStatsPage = lazy(() => import('@/features/artisans/pages/artisans-stats-page').then((m) => ({ default: m.ArtisansStatsPage })))
const ArtisansEcartesPage = lazy(() => import('@/features/artisans/pages/artisans-ecartes-page').then((m) => ({ default: m.ArtisansEcartesPage })))
const ArtisansZonesPage = lazy(() => import('@/features/artisans/pages/artisans-zones-page').then((m) => ({ default: m.ArtisansZonesPage })))
const ArtisanNewPage = lazy(() => import('@/features/artisans/pages/artisan-new-page').then((m) => ({ default: m.ArtisanNewPage })))
const ArtisanDetailPage = lazy(() => import('@/features/artisans/pages/artisan-detail-page').then((m) => ({ default: m.ArtisanDetailPage })))
const ArtisanEditPage = lazy(() => import('@/features/artisans/pages/artisan-edit-page').then((m) => ({ default: m.ArtisanEditPage })))
const ParametresSignaturePage = lazy(() => import('@/features/parametres/signature-page').then((m) => ({ default: m.ParametresSignaturePage })))
const AutomatisationsPage = lazy(() => import('@/features/automatisations/automatisations-page').then((m) => ({ default: m.AutomatisationsPage })))

/**
 * Attente d'un écran chargé à la demande.
 *
 * La carte (Leaflet) et les graphiques (recharts) pèsent ensemble plus de
 * 500 kB. Les charger au démarrage ralentissait l'ouverture du CRM pour tout le
 * monde, alors que ces écrans sont consultés ponctuellement.
 */
function EcranEnChargement() {
  return (
    <div role="status" className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      Chargement de l’écran…
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
                {/* L'outil mesure, l'agence tranche : les écarts entre ce que
                    dit le client et ce que mesure l'outil. */}
                <Route path="/metres-a-verifier" element={<MetragesAVerifierPage />} />
                {/* Une adresse : la maison en 3D et tous ses métrés. */}
                <Route path="/maison-3d" element={<Maison3DPage />} />

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
                  {/* Stratégie de la boîte : réservé aux fondateurs, comme
                      les commissions et les réglages. */}
                  <Route path="/business-plan" element={<BusinessPlanPage />} />
                  {/* Génération de visuels publicitaires : engage de l'argent,
                      donc réservé aux fondateurs comme les commissions. */}
                  <Route path="/creatives" element={<CreativesPage />} />
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
