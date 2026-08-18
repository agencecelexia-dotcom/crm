import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Reconnaissance vocale continue via l'API Web Speech du navigateur.
 *
 * Gratuite et sans clé, contrairement à Deepgram ou Whisper. La contrepartie
 * est une précision moindre sur un micro en haut-parleur — d'où la validation
 * humaine obligatoire avant tout enregistrement en base.
 *
 * Trois pièges réels que ce hook absorbe :
 *  • Chrome coupe la reconnaissance après quelques secondes de silence, même
 *    en mode `continuous`. On relance tant que l'utilisateur n'a pas arrêté.
 *  • Chaque redémarrage repart d'un transcript vide : on accumule nous-mêmes
 *    les segments définitifs, sinon le début de l'appel est perdu.
 *  • L'API n'existe pas sur Firefox. On le détecte pour afficher un message
 *    clair plutôt qu'un bouton qui ne fait rien.
 */

// L'API n'est pas dans les types DOM standard.
interface ResultatReconnaissance {
  isFinal: boolean
  0: { transcript: string }
}
interface EvenementReconnaissance {
  resultIndex: number
  results: { length: number; [i: number]: ResultatReconnaissance }
}
interface Reconnaissance {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: EvenementReconnaissance) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

function constructeur(): (new () => Reconnaissance) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => Reconnaissance
    webkitSpeechRecognition?: new () => Reconnaissance
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const ecouteDisponible = () => constructeur() != null

export type EtatEcoute = 'arret' | 'ecoute' | 'erreur'

export function useEcouteAppel() {
  const [etat, setEtat] = useState<EtatEcoute>('arret')
  const [erreur, setErreur] = useState<string | null>(null)
  /** Segments définitifs, accumulés depuis le début de l'appel. */
  const [transcription, setTranscription] = useState('')
  /** Segment en cours de reconnaissance, affiché en gris. */
  const [partiel, setPartiel] = useState('')

  const ref = useRef<Reconnaissance | null>(null)
  // Sans ce drapeau, le redémarrage automatique relance l'écoute juste après
  // que l'utilisateur a cliqué sur Stop.
  const veutEcouter = useRef(false)

  const demarrer = useCallback(() => {
    const Ctor = constructeur()
    if (!Ctor) {
      setErreur("Votre navigateur ne gère pas la reconnaissance vocale. Utilisez Chrome ou Safari.")
      setEtat('erreur')
      return
    }

    veutEcouter.current = true
    setErreur(null)

    const reco = new Ctor()
    reco.lang = 'fr-FR'
    reco.continuous = true
    reco.interimResults = true

    reco.onresult = (e) => {
      let definitif = ''
      let encours = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) definitif += r[0].transcript
        else encours += r[0].transcript
      }
      if (definitif) setTranscription((t) => (t ? `${t} ${definitif}` : definitif).trim())
      setPartiel(encours)
    }

    reco.onerror = (e) => {
      // `no-speech` et `aborted` sont des événements de fonctionnement normal,
      // pas des pannes : Chrome les émet à chaque silence un peu long.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'not-allowed') {
        setErreur("Micro refusé. Autorisez l'accès au microphone dans votre navigateur.")
        veutEcouter.current = false
        setEtat('erreur')
        return
      }
      setErreur(`Erreur de reconnaissance : ${e.error}`)
    }

    reco.onend = () => {
      if (veutEcouter.current) {
        // Relance immédiate : c'est ce qui rend l'écoute réellement continue.
        try {
          reco.start()
        } catch {
          setEtat('arret')
        }
      } else {
        setEtat('arret')
      }
    }

    ref.current = reco
    try {
      reco.start()
      setEtat('ecoute')
    } catch {
      setErreur("Impossible de démarrer l'écoute.")
      setEtat('erreur')
    }
  }, [])

  const arreter = useCallback(() => {
    veutEcouter.current = false
    ref.current?.stop()
    setEtat('arret')
    setPartiel('')
  }, [])

  const reinitialiser = useCallback(() => {
    veutEcouter.current = false
    ref.current?.stop()
    setTranscription('')
    setPartiel('')
    setErreur(null)
    setEtat('arret')
  }, [])

  // Le micro doit se couper si l'utilisateur quitte la page.
  useEffect(() => {
    return () => {
      veutEcouter.current = false
      ref.current?.stop()
    }
  }, [])

  return {
    etat,
    erreur,
    transcription,
    partiel,
    /** Web Speech ne donne pas accès au signal : pas de vumètre possible. */
    niveau: 0,
    /** Transcription + segment en cours, pour l'extraction. */
    texteComplet: (transcription + ' ' + partiel).trim(),
    demarrer,
    arreter,
    reinitialiser,
  }
}
