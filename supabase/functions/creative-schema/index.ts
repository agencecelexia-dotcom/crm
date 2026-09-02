// Edge Function : relaie le schéma OpenAPI d'un modèle fal.
//
// C'est ce qui permet au formulaire de s'adapter à n'importe lequel des 1 491
// modèles du catalogue, au lieu d'en coder quelques-uns en dur.
//
// Pourquoi un relais plutôt qu'un appel direct depuis le navigateur : la CSP
// du CRM n'autorise pas `fal.ai` dans `connect-src`, et l'élargir pour une
// lecture de schéma affaiblirait la politique sans nécessité.

import { cors, json, fondateur, modeleValide } from '../_partage-fal.ts'

interface Champ {
  nom: string
  type: string
  titre?: string
  description?: string
  defaut?: unknown
  options?: string[]
  min?: number
  max?: number
  requis: boolean
}

/** Traduit un schéma OpenAPI en description de formulaire. */
function champs(schema: Record<string, unknown>): Champ[] {
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const requis = new Set((schema.required ?? []) as string[])

  return Object.entries(props).map(([nom, p]) => {
    // `anyOf` regroupe les formes acceptées par un même champ. `image_size`
    // vaut par exemple soit un objet ImageSize (une référence), soit une des
    // valeurs d'une énumération. On privilégie la branche ÉNUMÉRÉE : c'est
    // elle qui donne une liste de choix, là où la référence ne donnerait
    // qu'un objet à remplir à la main.
    const variantes = (p.anyOf ?? p.oneOf) as Record<string, unknown>[] | undefined
    const def =
      variantes?.find((v) => Array.isArray(v.enum)) ??
      variantes?.find((v) => v.type !== 'null' && !v.$ref) ??
      variantes?.find((v) => v.type !== 'null') ??
      p

    const enumere = (def.enum ?? p.enum) as string[] | undefined
    return {
      nom,
      type: String(def.type ?? 'string'),
      titre: (p.title ?? def.title) as string | undefined,
      description: (p.description ?? def.description) as string | undefined,
      defaut: p.default,
      options: enumere,
      min: (def.minimum ?? p.minimum) as number | undefined,
      max: (def.maximum ?? p.maximum) as number | undefined,
      requis: requis.has(nom),
    }
  })
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const auth = await fondateur(req)
    if ('erreur' in auth) return json({ ok: false, error: auth.erreur }, auth.code, CORS)

    const { modele } = await req.json()
    if (!modeleValide(modele)) {
      return json({ ok: false, error: 'modele_invalide' }, 400, CORS)
    }

    const rep = await fetch(
      `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(modele)}`,
    )
    if (!rep.ok) return json({ ok: false, error: 'schema_introuvable' }, 404, CORS)

    const doc = await rep.json()
    const schemas = (doc?.components?.schemas ?? {}) as Record<string, Record<string, unknown>>

    // Le schéma d'entrée est celui dont le nom se termine par « Input ».
    const entree = Object.entries(schemas).find(([n]) => /Input$/.test(n))
    if (!entree) return json({ ok: false, error: 'schema_sans_entree' }, 422, CORS)

    return json(
      { ok: true, modele, schema: entree[0], champs: champs(entree[1]) },
      200,
      CORS,
    )
  } catch (e) {
    console.error('creative-schema', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
