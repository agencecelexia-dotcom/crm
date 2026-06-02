import { test, expect } from '@playwright/test'

// Test de fumée : sans session, toute route privée redirige vers /login,
// et l'écran de connexion affiche ses champs.
test('redirige vers la page de connexion et affiche le formulaire', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)

  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Mot de passe')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible()
})

test('la page de connexion valide les champs requis', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  // zod affiche un message d'erreur sur l'email invalide/vide
  await expect(page.getByText('Email invalide')).toBeVisible()
})
