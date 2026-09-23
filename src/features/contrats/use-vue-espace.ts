import { useSearchParams } from 'react-router-dom'

import { ECRANS, type VueEspace } from './ecrans-espace'

/** Lit l'écran courant depuis l'URL — le retour arrière doit y ramener. */
export function useVueEspace(): [VueEspace, (v: VueEspace) => void] {
  const [params, setParams] = useSearchParams()
  const brut = params.get('vue')
  const vue = (ECRANS.some((e) => e.cle === brut) ? brut : 'chantiers') as VueEspace

  function aller(v: VueEspace) {
    setParams(
      (prec) => {
        const suite = new URLSearchParams(prec)
        if (v === 'chantiers') suite.delete('vue')
        else suite.set('vue', v)
        return suite
      },
      // Pas de `replace` : chaque écran entre dans l'historique, et le bouton
      // retour du téléphone ramène au précédent au lieu de quitter l'espace.
      { replace: false },
    )
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 })
  }

  return [vue, aller]
}
