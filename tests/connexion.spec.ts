import { expect, test } from '@playwright/test'

/**
 * Régression : le CRM restait bloqué sur l'écran de chargement.
 *
 * Cause — le provider appelait `supabase.from('membres')` DANS le callback
 * `onAuthStateChange`. Le client Supabase détient un verrou interne pendant
 * l'exécution de ce callback : la requête attendait un verrou qui ne se
 * libérait qu'à la fin du callback. Interblocage, `isLoading` jamais remis à
 * false, écran de chargement infini.
 *
 * Ces tests vérifient que l'application rend quelque chose d'utilisable dans
 * un délai humain — pas qu'elle tourne.
 */
test('la page de connexion s’affiche sans rester en chargement', async ({ page }) => {
  await page.goto('/login')
  // Le formulaire, pas le spinner : c'est le symptôme exact du blocage.
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible({ timeout: 10000 })
  await expect(page.getByLabel(/email/i)).toBeVisible()
})

test('une route protégée tranche vite, sans chargement infini', async ({ page }) => {
  await page.goto('/commissions')
  // Sans session, la garde renvoie à /login. L'important est qu'elle TRANCHE.
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
})

test('l’accueil ne reste pas bloqué sur le spinner', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible()
})

/*
 * NON COUVERT : le blocage après connexion réussie.
 *
 * La régression n'apparaît qu'avec une session valide — c'est à ce moment que
 * `onAuthStateChange` déclenche la requête qui s'interbloque. Vérifié : avec le
 * bug réintroduit, tous les tests ci-dessus passent quand même.
 *
 * Le couvrir demanderait un compte de test dédié et ses identifiants en
 * secrets CI. Tant que ce compte n'existe pas, mieux vaut l'écrire ici que
 * laisser croire à une protection qui n'existe pas.
 */
