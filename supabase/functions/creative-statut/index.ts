// Edge Function : suit une génération et rapatrie le fichier.
//
// Les URL renvoyées par fal expirent au bout de quelques jours. Sans recopie
// dans notre stockage, la galerie se viderait toute seule — c'est la raison
// d'être de cette fonction, au-delà du simple sondage d'état.

import { cors, json, fondateur, FAL_KEY } from '../_partage-fal.ts'

/** Extensions reconnues, pour nommer le fichier stocké. */
function extension(url: string, contentType: string | null) {
  const m = url.split('?')[0].match(/\.(png|jpe?g|webp|mp4|webm)$/i)
  if (m) return m[1].toLowerCase()
  if (contentType?.includes('png')) return 'png'
  if (contentType?.includes('webp')) return 'webp'
  if (contentType?.includes('mp4')) return 'mp4'
  return 'jpg'
}

/**
 * Base d'interrogation de la file d'attente.
 *
 * On soumet sur le chemin COMPLET du modèle (`fal-ai/flux/schnell`), mais fal
 * n'expose le statut et le résultat que sous l'identifiant de l'application —
 * ses deux premiers segments (`fal-ai/flux`). Interroger le chemin complet
 * renvoie 405, sans message : la génération semblait ne jamais aboutir.
 */
function baseFile(modele: string) {
  return modele.split('/').slice(0, 2).join('/')
}

/** fal renvoie ses sorties sous des formes variables selon le modèle. */
function urlsDuResultat(r: unknown): string[] {
  const out: string[] = []
  const visite = (v: unknown) => {
    if (!v) return
    if (typeof v === 'string') return
    if (Array.isArray(v)) return v.forEach(visite)
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.url === 'string') out.push(o.url)
      Object.values(o).forEach(visite)
    }
  }
  visite(r)
  return [...new Set(out)]
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const auth = await fondateur(req)
    if ('erreur' in auth) return json({ ok: false, error: auth.erreur }, auth.code, CORS)
    const { sb } = auth

    const cle = FAL_KEY()
    if (!cle) return json({ ok: false, error: 'cle_absente' }, 500, CORS)

    const { id } = await req.json()
    const { data: c } = await sb
      .from('creatives')
      .select('id, modele, request_id, statut, fichiers')
      .eq('id', id)
      .maybeSingle()

    if (!c) return json({ ok: false, error: 'introuvable' }, 404, CORS)
    // Déjà résolue : on ne réinterroge pas fal inutilement.
    if (c.statut !== 'en_cours') {
      return json({ ok: true, statut: c.statut, fichiers: c.fichiers }, 200, CORS)
    }

    const base = `https://queue.fal.run/${baseFile(c.modele)}/requests/${c.request_id}`
    const st = await fetch(`${base}/status`, { headers: { Authorization: `Key ${cle}` } })
    const etat = await st.json().catch(() => null)

    if (etat?.status !== 'COMPLETED') {
      // IN_QUEUE ou IN_PROGRESS : le client rappellera.
      return json({ ok: true, statut: 'en_cours', etape: etat?.status ?? null }, 200, CORS)
    }

    const res = await fetch(base, { headers: { Authorization: `Key ${cle}` } })
    const resultat = await res.json().catch(() => null)
    const urls = urlsDuResultat(resultat)

    if (urls.length === 0) {
      await sb
        .from('creatives')
        .update({ statut: 'echoue', erreur: 'aucun fichier dans le résultat' })
        .eq('id', c.id)
      return json({ ok: true, statut: 'echoue' }, 200, CORS)
    }

    // Recopie dans notre stockage.
    const chemins: string[] = []
    for (const [i, u] of urls.entries()) {
      const f = await fetch(u)
      if (!f.ok) continue
      const type = f.headers.get('content-type')
      const chemin = `${c.id}/${i}.${extension(u, type)}`
      const { error } = await sb.storage
        .from('creatives')
        .upload(chemin, await f.arrayBuffer(), {
          contentType: type ?? 'application/octet-stream',
          upsert: true,
        })
      if (!error) chemins.push(chemin)
    }

    if (chemins.length === 0) {
      await sb
        .from('creatives')
        .update({ statut: 'echoue', erreur: 'rapatriement impossible' })
        .eq('id', c.id)
      return json({ ok: true, statut: 'echoue' }, 200, CORS)
    }

    await sb
      .from('creatives')
      .update({ statut: 'reussi', fichiers: chemins })
      .eq('id', c.id)

    return json({ ok: true, statut: 'reussi', fichiers: chemins }, 200, CORS)
  } catch (e) {
    console.error('creative-statut', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
