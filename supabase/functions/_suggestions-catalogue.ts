type Objet = Record<string, unknown>
const objet = (v: unknown): v is Objet => !!v && typeof v === 'object' && !Array.isArray(v)
const libelle = (v: string) => v.normalize('NFKC').trim().toLocaleLowerCase('fr').replace(/\s+/g, ' ')
const unite = (v: string) => libelle(v).replace('²', '2').replace('³', '3')

/** Retire tous les montants et sources déclarés par le modèle. Un identifiant
 * ne peut désigner qu'un ouvrage réellement fourni, dans la même unité.
 * Les prix sont ensuite rattachés par garnir_lignes_by_token, côté SQL. */
export function preparerSuggestionsCatalogue(input: unknown, bibliotheque: unknown) {
  const catalogue = Array.isArray(bibliotheque) ? bibliotheque.filter(objet) : []
  const brut = objet(input) ? input : {}
  const lignes = (Array.isArray(brut.lignes) ? brut.lignes : []).filter(objet)
    .filter(l => typeof l.designation === 'string' && l.designation.trim())
    .slice(0, 20)
    .map(l => {
      const designation = String(l.designation).trim().slice(0, 500)
      const u = typeof l.unite === 'string' && l.unite.trim() ? l.unite.trim().slice(0, 30) : 'u'
      const prix = catalogue.find(p => p.id === l.prix_id && typeof p.designation === 'string'
        && libelle(p.designation) === libelle(designation)
        && typeof p.unite === 'string' && unite(p.unite) === unite(u))
      return {
        designation, unite: u,
        quantite: typeof l.quantite === 'number' && Number.isFinite(l.quantite) && l.quantite > 0 && l.quantite <= 10_000_000 ? l.quantite : 1,
        ...(prix && typeof prix.id === 'string' ? { prix_id: prix.id } : {}),
        pourquoi: typeof l.pourquoi === 'string' ? l.pourquoi.slice(0, 500) : '',
      }
    })
  const manques = (Array.isArray(brut.manques) ? brut.manques : []).filter((v): v is string => typeof v === 'string').slice(0, 3).map(v => v.slice(0, 500))
  return { lignes, manques }
}
