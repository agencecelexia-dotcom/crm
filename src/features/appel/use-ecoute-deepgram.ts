import { useCallback, useEffect, useRef, useState } from 'react'

import type { EtatEcoute } from './use-ecoute-appel'

/**
 * Transcription Deepgram en flux continu, relayée par l'edge function.
 *
 * Interface identique à `useEcouteAppel` (Web Speech) : la page bascule de
 * l'un à l'autre sans rien changer d'autre.
 *
 * Deux raisons de préférer le flux aux tranches indépendantes :
 *
 *  • LES MOTS À CHEVAL. Découpé en fichiers de 8 s, « Aubigeon » prononcé à la
 *    frontière ressortait « Aubi » — un nom tronqué que rien ne signalait. En
 *    flux, Deepgram dispose du contexte et reconstitue le mot.
 *
 *  • LES CHIFFRES. `smart_format` restitue « zéro six, treize, soixante-dix-
 *    sept » en 06 13 77, là où Web Speech écrit les mots — que l'extraction
 *    reconstitue ensuite mal. Sur l'appel Lancelot, Web Speech donnait un
 *    numéro faux, Deepgram le bon.
 *
 * La clé n'est jamais dans le bundle : le navigateur parle à l'edge function,
 * qui détient la clé et relaie vers Deepgram.
 */

/** Aucun rééchantillonnage côté navigateur : on envoie le flux à SA fréquence
 *  native (48 kHz en général) et on la déclare à Deepgram. Forcer un
 *  AudioContext à 16 kHz oblige le navigateur à rééchantillonner à la volée,
 *  ce qu'il fait sans filtre anti-repliement correct — la voix ressort
 *  métallique et les consonnes se brouillent. Deepgram rééchantillonne bien
 *  mieux que nous. */
/** Deepgram ferme un flux resté muet ~10 s. On maintient la connexion pendant
 *  les silences de la conversation. */
const KEEPALIVE_MS = 5000

export function useEcouteDeepgram() {
  const [etat, setEtat] = useState<EtatEcoute>('arret')
  const [erreur, setErreur] = useState<string | null>(null)
  const [transcription, setTranscription] = useState('')
  const [partiel, setPartiel] = useState('')
  /** Niveau sonore capté, 0 à 1. Sans ce retour, impossible de distinguer
   *  « le micro n'entend rien » de « la transcription ne marche pas » — on
   *  regarde un écran vide sans savoir lequel des deux corriger. */
  const [niveau, setNiveau] = useState(0)

  const ws = useRef<WebSocket | null>(null)
  const flux = useRef<MediaStream | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const keepalive = useRef<number | null>(null)
  const veutEcouter = useRef(false)

  const tout = useCallback(() => {
    if (keepalive.current) clearInterval(keepalive.current)
    keepalive.current = null
    if (ws.current?.readyState === WebSocket.OPEN) {
      // Demande à Deepgram de restituer ce qu'il lui reste avant de fermer.
      ws.current.send(JSON.stringify({ type: 'CloseStream' }))
    }
    ws.current?.close()
    void ctx.current?.close()
    flux.current?.getTracks().forEach((t) => t.stop())
    ws.current = null
    ctx.current = null
    flux.current = null
  }, [])

  const demarrer = useCallback(async () => {
    veutEcouter.current = true
    setErreur(null)

    try {
      // TOUS les traitements du navigateur sont DÉSACTIVÉS, et c'est décisif.
      //
      // `echoCancellation` est conçu pour supprimer ce qui sort des
      // haut-parleurs afin d'éviter le larsen en visioconférence. Or ici, ce
      // qui sort du haut-parleur EST le signal utile : la voix du client.
      // Activé, le navigateur l'annulait activement — c'est la cause première
      // des transcriptions vides.
      //
      // `noiseSuppression` est réglé pour une voix proche du micro ; sur une
      // voix lointaine et déjà compressée par le réseau téléphonique, il la
      // prend pour du bruit et la rabote.
      //
      // `autoGainControl` pompe entre les silences et la parole, ce qui écrase
      // les débuts de phrase — précisément là où se trouvent les noms.
      const micro = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      flux.current = micro

      // L'AudioContext est créé AVANT le socket : sa fréquence réelle doit
      // être annoncée à Deepgram. Annoncer 16 kHz pour un flux à 48 kHz décale
      // tout et produit du charabia.
      const audio = new AudioContext()
      ctx.current = audio

      const base = import.meta.env.VITE_SUPABASE_URL as string
      const url = `${base.replace(/^http/, 'ws')}/functions/v1/transcrire-audio?sr=${audio.sampleRate}`
      const socket = new WebSocket(url)
      socket.binaryType = 'arraybuffer'
      ws.current = socket

      socket.onopen = () => {
        const source = audio.createMediaStreamSource(micro)
        const proc = audio.createScriptProcessor(4096, 1, 1)

        let compteur = 0
        proc.onaudioprocess = (e) => {
          if (socket.readyState !== WebSocket.OPEN) return
          const f32 = e.inputBuffer.getChannelData(0)

          // Niveau efficace (RMS), rafraîchi ~3 fois par seconde.
          if (++compteur % 4 === 0) {
            let somme = 0
            for (let i = 0; i < f32.length; i++) somme += f32[i] * f32[i]
            const rms = Math.sqrt(somme / f32.length)
            setNiveau(Math.min(1, rms * 8))
          }
          // linear16 : float32 → PCM 16 bits signé, ce qu'attend Deepgram.
          const pcm = new Int16Array(f32.length)
          for (let i = 0; i < f32.length; i++) {
            const v = Math.max(-1, Math.min(1, f32[i]))
            pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
          }
          socket.send(pcm.buffer)
        }

        source.connect(proc)
        // Sans destination, ScriptProcessor ne reçoit aucun événement. Un gain
        // nul évite de renvoyer la voix dans les haut-parleurs (larsen).
        const muet = audio.createGain()
        muet.gain.value = 0
        proc.connect(muet)
        muet.connect(audio.destination)

        keepalive.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'KeepAlive' }))
          }
        }, KEEPALIVE_MS)

        setEtat('ecoute')
      }

      socket.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data as string)
          if (m.erreur) {
            setErreur(String(m.erreur))
            return
          }
          const texte = m.channel?.alternatives?.[0]?.transcript as string | undefined
          if (!texte) return
          if (m.is_final) {
            setTranscription((t) => (t ? `${t} ${texte}` : texte).trim())
            setPartiel('')
          } else {
            setPartiel(texte)
          }
        } catch {
          // Métadonnées Deepgram : sans intérêt ici.
        }
      }

      socket.onerror = () => {
        setErreur('Connexion de transcription interrompue.')
        setEtat('erreur')
      }
      socket.onclose = () => {
        if (veutEcouter.current) setEtat('arret')
      }
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
  }, [tout])

  const arreter = useCallback(() => {
    veutEcouter.current = false
    tout()
    setEtat('arret')
    setPartiel('')
    setNiveau(0)
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
    niveau,
    texteComplet: (transcription + ' ' + partiel).trim(),
    demarrer,
    arreter,
    reinitialiser,
  }
}
