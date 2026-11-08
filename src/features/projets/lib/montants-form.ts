import type { ProjetInput } from '@/types/database'

type Montants = Pick<ProjetInput,
  'montant_devis' | 'montant_devis_signe' | 'estimation_interne' | 'date_signature' | 'taux_commission'>

export type ChampsMontants = Record<keyof Montants, string>

export function champsMontants(projet: Montants): ChampsMontants {
  return {
    montant_devis: projet.montant_devis?.toString() ?? '',
    montant_devis_signe: projet.montant_devis_signe?.toString() ?? '',
    estimation_interne: projet.estimation_interne?.toString() ?? '',
    date_signature: projet.date_signature?.slice(0, 10) ?? '',
    taux_commission: String(Number(((projet.taux_commission ?? 0.1) * 100).toFixed(6))),
  }
}

/** Les champs non édités n'entrent jamais dans le PATCH, même si une signature
 * externe est arrivée depuis l'ouverture du formulaire. */
export function patchMontants(projet: Montants, modifications: Partial<ChampsMontants>): Partial<Montants> {
  const patch: Partial<Montants> = {}
  for (const champ of Object.keys(modifications) as (keyof ChampsMontants)[]) {
    const texte = modifications[champ]!
    if (champ === 'date_signature') {
      const date = texte || null
      if (date !== (projet.date_signature?.slice(0, 10) ?? null)) patch.date_signature = date
      continue
    }
    const nombre = parseFloat(texte.replace(',', '.'))
    if (champ === 'taux_commission') {
      const taux = Number.isFinite(nombre) && nombre >= 0 ? nombre / 100 : 0.1
      if (Math.abs(taux - (projet.taux_commission ?? 0.1)) > 1e-9) patch.taux_commission = taux
      continue
    }
    const valeur = Number.isFinite(nombre) ? nombre : null
    const avant = projet[champ] ?? null
    if (typeof valeur === 'number' && typeof avant === 'number'
      ? Math.abs(valeur - avant) > 1e-9
      : valeur !== avant) patch[champ] = valeur
  }
  return patch
}
