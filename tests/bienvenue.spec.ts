import { test, expect } from '@playwright/test'

// La page d'invitation ne doit jamais laisser quelqu'un bloqué : sans jeton
// valide, elle annonce un lien expiré au lieu de tourner indéfiniment.
test('un lien d’invitation sans jeton annonce un lien expiré', async ({ page }) => {
  await page.goto('/bienvenue')
  await expect(page.getByText('Lien expiré')).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Retour à la connexion' })).toBeVisible()
})
