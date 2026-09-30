// Les modèles de Claude que l'application appelle, en UN seul endroit.
//
// Le métré par IA lit des images (photo aérienne, photos de façade) et tranche
// entre plusieurs sources : c'est Sonnet 5.5. Le nom se change ici, ou par le
// secret de fonction `MODELE_VISION` — sans toucher au code, et sans attendre un
// déploiement de l'écran. `ia-ping` dit lesquels le compte peut appeler.

export const MODELE_VISION_DEFAUT = 'claude-sonnet-5-5'

/** Le modèle des lectures d'images du métré. */
export const modeleVision = (): string => Deno.env.get('MODELE_VISION')?.trim() || MODELE_VISION_DEFAUT

/** Ceux qu'`ia-ping` essaie, du plus petit au plus grand. */
export const MODELES_A_ESSAYER = ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-opus-5-5', 'claude-fable-5-1']
