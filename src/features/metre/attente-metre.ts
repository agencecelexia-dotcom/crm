/** Métadonnées locales : le temps d'attente appartient à une demande, pas au nombre historique de lectures du cache. */
export interface AttenteMetre {
  attenteDepuis?: number
  delaiDepasse?: boolean
}

export function bornerAttente<T extends { statut?: string }>(
  reponse: T,
  precedente: (T & AttenteMetre) | undefined,
  maintenant: number,
  dureeMax: number,
): T & AttenteMetre {
  if (reponse.statut !== 'en_cours') return { ...reponse, attenteDepuis: undefined, delaiDepasse: false }
  const depuis = precedente?.statut === 'en_cours' ? precedente.attenteDepuis ?? maintenant : maintenant
  return { ...reponse, attenteDepuis: depuis, delaiDepasse: maintenant - depuis >= dureeMax }
}

export function reprendreAttente<T extends AttenteMetre>(etat: T | undefined, maintenant: number): T | undefined {
  return etat ? { ...etat, attenteDepuis: maintenant, delaiDepasse: false } : etat
}
