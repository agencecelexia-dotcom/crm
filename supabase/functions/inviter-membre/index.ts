// Edge Function : invite un commercial.
//
// L'invitation d'un utilisateur demande la clé `service_role`, qui contourne
// toute la sécurité RLS. Elle n'a donc rien à faire dans le navigateur : le
// bundle front est public. C'est la raison d'être de cette fonction.
//
// Double contrôle avant d'agir : le JWT de l'appelant doit être valide, ET la
// personne doit être fondatrice. Vérifier seulement le premier laisserait un
// commercial s'inviter des collègues.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ORIGINES = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...(Deno.env.get('SITE_URL') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
]

function cors(origin: string | null) {
  const ok = origin && (ORIGINES.includes(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ORIGINES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const jeton = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!jeton) return json({ ok: false, error: 'non_authentifie' }, 401, CORS)

    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 1. Qui appelle ?
    const { data: u, error: eUser } = await admin.auth.getUser(jeton)
    if (eUser || !u?.user) return json({ ok: false, error: 'session_invalide' }, 401, CORS)

    // 2. Est-il fondateur ? La table `membres` fait foi, pas le front.
    const { data: membre } = await admin
      .from('membres')
      .select('role, actif')
      .eq('user_id', u.user.id)
      .maybeSingle()

    if (membre?.role !== 'fondateur' || !membre?.actif) {
      return json({ ok: false, error: 'reserve_fondateur' }, 403, CORS)
    }

    const { email, nom, taux } = await req.json()
    const mail = String(email ?? '').trim().toLowerCase()
    const nomPropre = String(nom ?? '').trim()
    const part = Number(taux)

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) {
      return json({ ok: false, error: 'email_invalide' }, 400, CORS)
    }
    if (!nomPropre) return json({ ok: false, error: 'nom_requis' }, 400, CORS)
    if (!Number.isFinite(part) || part < 0 || part > 1) {
      return json({ ok: false, error: 'taux_invalide' }, 400, CORS)
    }

    // 3. Créer le compte, ou retrouver celui qui existe déjà.
    let userId: string | null = null
    const { data: invite, error: eInvite } = await admin.auth.admin.inviteUserByEmail(mail)

    if (eInvite) {
      // Réinviter une adresse connue est un cas normal — on récupère l'identifiant
      // plutôt que de renvoyer une erreur incompréhensible.
      const { data: liste } = await admin.auth.admin.listUsers()
      const existant = liste?.users?.find((x) => x.email?.toLowerCase() === mail)
      if (!existant) {
        console.error('inviteUserByEmail', eInvite)
        return json({ ok: false, error: 'invitation_impossible' }, 502, CORS)
      }
      userId = existant.id
    } else {
      userId = invite.user.id
    }

    // 4. Enregistrer le membre et déclencher l'e-mail de bienvenue.
    // `p_invite_par` est indispensable : cet appel se fait en service_role, or
    // `auth.uid()` est alors NUL. Sans lui, le contrôle « êtes-vous fondateur »
    // côté base échouait systématiquement, y compris pour un vrai fondateur.
    const { data: res, error: eRpc } = await admin.rpc('inviter_commercial', {
      p_user_id: userId,
      p_email: mail,
      p_nom: nomPropre,
      p_taux: part,
      p_invite_par: u.user.id,
    })
    if (eRpc) {
      console.error('inviter_commercial', eRpc)
      return json({ ok: false, error: 'enregistrement_impossible' }, 502, CORS)
    }

    return json(res ?? { ok: true }, 200, CORS)
  } catch (e) {
    console.error('inviter-membre', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  })
}
