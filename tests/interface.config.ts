import { defineConfig, devices } from '@playwright/test'

// Suite indépendante : données fictives, API intégralement interceptée.
// Exécution : npx playwright test --config tests/interface.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: ['interface.spec.ts', 'espace-artisan.spec.ts', 'artisan-*-audit.spec.ts'],
  outputDir: '../test-results/interface',
  metadata: { isolatedInterface: true },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5180',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    contextOptions: { reducedMotion: 'reduce' },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5180 --strictPort',
    cwd: '..',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: process.env.ARTISAN_AUDIT_SHARED_SERVER === '1',
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      VITE_SUPABASE_URL: 'https://crm-test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-public-key',
    },
  },
})
