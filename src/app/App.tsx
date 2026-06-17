import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProviders } from './providers'
import { AppLayout } from './layout/app-layout'
import { AuthProvider } from '@/lib/auth/auth-provider'
import { ProtectedRoute } from '@/lib/auth/protected-route'

import { LoginPage } from '@/features/auth/login-page'
import { SignerPage } from '@/features/contrats/signer-page'
import { MissionPage } from '@/features/contrats/mission-page'
import { EspaceArtisanPage } from '@/features/contrats/espace-artisan-page'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { CartePage } from '@/features/carte/carte-page'
import { CommissionsPage } from '@/features/commissions/commissions-page'
import { TachesPage } from '@/features/taches/taches-page'
import { NotesPage } from '@/features/notes/notes-page'
import { ProjetsListPage } from '@/features/projets/pages/projets-list-page'
import { CorbeillePage } from '@/features/projets/pages/corbeille-page'
import { ProjetNewPage } from '@/features/projets/pages/projet-new-page'
import { ProjetEditPage } from '@/features/projets/pages/projet-edit-page'
import { ProjetDetailPage } from '@/features/projets/pages/projet-detail-page'
import { ArtisansListPage } from '@/features/artisans/pages/artisans-list-page'
import { ArtisansStatsPage } from '@/features/artisans/pages/artisans-stats-page'
import { ArtisanNewPage } from '@/features/artisans/pages/artisan-new-page'
import { ArtisanDetailPage } from '@/features/artisans/pages/artisan-detail-page'
import { ArtisanEditPage } from '@/features/artisans/pages/artisan-edit-page'
import { ParametresSignaturePage } from '@/features/parametres/signature-page'
import { AutomatisationsPage } from '@/features/automatisations/automatisations-page'

// Point d'entrée applicatif : providers globaux + routage.
export default function App() {
  return (
    <AppProviders>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            {/* Pages publiques (sans authentification) */}
            <Route path="/signer/:token" element={<SignerPage />} />
            {/* Espace artisan par projet : signature → dossier client → dépôt devis */}
            <Route path="/mission/:token" element={<MissionPage />} />
            {/* Espace artisan UNIQUE (un lien par artisan) : contrat + tous ses chantiers */}
            <Route path="/artisan/:token" element={<EspaceArtisanPage />} />

            {/* Privé (nécessite une session) */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/taches" element={<TachesPage />} />
                <Route path="/carte" element={<CartePage />} />
                <Route path="/commissions" element={<CommissionsPage />} />
                <Route path="/notes" element={<NotesPage />} />

                <Route path="/projets" element={<ProjetsListPage />} />
                <Route path="/projets/corbeille" element={<CorbeillePage />} />
                <Route path="/projets/new" element={<ProjetNewPage />} />
                <Route path="/projets/:id" element={<ProjetDetailPage />} />
                <Route path="/projets/:id/edit" element={<ProjetEditPage />} />

                <Route path="/artisans" element={<ArtisansListPage />} />
                <Route path="/artisans/stats" element={<ArtisansStatsPage />} />
                <Route path="/artisans/new" element={<ArtisanNewPage />} />
                <Route path="/artisans/:id" element={<ArtisanDetailPage />} />
                <Route path="/artisans/:id/edit" element={<ArtisanEditPage />} />

                <Route path="/parametres/signature" element={<ParametresSignaturePage />} />
                <Route path="/parametres/automatisations" element={<AutomatisationsPage />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </AppProviders>
  )
}
