import { defineConfig, devices } from '@playwright/test'

// Tests e2e basiques. Lance automatiquement le serveur de dev Vite.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // Empêche qu'un `test.only` oublié réduise silencieusement la CI à un test.
  forbidOnly: !!process.env.CI,
  // Sans `retries`, `trace: 'on-first-retry'` ne produisait JAMAIS de trace :
  // il n'y avait pas de seconde tentative.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    // L'app est aussi utilisée sur desktop (sidebar), jusqu'ici non couverte.
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
