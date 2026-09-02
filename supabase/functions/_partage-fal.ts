// Socle commun aux trois fonctions de génération de créatives.
//
// La clé fal ne transite JAMAIS par le navigateur : le bundle front est public.
// Toute la communication avec fal.ai passe donc par ces fonctions.

import { createClient } from 'jsr:@supabase/supabase-js@2'

// CORS restreint, repris d'`extraire-lead`. `SITE_URL` porte le domaine de
// production : sans lui, seul le développement local fonctionne — un échec
// bruyant vaut mieux qu'un `*` silencieusement permissif.
const ORIGINES = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...(Deno.env.get('SITE_URL') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
]

export function cors(origin: string | null) {
  const ok =
    origin && (ORIGINES.includes(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ORIGINES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  })
}

export function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

/**
 * Vérifie que l'appelant est un fondateur actif.
 *
 * Double contrôle, comme `inviter-membre` : le JWT doit être valide, ET la
 * table `membres` doit confirmer le rôle. Générer engage de l'argent — le
 * budget publicitaire relève du périmètre des fondateurs.
 */
export async function fondateur(req: Request) {
  const jeton = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!jeton) return { erreur: 'non_authentifie', code: 401 }

  const sb = admin()
  const { data: u, error } = await sb.auth.getUser(jeton)
  if (error || !u?.user) return { erreur: 'session_invalide', code: 401 }

  const { data: m } = await sb
    .from('membres')
    .select('role, actif')
    .eq('user_id', u.user.id)
    .maybeSingle()

  if (m?.role !== 'fondateur' || !m?.actif) {
    return { erreur: 'reserve_fondateur', code: 403 }
  }
  return { userId: u.user.id, sb }
}

/** Identifiant fal : `fal-ai/flux/schnell`, `bytedance/seedream/v5/pro`… */
export function modeleValide(m: unknown): m is string {
  return typeof m === 'string' && /^[a-z0-9][\w.-]*(\/[\w.-]+){1,4}$/i.test(m)
}

export const FAL_KEY = () => Deno.env.get('FAL_KEY') ?? ''
