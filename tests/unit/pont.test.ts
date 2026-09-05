import { describe, expect, it } from 'vitest'
import {
  ETAPES_PONT,
  MOTIFS_PONT,
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
    // Liste fermée côté SQL (`origine_du_motif`, 0079) : un motif absent de la
    // notice serait envoyé au hasard puis rejeté.
    for (const m of MOTIFS_PONT) expect(notice).toContain(m)
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
