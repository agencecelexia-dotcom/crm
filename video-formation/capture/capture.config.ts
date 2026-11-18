import { defineConfig, devices } from '@playwright/test'

// Captures de l'espace artisan RÉEL pour la vidéo, sur les données fictives
// des tests (aucune API réelle : tout est intercepté).
// Lancer depuis la racine du CRM : npx playwright test --config video-formation/capture/capture.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: ['capturer.spec.ts'],
  outputDir: '../../test-results/video-capture',
  metadata: { isolatedInterface: true },
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5180',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    contextOptions: { reducedMotion: 'reduce' },
    serviceWorkers: 'block',
  },
  projects: [
    // iPhone 14 : 390 × 844, rendu ×3 pour rester net une fois zoomé.
    { name: 'telephone', use: { ...devices['iPhone 14'], defaultBrowserType: 'chromium', deviceScaleFactor: 3, viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5180 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      VITE_SUPABASE_URL: 'https://crm-test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-public-key',
    },
  },
})
