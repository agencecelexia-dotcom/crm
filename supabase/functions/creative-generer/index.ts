// Edge Function : soumet une génération à fal.ai.
//
// Trois contrôles avant de dépenser quoi que ce soit : l'appelant est
// fondateur, le plafond mensuel n'est pas atteint, et le modèle a une forme
// d'identifiant valable.
//
// Le plafond est vérifié ICI, pas seulement à l'écran : un appel direct à
// cette fonction doit être refusé de la même façon, sinon le garde-fou ne
// garde rien.

import { cors, json, fondateur, modeleValide, FAL_KEY } from '../_partage-fal.ts'

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const auth = await fondateur(req)
    if ('erreur' in auth) return json({ ok: false, error: auth.erreur }, auth.code, CORS)
    const { sb, userId } = auth

    const cle = FAL_KEY()
    if (!cle) return json({ ok: false, error: 'cle_absente' }, 500, CORS)

    const { modele, parametres, categorie, format, coutEstime } = await req.json()
    if (!modeleValide(modele)) {
      return json({ ok: false, error: 'modele_invalide' }, 400, CORS)
    }

    // Garde-fou de volume.
    const { data: quota } = await sb.rpc('creatives_quota_restant')
    const q = quota as { utilise: number; plafond: number; reste: number } | null
    if (q && q.reste <= 0) {
      return json(
        { ok: false, error: 'plafond_atteint', utilise: q.utilise, plafond: q.plafond },
        429,
        CORS,
      )
    }

    // Soumission à la file d'attente. On ne passe PAS par `fal.run` synchrone :
    // même une image peut dépasser le temps imparti à une edge function, et la
    // vidéo le dépassera toujours.
    const rep = await fetch(`https://queue.fal.run/${modele}`, {
      method: 'POST',
      headers: { Authorization: `Key ${cle}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(parametres ?? {}),
    })

    const corps = await rep.json().catch(() => null)

    if (!rep.ok) {
      // Le compte sans crédit est le cas le plus fréquent au démarrage : on le
      // nomme, plutôt que de renvoyer une erreur générique.
      const detail = String(corps?.detail ?? '')
      const motif = detail.includes('TOP_UP')
        ? 'compte_sans_credit'
        : rep.status === 401
          ? 'cle_refusee'
          : 'fal_erreur'
      return json({ ok: false, error: motif, detail: detail.slice(0, 200) }, 502, CORS)
    }

    const requestId = corps?.request_id ?? corps?.requestId
    if (!requestId) return json({ ok: false, error: 'sans_request_id' }, 502, CORS)

    const { data: ligne, error: eIns } = await sb
      .from('creatives')
      .insert({
        cree_par: userId,
        modele,
        categorie: categorie ?? 'text-to-image',
        prompt: typeof parametres?.prompt === 'string' ? parametres.prompt : null,
        parametres: parametres ?? {},
        format: format ?? null,
        statut: 'en_cours',
        request_id: requestId,
        cout_estime: typeof coutEstime === 'number' ? coutEstime : null,
      })
      .select('id')
      .single()

    if (eIns) {
      console.error('insert creative', eIns)
      return json({ ok: false, error: 'enregistrement_impossible' }, 502, CORS)
    }

    return json({ ok: true, id: ligne.id, request_id: requestId }, 200, CORS)
  } catch (e) {
    console.error('creative-generer', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
