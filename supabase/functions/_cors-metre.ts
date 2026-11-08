/** Les aperçus locaux changent de port ; l'accès reste contrôlé par chaque fonction. */
export function corsMetre(origin: string | null, siteUrl = ''): Record<string, string> {
  const configurees = siteUrl.split(',').map((o) => o.trim()).filter(Boolean)
  const local = !!origin && /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(origin)
  const autorisee = origin && (local || configurees.includes(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin))
  return {
    'Access-Control-Allow-Origin': autorisee ? origin : 'http://localhost:5173',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
