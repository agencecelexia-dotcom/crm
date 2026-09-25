// Banc de justesse du métré — à la demande, en lecture seule.
//
//   npx jiti scripts/banc-metre.ts [nom-du-rapport]
//
// POURQUOI
//
// La justesse de l'outil n'avait jamais été mesurée. Les devis réels la
// donnent : `devis_ligne_ref` garde les quantités que les artisans ont
// chiffrées, chantier par chantier. On les compare à ce que l'écran affiche
// — mêmes modules, mêmes règles, même débord par défaut —, et l'on rapporte
// l'écart. On ne corrige rien en douce : une quantité d'artisan inclut
// souvent des chutes, ou ne porte que sur une partie de l'ouvrage.
//
// CE QU'IL FAIT
//
// 1. Pour chaque chantier chiffré : la maison (même identification que
//    l'écran), puis le toit (LiDAR), les façades et la parcelle.
// 2. Pour les chantiers actifs : le taux de lien officiel (RNB), les scores
//    d'adresse, et les cas où l'ANCIENNE règle — le bâtiment dont le centre
//    était le plus proche du point d'adresse — désignait une autre maison.
//
// Rien n'est écrit en base. Les appels à l'IGN sont espacés de quatre
// secondes, et les toits déjà mesurés sont relus dans le cache de l'outil.
// Le rapport ne cite pas les adresses des clients : commune et identifiant.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  autour,
  centreDe,
  distancePolygone,
  identifierMaison,
  lireJson,
  type BatimentBd,
  type Reponse,
} from '../supabase/functions/_batiment.ts'
import { mesurerToit, type ResultatToit } from '../supabase/functions/_calcul-toit.ts'
import {
  aire,
  centre,
  distance,
  empriseAvecDebord,
  facades,
  longueur,
  longueurAccolee,
  surfaceReelle,
  type Point,
} from '../src/features/metre/geometrie.ts'
import { lectureParPans, mesureFacade, penteRetenue, type Toiture } from '../src/features/metre/toiture.ts'

// ---------- Accès en lecture ----------

const env = Object.fromEntries(
  readFileSync('.env.secrets.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]
    }),
)

async function sql<T>(requete: string): Promise<T[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.SUPABASE_SBP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: requete }),
  })
  if (!r.ok) throw new Error(`sql ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const ESPACEMENT_MS = 5000

/**
 * Les services publics étranglent par adresse IP : une panne passagère ne
 * doit pas finir en « erreur » dans le rapport, comme au premier passage où
 * toute la fin de la liste y était passée.
 */
async function avecReessais<T>(f: () => Promise<T>, essais = 3): Promise<T> {
  let derniere: unknown
  for (let i = 0; i < essais; i++) {
    try {
      return await f()
    } catch (e) {
      derniere = e
      await pause(20000 * (i + 1))
    }
  }
  throw derniere
}

// ---------- Les quantités des artisans ----------

interface Ligne {
  metier: string
  unite: string
  quantite: number
  designation: string
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const TOIT = /(couverture|toiture|tuile|ardoise|bac acier|demoussage|hydrofuge|sous-toiture|voligeage|liteaux|charpente|shingle|bardeaux)/
const PAS_TOIT = /(reprise|remplacement des elements|marche|escalier|dalle|joint|bardage|enduit|crepi|gobetis|piquage|facade|ponctuel|partiel|%)/
const FACADE = /(facade|ravalement|enduit|crepi|gobetis|piquage|peinture|nettoyage|hydrofuge|impermeabilisation|isolation thermique|\bite\b|sous-enduit|trame|bardage|lasure|isolant)/
const PAS_FACADE = /(garde-corps|balcon|carrelage|etancheite|corniche|fissure|rebouchage|joint|ponctuel|soubassement|toit)/
const CLOTURE = /(cloture|grillage|panneau|occultant|rigide|soubassement|voile|brise-vue)/

/** La quantité de l'ouvrage entier : celle que le devis répète sur le plus de lignes (à égalité, la plus grande). */
function dominante(lignes: Ligne[]): number | null {
  const compte = new Map<number, number>()
  for (const l of lignes) if (l.quantite > 0) compte.set(l.quantite, (compte.get(l.quantite) ?? 0) + 1)
  let meilleure: [number, number] | null = null
  for (const [q, n] of compte) if (!meilleure || n > meilleure[1] || (n === meilleure[1] && q > meilleure[0])) meilleure = [q, n]
  return meilleure?.[0] ?? null
}

function quantitesArtisan(lignes: Ligne[]) {
  const de = (metiers: RegExp, unite: string, oui: RegExp, non?: RegExp) =>
    lignes.filter(
      (l) => metiers.test(norm(l.metier)) && l.unite === unite && oui.test(norm(l.designation)) && !(non && non.test(norm(l.designation))),
    )
  const maxi = (ls: Ligne[]) => (ls.length ? Math.max(...ls.map((l) => l.quantite)) : null)
  const ml = (re: RegExp) => maxi(lignes.filter((l) => l.unite === 'ml' && re.test(norm(l.designation))))
  return {
    toit: dominante(de(/(toiture|couverture)/, 'm2', TOIT, PAS_TOIT)),
    facade: dominante(de(/(facade|ravalement|isolation)/, 'm2', FACADE, PAS_FACADE)),
    cloture: dominante(de(/cloture/, 'ml', CLOTURE)),
    faitage: ml(/fait(age|iere)/),
    rive: ml(/\brives?\b/),
    gouttiere: ml(/(gouttiere|chenea)/),
  }
}

// ---------- Ce que le devis couvre vraiment ----------
//
// UN DEVIS NE PORTE PAS TOUJOURS SUR L'OUVRAGE ENTIER. Le premier passage du
// banc l'a montré : « une partie de sa toiture orientée nord, environ 80 m² »,
// « la partie basse de la façade uniquement », « une façade d'environ 60 m² ».
// Comparer ces quantités au bâtiment entier mesurerait la portée du devis,
// pas la justesse de l'outil. On lit donc le dossier : ce qu'il dit de la
// portée, et l'estimation que le client y a donnée.

const PARTIEL =
  /(partie|partiel|une seule facade|une facade|un seul mur|un mur|pignon|cote rue|orientee? (au )?(nord|sud|est|ouest)|versant|un pan\b|partie basse|bas de (la )?facade|soubassement|au-dessus|garage|annexe|abri|veranda|extension|appentis|dependance|auvent|carport|balcon|fuite|ponctuel)/
const ENTIER =
  /(ensemble de la|entierement|totalite|toute la (toiture|facade|maison|couverture)|toutes les facades|refection (complete|totale)|integral|tous les murs|quatre facades|4 facades)/

type Portee = 'entier' | 'partiel' | 'inconnue'

function portee(description: string | null, lignes: Ligne[]): Portee {
  const texte = norm([description ?? '', ...lignes.map((l) => l.designation)].join(' '))
  if (ENTIER.test(texte)) return 'entier'
  if (PARTIEL.test(texte)) return 'partiel'
  return 'inconnue'
}

/** « toiture de 80m2 », « façade d'environ 60 m² » : l'estimation du client, quand le dossier la donne. */
function estimationDuClient(description: string | null, sujet: RegExp): number | null {
  const texte = norm(description ?? '')
  for (const m of texte.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²|metres? carres?)/g)) {
    const avant = texte.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0)
    if (sujet.test(avant)) return Number(m[1].replace(',', '.'))
  }
  return null
}

/**
 * Une quantité décimale identique sur deux chantiers différents du même
 * artisan n'est pas une mesure : elle a été recopiée (88,25 m² le même jour à
 * Châlonvillars et au Pont-de-Beauvoisin).
 */
function quantitesRecopiees(chantiers: Chantier[]): Set<string> {
  const vus = new Map<string, Set<string>>()
  for (const c of chantiers) {
    for (const l of c.lignes) {
      const q = Number(l.quantite)
      if (!(q >= 20) || Number.isInteger(q)) continue
      const cle = `${c.artisan_id}|${l.unite}|${q}`
      const projets = vus.get(cle) ?? new Set<string>()
      projets.add(c.projet_id)
      vus.set(cle, projets)
    }
  }
  return new Set([...vus].filter(([, p]) => p.size > 1).map(([cle]) => cle))
}

// ---------- Ce que l'écran afficherait ----------

/** Le débord par défaut de l'écran (panneau-batiment.tsx). */
const DEBORD_DEFAUT_M = 0.4

async function toitDe(cleabs: string, contour: Point[], frais: boolean): Promise<ResultatToit | Toiture | null> {
  // Le cache de l'outil d'abord : même calcul, et l'IGN épargné — sauf quand
  // il faut ce que le cache ne garde pas (la lecture pan par pan).
  if (frais) {
    await pause(ESPACEMENT_MS)
    return mesurerToit(contour).catch(() => null)
  }
  const [c] = await sql<Record<string, unknown>>(
    `select couvert, motif, pente_pct as pente, incertitude, pixels, versants, source, murs,
            hauteur_gouttiere, hauteur_faitage, version
       from toiture_mesuree where cleabs = '${cleabs.replace(/'/g, '')}' and version >= 2`,
  )
  if (c) {
    return {
      ok: true,
      ...c,
      pente: c.pente != null ? Number(c.pente) : null,
      incertitude: c.incertitude != null ? Number(c.incertitude) : null,
      hauteur_gouttiere: c.hauteur_gouttiere != null ? Number(c.hauteur_gouttiere) : null,
      hauteur_faitage: c.hauteur_faitage != null ? Number(c.hauteur_faitage) : null,
      fiable: !!c.couvert && !c.motif,
    } as Toiture
  }
  await pause(ESPACEMENT_MS)
  return mesurerToit(contour).catch(() => null)
}

async function parcelleDe(p: Point): Promise<{ perimetre: number; surface: number } | null> {
  // Le paramètre BBOX standard, comme pour le bâti : le filtre CQL de cette
  // couche ne connaît pas l'attribut « geometrie » (réponse 400), d'où
  // « aucune parcelle retrouvée » au premier passage.
  const d = 15 / 111320
  const dl = 15 / (111320 * Math.cos((p[1] * Math.PI) / 180))
  const cadre = [p[0] - dl, p[1] - d, p[0] + dl, p[1] + d].map((v) => v.toFixed(7)).join(',')
  const j = (await lireJson(
    'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
      '&TYPENAMES=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&SRSNAME=CRS:84&OUTPUTFORMAT=application/json' +
      `&COUNT=30&BBOX=${cadre},CRS:84`,
  ).catch(() => null)) as { features?: { geometry: { type: string; coordinates: unknown } }[] } | null
  for (const f of j?.features ?? []) {
    const g = f.geometry
    const brut = (g.type === 'MultiPolygon' ? (g.coordinates as number[][][][])[0][0] : (g.coordinates as number[][][])[0]) ?? []
    const anneau = brut.map((q) => [q[0], q[1]] as Point)
    // La parcelle de la maison est celle qui CONTIENT son centre.
    if (anneau.length >= 3 && distancePolygone(p, anneau) === 0) {
      return { perimetre: longueur(anneau, true), surface: aire(anneau) }
    }
  }
  return null
}

function ecranDe(contour: Point[], t: ResultatToit | Toiture | null, voisins: Point[][] = []) {
  const emprise = aire(contour)
  const perimetre = longueur(contour, true)
  const toit = t as Toiture | null
  const { pente, source } = penteRetenue({ saisie: null, mesuree: toit, deduite: null })
  const empriseToit = empriseAvecDebord(emprise, perimetre, DEBORD_DEFAUT_M)
  const surfaceToit = pente != null ? surfaceReelle(empriseToit, pente) : null
  // La règle candidate : pan par pan (lot 3), tant que le banc ne l'a pas validée.
  const parPans = lectureParPans(toit)
  const surfaceToitParPans = parPans.pente != null ? surfaceReelle(empriseToit, parPans.pente) : null
  const cotes = facades(contour).map((f) => ({ f, m: mesureFacade(f, toit) }))
  const mesures = cotes.filter((c) => c.m)
  const complet = mesures.length === cotes.length && cotes.length > 0
  const total = complet ? mesures.reduce((s, c) => s + c.m!.surface, 0) : null
  const horsAccoles = complet
    ? mesures.reduce((s, c) => {
        const touchee = c.f.pans.reduce((t, p) => t + longueurAccolee(p, voisins), 0)
        return s + c.m!.surface * Math.max(0, 1 - touchee / c.f.longueur)
      }, 0)
    : null
  const plusGrand = mesures.length ? Math.max(...mesures.map((c) => c.m!.surface)) : null
  // Le repère LiDAR, pour mémoire : la géométrie des voisins l'a remplacé.
  const murs = toit?.murs ? `${toit.murs.filter((m) => m.accole).length}/${toit.murs.length}` : null
  return { emprise, perimetre, pente, source, fiable: !!toit?.fiable, surfaceToit, penteParPans: parPans.pente, surfaceToitParPans, pans: parPans.pans, facadeTotale: total, facadeHorsAccoles: horsAccoles, facadePlusGrande: plusGrand, murs }
}

// ---------- L'ancienne règle, pour mesurer ce qu'on a gagné ----------

async function ancienneRegle(d: { adresse: string | null; codePostal: string | null; ville: string | null }): Promise<string | null> {
  // Ce que faisait le navigateur : la requête brute, le premier résultat, puis
  // le bâtiment dont le centre est à moins de 25 m — le plus proche.
  const q = [d.adresse, d.codePostal, d.ville].filter(Boolean).join(' ').trim()
  if (!q) return null
  const j = (await lireJson(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`).catch(() => null)) as {
    features?: { properties: { type?: string }; geometry: { coordinates: Point } }[]
  } | null
  const f = j?.features?.[0]
  if (!f || f.properties.type !== 'housenumber') return null
  const p = f.geometry.coordinates
  const bats: BatimentBd[] = await autour(p, 40).catch(() => [])
  let meilleur: { b: BatimentBd; d: number } | null = null
  for (const b of bats) {
    const c = centre(b.contour)
    if (!c) continue
    const dist = distance(c, p)
    if (!meilleur || dist < meilleur.d) meilleur = { b, d: dist }
  }
  return meilleur && meilleur.d < 25 ? meilleur.b.cleabs : null
}

// ---------- Le banc ----------

interface Chantier {
  affectation_id: string
  artisan_id: string
  description: string | null
  projet_id: string
  client_adresse: string | null
  client_code_postal: string | null
  client_ville: string | null
  latitude: number | null
  longitude: number | null
  lignes: Ligne[]
}

const pct = (outil: number | null, artisan: number | null) =>
  outil != null && artisan != null && artisan > 0 ? ((outil - artisan) / artisan) * 100 : null
const f0 = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(n)))
const fpct = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : ''}${Math.round(n)} %`)
const mediane = (v: number[]) => {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const resume = (ecarts: (number | null)[]) => {
  const v = ecarts.filter((x): x is number => x != null).map(Math.abs)
  if (!v.length) return 'aucune comparaison'
  const dans = (s: number) => Math.round((v.filter((x) => x <= s).length / v.length) * 100)
  return `${v.length} comparaisons · écart médian ${Math.round(mediane(v)!)} % · ${dans(10)} % à ±10 % · ${dans(20)} % à ±20 %`
}

const nomRapport = process.argv[2] ?? `${new Date().toISOString().slice(0, 10)}`
const lignesRapport: string[] = []
const ecrire = (s = '') => {
  lignesRapport.push(s)
  console.log(s)
}
/**
 * Le rapport s'écrit après chaque partie : une coupure réseau pendant la
 * seconde ne doit pas faire perdre la première (un quart d'heure d'appels).
 */
const sauver = () => {
  mkdirSync('scripts/banc-metre', { recursive: true })
  writeFileSync(`scripts/banc-metre/${nomRapport}.md`, lignesRapport.join('\n') + '\n')
}

const chantiers = await sql<Chantier>(`
  select a.id as affectation_id, a.artisan_id, p.description, p.id as projet_id,
         p.client_adresse, p.client_code_postal, p.client_ville, p.latitude, p.longitude,
         json_agg(json_build_object('metier', coalesce(l.metier, ''), 'unite', l.unite, 'quantite', l.quantite,
                                    'designation', l.designation) order by l.position) as lignes
    from devis_ligne_ref l
    join affectations a on a.id = l.affectation_id
    join projets p on p.id = a.projet_id
   where p.deleted_at is null
   group by a.id, a.artisan_id, p.id
   order by p.client_ville`)

ecrire(`# Banc de justesse du métré — ${nomRapport}`)
ecrire()
ecrire(`${chantiers.length} devis de référence. Débord par défaut : ${DEBORD_DEFAUT_M * 100} cm. Pente : celle que l'écran retient (mesurée et fiable, sinon aucune).`)
ecrire()

const parProjet = new Map<string, { maison: Reponse; ecran: ReturnType<typeof ecranDe> | null; parcelle: Awaited<ReturnType<typeof parcelleDe>> }>()
const recopiees = quantitesRecopiees(chantiers)

/** Une comparaison : l'outil contre l'artisan, et ce qu'on sait de la portée du devis. */
interface Comparaison {
  portee: Portee
  recopiee: boolean
  ecarts: (number | null)[]
  ligne: string
}
const comparaisonsToit: Comparaison[] = []
const comparaisonsFacade: Comparaison[] = []
const lignesCloture: string[] = []
const lignesLineaires: string[] = []
const ratiosCloture: number[] = []

/** La progression, sur la sortie d'erreur : le rapport, lui, reste propre. */
const suivi = (s: string) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`)

let rang = 0
for (const c of chantiers) {
  rang++
  const lignes = c.lignes.map((l) => ({ ...l, quantite: Number(l.quantite) }))
  const q = quantitesArtisan(lignes)
  if (q.toit == null && q.facade == null && q.cloture == null && q.faitage == null && q.rive == null) continue
  const etiquette = `${c.client_ville ?? '?'} (${c.projet_id.slice(0, 8)})`
  const laPortee = portee(c.description, lignes)
  const recopiee = (quantite: number | null, unite: string) =>
    quantite != null && recopiees.has(`${c.artisan_id}|${unite}|${quantite}`)

  let fiche = parProjet.get(c.projet_id)
  if (!fiche) {
    const { reponse } = await avecReessais(() =>
      identifierMaison({
        adresse: c.client_adresse,
        codePostal: c.client_code_postal,
        ville: c.client_ville,
        point: c.longitude != null && c.latitude != null ? [Number(c.longitude), Number(c.latitude)] : null,
      }),
    ).catch(() => ({ reponse: null as unknown as Reponse }))
    let ecran = null
    let parcelle = null
    if (reponse?.principal) {
      const contour = reponse.principal.contour as Point[]
      // Les bâtiments voisins disent quels murs sont accolés.
      const voisins = q.facade != null
        ? (await autour(centreDe({ contour } as BatimentBd), 40).catch(() => []))
            .filter((b) => b.cleabs !== reponse.principal!.cleabs)
            .map((b) => b.contour as Point[])
        : []
      ecran = ecranDe(contour, await toitDe(reponse.principal.cleabs, contour, q.toit != null), voisins)
      if (q.cloture != null) parcelle = await parcelleDe(centreDe({ contour } as BatimentBd))
    }
    fiche = { maison: reponse, ecran, parcelle }
    parProjet.set(c.projet_id, fiche)
    suivi(`devis ${rang}/${chantiers.length} ${c.client_ville ?? '?'} → ${reponse?.confiance ?? 'erreur'}`)
    await pause(ESPACEMENT_MS)
  }
  const { maison, ecran, parcelle } = fiche
  const maisonTxt = maison ? `${maison.confiance}${maison.methode ? ` (${maison.methode})` : ''}` : 'erreur'
  const porteeTxt = (r: boolean) => (r ? 'recopiée' : laPortee)

  if (q.toit != null) {
    const e = pct(ecran?.surfaceToit ?? null, q.toit)
    const ep = pct(ecran?.surfaceToitParPans ?? null, q.toit)
    const dit = estimationDuClient(c.description, /(toit|toiture|couverture)/)
    const r = recopiee(q.toit, 'm2')
    const pans = ecran?.pans?.map((p) => `${p.orientation} ${p.pente}`).join(', ') || '—'
    comparaisonsToit.push({
      portee: laPortee,
      recopiee: r,
      ecarts: [e, ep],
      ligne: `| ${etiquette} | ${maisonTxt} | ${porteeTxt(r)} | ${f0(q.toit)} | ${f0(dit)} | ${f0(ecran?.surfaceToit)} (${fpct(e)}) | ${f0(ecran?.surfaceToitParPans)} (${fpct(ep)}) | ${ecran?.pente ?? '—'} / ${ecran?.penteParPans ?? '—'} | ${pans} |`,
    })
  }
  if (q.facade != null) {
    const e = pct(ecran?.facadeTotale ?? null, q.facade)
    const ec = pct(ecran?.facadePlusGrande ?? null, q.facade)
    const dit = estimationDuClient(c.description, /(facade|mur|ravalement|crepi|enduit|ite\b|isolation)/)
    const r = recopiee(q.facade, 'm2')
    comparaisonsFacade.push({
      portee: laPortee,
      recopiee: r,
      ecarts: [e, ec],
      ligne: `| ${etiquette} | ${maisonTxt} | ${porteeTxt(r)} | ${f0(q.facade)} | ${f0(dit)} | ${f0(ecran?.facadeTotale)} (${fpct(e)}) | ${f0(ecran?.facadePlusGrande)} (${fpct(ec)}) | ${ecran?.murs ?? '—'} |`,
    })
  }
  if (q.cloture != null) {
    const r = parcelle ? q.cloture / parcelle.perimetre : null
    if (r != null) ratiosCloture.push(r)
    lignesCloture.push(
      `| ${etiquette} | ${maisonTxt} | ${f0(q.cloture)} | ${f0(parcelle?.perimetre)} | ${r == null ? '—' : `${Math.round(r * 100)} %`} |`,
    )
  }
  if (q.faitage != null || q.rive != null || q.gouttiere != null) {
    lignesLineaires.push(`| ${etiquette} | ${f0(q.faitage)} | ${f0(q.rive)} | ${f0(q.gouttiere)} | ${f0(ecran?.perimetre)} |`)
  }
}

/** Les comparaisons qui disent quelque chose de l'outil : ouvrage entier (ou portée inconnue), quantité mesurée. */
const probantes = (l: Comparaison[]) => l.filter((x) => x.portee !== 'partiel' && !x.recopiee)
const partielles = (l: Comparaison[]) => l.filter((x) => x.portee === 'partiel' && !x.recopiee)

ecrire('## Toiture')
ecrire()
ecrire(
  `${comparaisonsToit.length} devis de toiture : ${probantes(comparaisonsToit).length} sur l’ouvrage entier ou de portée inconnue, ${partielles(comparaisonsToit).length} partiels selon le dossier, ${comparaisonsToit.filter((x) => x.recopiee).length} à quantité recopiée d’un autre chantier.`,
)
ecrire()
ecrire(`Ouvrage entier — règle actuelle (pente médiane) : ${resume(probantes(comparaisonsToit).map((x) => x.ecarts[0]))}`)
ecrire(`Ouvrage entier — règle pan par pan (candidate) : ${resume(probantes(comparaisonsToit).map((x) => x.ecarts[1]))}`)
ecrire()
ecrire('| Chantier | Maison | Portée | Artisan (m²) | Dit (m²) | Actuelle (m²) | Pan par pan (m²) | Pente act. / éq. | Pans |')
ecrire('|---|---|---|---|---|---|---|---|---|')
comparaisonsToit.forEach((x) => ecrire(x.ligne))
ecrire()
ecrire('## Façades')
ecrire()
ecrire(
  `${comparaisonsFacade.length} devis de façade : ${probantes(comparaisonsFacade).length} sur l’ouvrage entier ou de portée inconnue, ${partielles(comparaisonsFacade).length} partiels, ${comparaisonsFacade.filter((x) => x.recopiee).length} recopiés.`,
)
ecrire()
ecrire(`Ouvrage entier — tous les côtés : ${resume(probantes(comparaisonsFacade).map((x) => x.ecarts[0]))}`)
ecrire(`Partiels — le plus grand côté : ${resume(partielles(comparaisonsFacade).map((x) => x.ecarts[1]))}`)
ecrire()
ecrire("Le repère « mur accolé » n'entre plus dans ces totaux : au premier passage, il écartait tous les murs d'une maison isolée (Le Thor).")
ecrire()
ecrire('| Chantier | Maison | Portée | Artisan (m²) | Dit (m²) | Tous les côtés | Plus grand côté | Murs accolés |')
ecrire('|---|---|---|---|---|---|---|---|')
comparaisonsFacade.forEach((x) => ecrire(x.ligne))
ecrire()
ecrire('## Clôture')
ecrire()
ecrire(
  ratiosCloture.length
    ? `Longueur de l'artisan rapportée au périmètre de la parcelle : médiane ${Math.round(mediane(ratiosCloture)! * 100)} % (${ratiosCloture.length} parcelles). L'outil ne propose pas encore de longueur de clôture (lot 3).`
    : 'Aucune parcelle retrouvée.',
)
ecrire()
ecrire('| Chantier | Maison | Artisan (ml) | Périmètre parcelle (m) | Part |')
ecrire('|---|---|---|---|---|')
lignesCloture.forEach((l) => ecrire(l))
ecrire()
ecrire('## Linéaires de toiture')
ecrire()
ecrire("Faîtage, rives et gouttières ne sont pas encore mesurés par l'outil (lot 3) : les quantités des artisans servent de référence.")
ecrire()
ecrire('| Chantier | Faîtage (ml) | Rive (ml) | Gouttière (ml) | Périmètre au sol (m) |')
ecrire('|---|---|---|---|---|')
lignesLineaires.forEach((l) => ecrire(l))
ecrire()

sauver()

// ---------- Identification sur les chantiers actifs ----------

const actifs = await sql<{ id: string; client_adresse: string | null; client_code_postal: string | null; client_ville: string | null; latitude: number | null; longitude: number | null }>(`
  select id, client_adresse, client_code_postal, client_ville, latitude, longitude
    from projets
   where deleted_at is null and statut not in ('mort', 'termine', 'perdu')
     and client_adresse ~ '\\d'
   order by created_at desc
   limit 100`)

const stats = new Map<string, number>()
const scores: number[] = []
const autresMaisons: string[] = []
let rnb = 0
for (const p of actifs) {
  const dossier = {
    adresse: p.client_adresse,
    codePostal: p.client_code_postal,
    ville: p.client_ville,
    point: p.longitude != null && p.latitude != null ? ([Number(p.longitude), Number(p.latitude)] as Point) : null,
  }
  const { reponse } = await avecReessais(() => identifierMaison(dossier)).catch(() => ({ reponse: null as unknown as Reponse }))
  const cle = reponse ? `${reponse.confiance}${reponse.methode ? ` · ${reponse.methode}` : ''}` : 'erreur'
  stats.set(cle, (stats.get(cle) ?? 0) + 1)
  if (reponse?.methode === 'rnb') rnb++
  if (reponse?.score != null && reponse.numero_saisi == null) scores.push(reponse.score)
  const ancienne = await ancienneRegle(dossier)
  suivi(`actif ${stats.size ? [...stats.values()].reduce((a, b) => a + b, 0) : 0}/${actifs.length} ${p.client_ville ?? '?'} → ${cle}`)
  if (reponse?.principal && ancienne && ancienne !== reponse.principal.cleabs) {
    autresMaisons.push(`${p.client_ville ?? '?'} (${p.id.slice(0, 8)}) — nouvelle : ${reponse.confiance}`)
  }
  await pause(ESPACEMENT_MS / 2)
}

ecrire(`## Identification — ${actifs.length} chantiers actifs à adresse numérotée`)
ecrire()
ecrire(`Maison reliée par le RNB : ${rnb} sur ${actifs.length}.`)
ecrire()
for (const [k, n] of [...stats.entries()].sort((a, b) => b[1] - a[1])) ecrire(`- ${k} : ${n}`)
ecrire()
const s = [...scores].sort((a, b) => a - b)
const q = (x: number) => s[Math.min(s.length - 1, Math.floor(s.length * x))]
ecrire(
  s.length
    ? `Scores d'adresse (numéro retrouvé) : 10e centile ${q(0.1).toFixed(2)}, médiane ${q(0.5).toFixed(2)} ; sous 0,8 : ${s.filter((x) => x < 0.8).length}, sous 0,7 : ${s.filter((x) => x < 0.7).length} sur ${s.length}.`
    : 'Aucun score.',
)
ecrire()
ecrire(`L'ancienne règle (centre le plus proche à moins de 25 m) désignait une AUTRE maison dans ${autresMaisons.length} cas :`)
ecrire()
autresMaisons.forEach((l) => ecrire(`- ${l}`))
ecrire()
ecrire('## Second avis Google Solar')
ecrire()
ecrire('Non évalué : la clé API n’est pas encore configurée.')

sauver()
console.log(`\n→ scripts/banc-metre/${nomRapport}.md`)
