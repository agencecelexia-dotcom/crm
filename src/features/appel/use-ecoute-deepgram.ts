import { useCallback, useEffect, useRef, useState } from 'react'

import { supabase } from '@/lib/supabase/client'
import type { EtatEcoute } from './use-ecoute-appel'

/**
 * Transcription par Deepgram (nova-2, français), relayée par l'edge function.
 *
 * Interface identique à `useEcouteAppel` (Web Speech) : la page bascule de
 * l'un à l'autre sans rien changer d'autre.
 *
 * Le gain décisif tient aux CHIFFRES. Sur un même énoncé, Web Speech a rendu
 * « 0613707752 » là où le numéro dicté était 06 13 77 52 66 ; Deepgram, avec
 * `smart_format`, restitue « 0 6, 13, 77, 52, 66 ». Or le téléphone est le
 * champ le plus coûteux à rater : un chiffre faux et le lead est perdu.
 *
 * L'audio part par tranches vers le serveur, qui détient la clé. Le navigateur
 * ne la voit jamais — un WebSocket direct l'aurait exigée dans le bundle.
 */

/** Durée d'une tranche. Assez courte pour que la checklist suive la
 *  conversation, assez longue pour que Deepgram dispose de contexte : en
 *  dessous de ~5 s, la fin des phrases est tronquée et la ponctuation souffre. */
const TRANCHE_MS = 8000

export function useEcouteDeepgram() {
  const [etat, setEtat] = useState<EtatEcoute>('arret')
  const [erreur, setErreur] = useState<string | null>(null)
  const [transcription, setTranscription] = useState('')
  /** Deepgram travaille par tranche : pas de résultat intermédiaire. On
   *  affiche l'état d'avancement à la place. */
  const [partiel, setPartiel] = useState('')

  const flux = useRef<MediaStream | null>(null)
  const enregistreur = useRef<MediaRecorder | null>(null)
  const veutEcouter = useRef(false)

  const envoyer = useCallback(async (blob: Blob) => {
    if (blob.size < 2000) return // silence : rien à transcrire
    setPartiel('transcription…')
    try {
      const { data: session } = await supabase.auth.getSession()
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcrire-audio`
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'x-audio-type': blob.type || 'audio/webm',
        },
        body: blob,
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error ?? 'transcription impossible')
      if (d.texte) setTranscription((t) => (t ? `${t} ${d.texte}` : d.texte).trim())
      setErreur(null)
    } catch (e) {
      setErreur(`Transcription : ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPartiel('')
    }
  }, [])

  const tout = useCallback(() => {
    if (enregistreur.current && enregistreur.current.state !== 'inactive') {
      enregistreur.current.stop()
    }
    flux.current?.getTracks().forEach((t) => t.stop())
    enregistreur.current = null
    flux.current = null
  }, [])

  const demarrer = useCallback(async () => {
    veutEcouter.current = true
    setErreur(null)
    try {
      const micro = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          // Le haut-parleur génère écho et réverbération : ces traitements du
          // navigateur améliorent nettement le signal transmis.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      flux.current = micro

      // Chaque tranche doit être un fichier autonome et décodable. Un
      // MediaRecorder unique avec `timeslice` produit des fragments sans
      // en-tête, illisibles isolément : on relance donc un enregistreur par
      // tranche.
      const boucle = () => {
        if (!veutEcouter.current || !flux.current) return
        const mr = new MediaRecorder(flux.current, { mimeType: typeSupporte() })
        enregistreur.current = mr
        const morceaux: Blob[] = []
        mr.ondataavailable = (e) => e.data.size > 0 && morceaux.push(e.data)
        mr.onstop = () => {
          if (morceaux.length) void envoyer(new Blob(morceaux, { type: mr.mimeType }))
          boucle()
        }
        mr.start()
        setTimeout(() => mr.state !== 'inactive' && mr.stop(), TRANCHE_MS)
      }

      boucle()
      setEtat('ecoute')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErreur(
        /permission|notallowed/i.test(msg)
          ? "Micro refusé. Autorisez l'accès au microphone."
          : `Micro indisponible : ${msg}`,
      )
      setEtat('erreur')
      tout()
    }
  }, [envoyer, tout])

  const arreter = useCallback(() => {
    veutEcouter.current = false
    tout()
    setEtat('arret')
    setPartiel('')
  }, [tout])

  const reinitialiser = useCallback(() => {
    arreter()
    setTranscription('')
    setErreur(null)
  }, [arreter])

  useEffect(() => () => {
    veutEcouter.current = false
    tout()
  }, [tout])

  return {
    etat,
    erreur,
    transcription,
    partiel,
    texteComplet: transcription,
    demarrer,
    arreter,
    reinitialiser,
  }
}

/** Safari n'accepte pas webm ; on retombe sur mp4, que Deepgram lit aussi. */
function typeSupporte(): string {
  const candidats = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidats.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}
