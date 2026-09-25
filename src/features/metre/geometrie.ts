// La géométrie du métré vit dans `supabase/functions/_geometrie.ts` : l'écran
// et la pré-mesure (côté serveur) en partagent le code, pour que la valeur
// pré-mesurée soit celle que l'artisan lit.
export * from '../../../supabase/functions/_geometrie.ts'
