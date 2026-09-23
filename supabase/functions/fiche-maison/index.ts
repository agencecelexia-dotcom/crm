// Edge Function : tout ce qu'on peut savoir d'une maison sans y aller.
//
// L'État publie gratuitement, sans clé, de quoi remplir la moitié d'un devis.
// Encore faut-il aller le chercher au bon endroit, et savoir les rattacher
// entre eux — c'est tout l'objet de cette fonction.
//
// LA CHAÎNE, ET SON PIVOT
//
// Le seul lien fiable entre les bases est le RNB, le Référentiel National des
// Bâtiments : il porte, pour chaque bâtiment, les identifiants des autres
// référentiels. On part donc de l'identifiant BD TOPO du bâtiment que
// l'artisan a TOUCHÉ sur la carte, on retrouve son jumeau RNB, et de là tout
// le reste.
//
//   BD TOPO cleabs → RNB → BDNB (matériaux, année, niveaux)
//                        → DPE ADEME (isolation, étiquette, surface)
//                        → GPU (zonage, et le périmètre des 500 m d'un
//                               monument historique)
//                        → Géorisques (aléa argile à l'adresse)
//                        → Cadastre (parcelle et sa contenance)
//
// POURQUOI CÔTÉ SERVEUR
//
// Cinq services interrogés pour une fiche. Les appeler depuis le navigateur
// demanderait cinq hôtes de plus dans la politique de sécurité, sans pouvoir
// ni réessayer proprement ni mettre en cache. Ici on peut faire les deux.
//
// AUCUN APPEL NE DOIT POUVOIR FAIRE ÉCHOUER LES AUTRES : tout passe par
// `allSettled` et un délai de garde. Une fiche à moitié remplie vaut mieux
// qu'une erreur.

const ORIGINES = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...(Deno.env.get('SITE_URL') ?? '').split(',').map((o) => o.trim()).filter(Boolean),
]

function cors(origin: string | null) {
  const ok =
    origin && (ORIGINES.includes(origin) || /^https:\/\/[\w-]+\.vercel\.app$/.test(origin))
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ORIGINES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  })
}

async function rpc(nom: string, params: unknown) {
  const cle = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${nom}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: cle, authorization: `Bearer ${cle}` },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`${nom} ${res.status}`)
  return await res.json()
}

/**
 * Un appel extérieur, avec délai de garde et réessais.
 *
 * Géorisques répond parfois 200 AVEC UN CORPS VIDE quand on l'interroge en
 * rafale — constaté. Un corps vide compte donc comme un échec et déclenche un
 * nouvel essai.
 */
async function lire(url: string, essais = 2, delaiMs = 8000): Promise<unknown> {
  for (let i = 0; i < essais; i++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), delaiMs)
      const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
      clearTimeout(t)
      if (!r.ok) throw new Error(String(r.status))
      const texte = await r.text()
      if (!texte.trim()) throw new Error('corps_vide')
      return JSON.parse(texte)
    } catch (e) {
      if (i === essais - 1) throw e
      await new Promise((r) => setTimeout(r, 600))
    }
  }
  return null
}

/**
 * Répare un texte doublement encodé.
 *
 * Le Géoportail de l'urbanisme renvoie « Ecole Nationale SupÃ©rieure » : ses
 * libellés sont de l'UTF-8 relu comme du latin-1, puis ré-encodé. Vérifié en
 * interrogeant apicarto directement — le défaut est chez eux, pas chez nous.
 *
 * On ne touche qu'aux chaînes qui portent la signature du défaut, et seulement
 * si la réparation donne quelque chose de lisible.
 */
function reparerTexte(v: string): string {
  if (!/[ÃÂ][\x80-\xBF]/.test(v)) return v
  try {
    const octets = Uint8Array.from([...v].map((c) => c.charCodeAt(0) & 0xff))
    const repare = new TextDecoder('utf-8', { fatal: true }).decode(octets)
    return repare
  } catch {
    return v
  }
}

/** Applique la réparation à toutes les chaînes d'une structure. */
function reparer<T>(v: T): T {
  if (typeof v === 'string') return reparerTexte(v) as unknown as T
  if (Array.isArray(v)) return v.map(reparer) as unknown as T
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) o[k] = reparer(x)
    return o as T
  }
  return v
}

const point = (lon: number, lat: number) =>
  encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }))

// ---------- Les sources ----------

/** Le RNB, pivot entre tous les référentiels. */
async function viaRnb(lat: number, lon: number, cleabs: string | null) {
  const d = 0.0009 // ≈ 100 m
  const bbox = [lon - d * 1.5, lat - d, lon + d * 1.5, lat + d].map((v) => v.toFixed(6)).join(',')
  const j = (await lire(
    `https://rnb-api.beta.gouv.fr/api/alpha/buildings/?bbox=${bbox}`,
  )) as { results?: { rnb_id: string; ext_ids?: { id: string; source: string }[] }[] }

  const liste = j?.results ?? []
  // On veut LE bâtiment que l'artisan a touché, pas son voisin : on l'apparie
  // sur son identifiant BD TOPO, le seul lien sûr.
  const bon = cleabs
    ? liste.find((b) => (b.ext_ids ?? []).some((e) => e.id === cleabs))
    : liste[0]
  if (!bon) return null

  return {
    rnb_id: bon.rnb_id,
    bdnb: (bon.ext_ids ?? []).find((e) => e.source === 'bdnb')?.id ?? null,
  }
}

/** La BDNB : matériaux, année, niveaux — ce qui change un devis d'enduit. */
async function viaBdnb(idConstruction: string) {
  const c = (await lire(
    `https://api.bdnb.io/v1/bdnb/donnees/batiment_construction?batiment_construction_id=eq.${idConstruction}&select=batiment_groupe_id`,
  )) as { batiment_groupe_id?: string }[]
  const groupe = c?.[0]?.batiment_groupe_id
  if (!groupe) return null

  const champs = [
    'annee_construction', 'nb_log', 'nb_niveau', 'surface_emprise_sol', 'hauteur_mean',
    'mat_mur_txt', 'mat_toit_txt', 'materiaux_structure_mur_exterieur',
    'pourcentage_surface_baie_vitree_exterieur', 'l_orientation_baie_vitree',
    'type_isolation_mur_exterieur', 'classe_bilan_dpe', 'alea_argile', 'l_parcelle_id',
    'presence_balcon', 'type_fermeture',
  ].join(',')

  const g = (await lire(
    `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet?batiment_groupe_id=eq.${groupe}&select=${champs}`,
  )) as Record<string, unknown>[]
  return g?.[0] ?? null
}

/**
 * Le DPE : isolation, étiquette, surface habitable — et l'historique des travaux.
 *
 * L'APPARIEMENT SE FAIT PAR IDENTIFIANT D'ADRESSE, pas par proximité. Chercher
 * le DPE le plus proche dans un rayon de cent mètres ramenait le voisin : sur
 * un chantier rue du Wasen, le service renvoyait « 85 Grand Rue ».
 *
 * Un piège s'y cache : l'identifiant du point porte le suffixe du bis ou du
 * ter — `68178_0200_00020_a` — que le DPE n'a pas. Il faut le retirer.
 */
async function viaDpe(lat: number, lon: number) {
  const champs = [
    'adresse_ban', 'date_etablissement_dpe', 'annee_construction', 'type_batiment',
    'surface_habitable_logement', 'hauteur_sous_plafond', 'etiquette_dpe', 'etiquette_ges',
    'qualite_isolation_murs', 'qualite_isolation_menuiseries', 'isolation_toiture',
    'qualite_isolation_plancher_haut_comble_perdu', 'type_energie_principale_chauffage',
    'cout_total_5_usages',
  ].join(',')
  const base = 'https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines'

  // 1) Par identifiant d'adresse : c'est la bonne maison, ou rien.
  let r: Record<string, unknown>[] = []
  let total = 0
  const inverse = (await lire(
    `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}`,
  ).catch(() => null)) as { features?: { properties?: { id?: string } }[] } | null
  const idBan = inverse?.features?.[0]?.properties?.id
  if (idBan) {
    // « 68178_0200_00020_a » désigne le 20 bis ; le DPE, lui, ne connaît que
    // « 68178_0200_00020 ».
    const tronque = idBan.replace(/_[a-z]$/i, '')
    const j = (await lire(
      `${base}?qs=${encodeURIComponent(`identifiant_ban:"${tronque}"`)}&size=4&select=${champs}`,
    ).catch(() => null)) as { total?: number; results?: Record<string, unknown>[] } | null
    r = j?.results ?? []
    total = j?.total ?? r.length
  }

  // 2) À défaut seulement, le plus proche — en le disant.
  let approche = false
  if (!r.length) {
    const j = (await lire(
      `${base}?geo_distance=${lon},${lat},120&size=3&select=${champs}`,
    )) as { total?: number; results?: Record<string, unknown>[] }
    r = j?.results ?? []
    total = j?.total ?? r.length
    approche = r.length > 0
  }
  if (!r.length) return null
  // Le plus récent d'abord : c'est l'état actuel du logement.
  r.sort((a, b) =>
    String(b.date_etablissement_dpe ?? '').localeCompare(String(a.date_etablissement_dpe ?? '')))
  return { total, recent: r[0], historique: r.slice(1), approche }
}

/**
 * Le périmètre des abords d'un monument historique.
 *
 * C'est la donnée la plus lourde de conséquences : à l'intérieur, l'Architecte
 * des Bâtiments de France impose les teintes et les matériaux, une déclaration
 * préalable est obligatoire, et le délai d'instruction s'allonge de deux mois.
 * Un ravalement chiffré sans le savoir est un chantier qui dérape.
 */
async function viaUrbanisme(lat: number, lon: number) {
  const g = point(lon, lat)
  const [zone, sup] = await Promise.allSettled([
    lire(`https://apicarto.ign.fr/api/gpu/zone-urba?geom=${g}`),
    lire(`https://apicarto.ign.fr/api/gpu/assiette-sup-s?geom=${g}`),
  ])

  const zoneP = zone.status === 'fulfilled'
    ? ((zone.value as { features?: { properties?: Record<string, unknown> }[] })?.features ?? [])[0]?.properties
    : undefined
  const sups = sup.status === 'fulfilled'
    ? ((sup.value as { features?: { properties?: Record<string, unknown> }[] })?.features ?? [])
    : []

  // ac1 = abords de monument historique, ac2 = site inscrit ou classé,
  // ac4 = secteur patrimonial remarquable. Tous appellent l'avis de l'ABF.
  const abf = sups.filter((f) =>
    ['ac1', 'ac2', 'ac4'].includes(String(f.properties?.suptype ?? '').toLowerCase()))

  return {
    zonage: zoneP?.libelle ?? null,
    zonage_libelle: zoneP?.libelong ?? null,
    reglement: zoneP?.nomfic ?? null,
    abf: abf.length > 0,
    abf_motifs: [...new Set(abf.map((f) => String(f.properties?.nomsuplitt ?? '')).filter(Boolean))]
      .slice(0, 5),
    servitudes: sups.length,
  }
}

/** Géorisques : l'aléa argile est donné À L'ADRESSE, pas seulement à la commune. */
async function viaRisques(lat: number, lon: number) {
  const j = (await lire(
    `https://www.georisques.gouv.fr/api/v1/resultats_rapport_risque?latlon=${lon},${lat}`,
    3,
  )) as Record<string, Record<string, Record<string, unknown>>>
  const n = j?.risquesNaturels
  if (!n) return null
  const dire = (k: string) =>
    (n[k]?.libelleStatutAdresse as string) ?? (n[k]?.libelleStatutCommune as string) ?? null
  return {
    argile: dire('retraitGonflementArgile'),
    seisme: dire('seisme'),
    inondation: dire('inondation'),
    rapport: (j as unknown as { url?: string }).url ?? null,
  }
}

/** La parcelle et sa contenance, à recopier dans une déclaration préalable. */
async function viaCadastre(lat: number, lon: number) {
  const j = (await lire(
    `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${point(lon, lat)}`,
  )) as { features?: { properties?: Record<string, unknown> }[] }
  const p = (j?.features ?? [])[0]?.properties
  if (!p) return null
  return { idu: p.idu ?? null, section: p.section ?? null, numero: p.numero ?? null,
           contenance: p.contenance ?? null, commune: p.nom_com ?? null }
}

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { token, cleabs, lat, lon, projet_id, rafraichir } = (await req.json()) ?? {}
    if (typeof token !== 'string' || typeof lat !== 'number' || typeof lon !== 'number') {
      return json({ ok: false, error: 'parametres_manquants' }, 400, CORS)
    }

    const valide = await rpc('token_artisan_valide', { p_token: token })
    if (valide !== true) return json({ ok: false, error: 'token_invalide' }, 403, CORS)

    // Ces données ne bougent pas d'un jour à l'autre : une maison de 1966 le
    // restera. On ne réinterroge que sur demande.
    if (cleabs && !rafraichir) {
      const cache = await rpc('fiche_batiment_by_token', { p_token: token, p_cleabs: cleabs })
      const c = cache as { trouvee?: boolean; donnees?: unknown; recupere_le?: string }
      if (c?.trouvee) {
        return json({ ok: true, cache: true, recupere_le: c.recupere_le, ...(c.donnees as object) }, 200, CORS)
      }
    }

    const rnb = await viaRnb(lat, lon, typeof cleabs === 'string' ? cleabs : null).catch(() => null)

    const [bdnb, dpe, urbanisme, risques, cadastre] = await Promise.allSettled([
      rnb?.bdnb ? viaBdnb(rnb.bdnb) : Promise.resolve(null),
      viaDpe(lat, lon),
      viaUrbanisme(lat, lon),
      viaRisques(lat, lon),
      viaCadastre(lat, lon),
    ])
    const val = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null)

    const donnees = {
      rnb_id: rnb?.rnb_id ?? null,
      bdnb: val(bdnb),
      dpe: val(dpe),
      urbanisme: val(urbanisme),
      risques: val(risques),
      cadastre: val(cadastre),
      // Ce qui a répondu, pour que l'écran ne présente pas une absence comme
      // une réponse : « pas de DPE connu » n'est pas « pas de DPE ».
      sources: {
        rnb: rnb != null,
        bdnb: bdnb.status === 'fulfilled' && bdnb.value != null,
        dpe: dpe.status === 'fulfilled' && dpe.value != null,
        urbanisme: urbanisme.status === 'fulfilled' && urbanisme.value != null,
        risques: risques.status === 'fulfilled' && risques.value != null,
        cadastre: cadastre.status === 'fulfilled' && cadastre.value != null,
      },
    }

    const propres = reparer(donnees)

    if (typeof cleabs === 'string' && cleabs) {
      await rpc('enregistrer_fiche_batiment', {
        p_cleabs: cleabs,
        p_projet_id: typeof projet_id === 'string' ? projet_id : null,
        p_donnees: propres,
      }).catch(() => undefined)
    }

    return json({ ok: true, cache: false, ...propres }, 200, CORS)
  } catch (e) {
    console.error('fiche-maison', e)
    return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 500, CORS)
  }
})
