import { describe, expect, it } from 'vitest'
import {
  ACTIONS_PONT,
  ETAPES_PONT,
  MOTIFS_PONT,
  RESULTATS_APPEL,
  SLOTS_PONT,
  specificationPont,
} from '../../src/features/artisans/specification-pont'

// La notice est le livrable du pont : c'est elle que l'artisan colle dans son
// assistant de code. Une valeur non substituée ne se voit pas à la lecture —
// elle se voit une semaine plus tard, quand rien ne marche chez lui.
const CTX = {
  societe: 'Batryx',
  tokenArtisan: 'aaaabbbbccccddddeeeeffff00001111',
  clePublique: 'pont_1234567890abcdef',
  secret: 'deadbeef'.repeat(8),
  urlWebhook: 'https://batryx.fr/api/celexia',
  supabaseUrl: 'https://exemple.supabase.co',
  cleAnon: 'anon-de-test',
}

describe('notice de branchement', () => {
  const notice = specificationPont(CTX)

  it('reporte chaque identifiant de l’artisan', () => {
    for (const v of [
      CTX.tokenArtisan,
      CTX.clePublique,
      CTX.secret,
      CTX.urlWebhook,
      CTX.cleAnon,
    ]) {
      expect(notice).toContain(v)
    }
  })

  it('donne les deux URL à appeler', () => {
    expect(notice).toContain(`${CTX.supabaseUrl}/rest/v1/rpc/get_espace_artisan`)
    expect(notice).toContain(`${CTX.supabaseUrl}/rest/v1/rpc/pont_entrant`)
  })

  it('énumère le vocabulaire imposé par la base', () => {
    for (const e of ETAPES_PONT) expect(notice).toContain(e)
    // Listes fermées côté SQL : une valeur absente de la notice serait
    // envoyée au hasard puis rejetée.
    for (const m of MOTIFS_PONT) expect(notice).toContain(m)
    for (const r of RESULTATS_APPEL) expect(notice).toContain(r)
    for (const s of SLOTS_PONT) expect(notice).toContain(s)
  })

  it('couvre les DIX actions de l’espace artisan, sans exception', () => {
    // C'est le point qui a manqué au premier jet : la notice ne couvrait que
    // statut, correction et abandon. Les sept autres actions n'avaient aucun
    // chemin depuis son CRM, ce qui l'obligeait à rouvrir le portail — soit
    // exactement la double saisie qu'on supprime.
    expect(ACTIONS_PONT).toHaveLength(10)
    for (const a of ACTIONS_PONT) expect(notice).toContain(`\`${a.type}\``)
  })

  it('donne une marche à suivre pour valider la connexion', () => {
    expect(notice).toContain('COMMENT ON TESTE')
    expect(notice).toContain('Tester la connexion')
    // Le ping doit être documenté côté réception, sinon son serveur créera
    // une fiche à chaque test.
    expect(notice).toContain('ping')
    expect(notice).toContain('ne rien créer')
  })

  it('exige les deux dédulications, entrante et sortante', () => {
    expect(notice).toContain('Déduplique sur `evenement_id`')
    expect(notice).toContain('p_evenement_id` doit être **stable et unique')
  })

  it('signale l’URL manquante au lieu de laisser un trou', () => {
    // Sans webhook, la notice reste utilisable : le sens « je reçois » est
    // simplement en attente d'une valeur, et elle le dit.
    const sansUrl = specificationPont({ ...CTX, urlWebhook: null })
    expect(sansUrl).toContain('URL À DÉFINIR')
    // Et surtout, pas de `null` recopié tel quel dans le tableau des
    // identifiants : l'artisan croirait à une valeur.
    expect(sansUrl).not.toContain('| `null` |')
    expect(sansUrl).not.toContain(CTX.urlWebhook)
  })
})
