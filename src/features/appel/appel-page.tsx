import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Mic, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import {
  construireChecklist,
  divergences,
  fusionner,
  verifierMecaniquement,
  type LeadExtrait,
  type Saisies,
} from './checklist'
import { ecouteDisponible, useEcouteAppel } from './use-ecoute-appel'
import { useEcouteDeepgram } from './use-ecoute-deepgram'
import { PanneauChecklist } from './panneau-checklist'
import { ValidationLead } from './validation-lead'

/** Intervalle entre deux extractions. Assez court pour que la checklist suive
 *  la conversation, assez long pour ne pas appeler le modèle à chaque mot. */
const PERIODE_EXTRACTION_MS = 4000
/** En dessous, la transcription n'a pas assez changé pour valoir un appel. */
const DELTA_MINIMAL = 40

/** Moteur de transcription. Les deux restent disponibles : Web Speech est
 *  gratuit et suffit souvent, Deepgram est meilleur sur les chiffres dictés au
 *  haut-parleur. Le choix se compare en conditions réelles, pas en théorie. */
type Moteur = 'navigateur' | 'deepgram'
const CLE_MOTEUR = 'crm.appel.moteur'

export function AppelPage() {
  const navigate = useNavigate()
  const [moteur, setMoteur] = useState<Moteur>(
    () => (localStorage.getItem(CLE_MOTEUR) as Moteur) ?? 'deepgram',
  )

  // Les deux hooks sont montés en permanence : les règles des hooks
  // interdisent un appel conditionnel. Seul celui qui est sélectionné est
  // démarré, l'autre reste inerte (aucun micro ouvert tant qu'on ne
  // l'appelle pas).
  const navigateur = useEcouteAppel()
  const deepgram = useEcouteDeepgram()
  const actif = moteur === 'deepgram' ? deepgram : navigateur
  const { etat, erreur, transcription, partiel, texteComplet, demarrer, arreter, reinitialiser } =
    actif

  const [lead, setLead] = useState<LeadExtrait | null>(null)
  const [extraitEnCours, setExtraitEnCours] = useState(false)
  const [erreurExtraction, setErreurExtraction] = useState<string | null>(null)
  const [termine, setTermine] = useState(false)
  const [description, setDescription] = useState('')
  /** Frappe du commercial pendant l'appel. Prime sur l'extraction, qui ne
   *  l'écrase jamais — sinon il corrigerait un champ pour le voir revenir. */
  const [saisies, setSaisies] = useState<Saisies>({})

  // Longueur de texte déjà envoyée, pour ne pas relancer inutilement.
  const dernierEnvoi = useRef(0)
  const enVol = useRef(false)

  // `lead` passe par une ref : l'inclure dans les dépendances recréerait la
  // fonction à chaque extraction, et relancerait l'effet en boucle.
  const leadRef = useRef<LeadExtrait | null>(null)
  useEffect(() => {
    leadRef.current = lead
  }, [lead])

  const extraire = useCallback(async (texte: string, mode: 'extraction' | 'rapport') => {
    const { data, error } = await supabase.functions.invoke('extraire-lead', {
      // L'état antérieur est transmis dans les DEUX modes : sans lui, chaque
      // passe repart de zéro et un champ capté à la minute 2 peut disparaître
      // à la minute 3.
      body: { transcription: texte, mode, donnees: leadRef.current ?? undefined },
    })
    if (error) throw error
    if (!data?.ok) throw new Error(data?.error ?? 'extraction impossible')
    return data
  }, [])

  // Extraction périodique pendant l'écoute.
  useEffect(() => {
    if (etat !== 'ecoute') return
    const timer = setInterval(() => {
      const texte = texteComplet
      if (enVol.current) return
      if (texte.length - dernierEnvoi.current < DELTA_MINIMAL) return

      enVol.current = true
      dernierEnvoi.current = texte.length
      setExtraitEnCours(true)
      extraire(texte, 'extraction')
        .then((d) => {
          setLead(d.lead as LeadExtrait)
          setErreurExtraction(null)
        })
        .catch((e) => setErreurExtraction(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          enVol.current = false
          setExtraitEnCours(false)
        })
    }, PERIODE_EXTRACTION_MS)
    return () => clearInterval(timer)
  }, [etat, texteComplet, extraire])

  const terminer = useCallback(async () => {
    arreter()
    if (texteComplet.length < 30) {
      // Appel sans transcription exploitable : la saisie manuelle suffit.
      if (Object.keys(saisies).length) setLead(fusionner(lead, saisies))
      setTermine(true)
      return
    }
    setExtraitEnCours(true)
    try {
      // Dernière extraction sur la transcription complète : les dernières
      // minutes de l'appel n'ont pas forcément été analysées.
      const finale = await extraire(texteComplet, 'extraction')
      // La saisie manuelle reste prioritaire, y compris sur l'extraction
      // finale : c'est la source la plus sûre dont on dispose.
      const complet = fusionner(finale.lead as LeadExtrait, saisies)
      setLead(complet)

      const rapport = await supabase.functions.invoke('extraire-lead', {
        body: { transcription: texteComplet, mode: 'rapport', donnees: complet },
      })
      if (rapport.data?.ok) setDescription(rapport.data.description as string)
    } catch (e) {
      setErreurExtraction(e instanceof Error ? e.message : String(e))
    } finally {
      setExtraitEnCours(false)
      setTermine(true)
    }
  }, [arreter, texteComplet, extraire, saisies, lead])

  const recommencer = useCallback(() => {
    reinitialiser()
    setLead(null)
    setDescription('')
    setTermine(false)
    setSaisies({})
    setErreurExtraction(null)
    dernierEnvoi.current = 0
  }, [reinitialiser])

  if (moteur === 'navigateur' && !ecouteDisponible()) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <PageHeader titre="Prise d'appel" />
        <div className="rounded-2xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-4 text-sm text-[#92400E]">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" />
            Navigateur non compatible
          </p>
          <p className="mt-1">
            La reconnaissance vocale n'existe pas sur ce navigateur. Ouvrez cette page dans
            Chrome (Android, ordinateur) ou Safari (iPhone).
          </p>
        </div>
      </div>
    )
  }

  if (termine) {
    return (
      <ValidationLead
        lead={lead}
        description={description}
        transcription={transcription}
        onRecommencer={recommencer}
        onCree={(id) => navigate(`/projets/${id}`)}
      />
    )
  }

  const lignes = construireChecklist(lead, saisies)
  const anomalies = verifierMecaniquement(fusionner(lead, saisies))
  const ecarts = divergences(lignes)

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-28">
      <PageHeader titre="Prise d'appel" />

      {/* Comparateur de moteurs : masqué en cours d'appel, on ne change pas
          de transcripteur au milieu d'une conversation. */}
      {etat !== 'ecoute' && !transcription && (
        <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card p-2">
          <span className="pl-1 text-xs text-muted-foreground">Transcription :</span>
          {(['deepgram', 'navigateur'] as Moteur[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMoteur(m)
                localStorage.setItem(CLE_MOTEUR, m)
              }}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                moteur === m
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {m === 'deepgram' ? 'Deepgram' : 'Navigateur (gratuit)'}
            </button>
          ))}
        </div>
      )}

      {/* Le consentement n'est pas une formalité : enregistrer la voix d'un
          particulier sans son accord est illégal. Trois secondes en ouverture. */}
      {etat === 'ecoute' && (
        <div className="rounded-xl border border-[#0EA5E9]/30 bg-[#0EA5E9]/5 px-3 py-2 text-xs text-[#075985]">
          Pensez à prévenir votre interlocuteur : «&nbsp;je prends des notes pendant qu'on
          parle, ça ne vous dérange pas&nbsp;?&nbsp;»
        </div>
      )}

      {erreur && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {erreur}
        </div>
      )}
      {erreurExtraction && (
        <div className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-3 text-xs text-[#92400E]">
          Analyse indisponible : {erreurExtraction}. L'écoute continue, la transcription est
          conservée.
        </div>
      )}

      <PanneauChecklist
        lignes={lignes}
        anomalies={anomalies}
        extraitEnCours={extraitEnCours}
        onSaisir={(cle, v) =>
          setSaisies((s) => {
            const n = { ...s }
            // Vider un champ rend la main à l'extraction plutôt que de figer
            // une valeur vide.
            if (v.trim()) n[cle] = v
            else delete n[cle]
            return n
          })
        }
      />

      {ecarts.length > 0 && (
        <div className="rounded-2xl border border-[#B45309]/30 bg-[#F59E0B]/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#B45309]">
            <AlertTriangle className="size-3.5" />
            {ecarts.length} écart{ecarts.length > 1 ? 's' : ''} entre votre saisie et l'écoute
          </p>
          <p className="mt-0.5 text-xs text-[#92400E]">
            Profitez d'avoir le client en ligne pour trancher.
          </p>
        </div>
      )}

      {(lead?.alertes?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[#B45309]">
            <AlertTriangle className="size-3.5" />
            À signaler à l'artisan
          </p>
          <ul className="space-y-0.5 text-xs text-[#92400E]">
            {lead!.alertes!.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </div>
      )}

      {(transcription || partiel) && (
        <details className="rounded-2xl border border-border/70 bg-card p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Transcription ({transcription.length} caractères)
          </summary>
          <p className="mt-2 max-h-48 overflow-y-auto text-xs leading-relaxed text-muted-foreground">
            {transcription} <span className="opacity-50">{partiel}</span>
          </p>
        </details>
      )}

      {/* Barre d'action fixe : utilisable d'une main, sans viser. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-2">
          {etat !== 'ecoute' ? (
            <Button size="lg" className="flex-1" onClick={demarrer}>
              <Mic className="size-5" />
              {transcription ? 'Reprendre' : "Démarrer l'écoute"}
            </Button>
          ) : (
            <>
              <span className="flex items-center gap-2 px-2 text-sm font-medium text-[#DC2626]">
                <span className="size-2.5 animate-pulse rounded-full bg-[#DC2626]" />
                écoute
              </span>
              <Button size="lg" variant="outline" className="flex-1" onClick={arreter}>
                Pause
              </Button>
              <Button size="lg" className="flex-1" onClick={() => void terminer()}>
                <Square className="size-4" />
                Terminer
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
