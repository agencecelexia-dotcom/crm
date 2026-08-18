import { useEffect, useState } from 'react'
import { AlertTriangle, Check, MapPin, RotateCcw, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/page-header'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase/client'
import { verifierMecaniquement, type LeadExtrait } from './checklist'
import { chercherDoublon, verifierAdresse, type AdresseVerifiee, type Doublon } from './verifications'

/**
 * Relecture avant enregistrement.
 *
 * Rien n'entre en base sans passer par cet écran. Une transcription de
 * haut-parleur se trompe — sur un numéro à 12 chiffres, sur une rue qui
 * n'existe pas — et ces erreurs coûtent un rappel client ou un déplacement
 * d'artisan pour rien. La validation humaine n'est pas une précaution
 * théorique : elle rattrape des cas réels.
 */
export function ValidationLead({
  lead,
  description,
  transcription,
  onRecommencer,
  onCree,
}: {
  lead: LeadExtrait | null
  description: string
  transcription: string
  onRecommencer: () => void
  onCree: (id: string) => void
}) {
  const [form, setForm] = useState({
    client_nom: lead?.client_nom ?? '',
    client_telephone: (lead?.client_telephone ?? '').replace(/\s/g, ''),
    client_email: lead?.client_email ?? '',
    client_adresse: lead?.client_adresse ?? '',
    client_code_postal: lead?.client_code_postal ?? '',
    client_ville: lead?.client_ville ?? '',
    metiers: lead?.metiers ?? [],
    description: description || lead?.probleme || '',
  })
  const [adresses, setAdresses] = useState<AdresseVerifiee[]>([])
  const [doublons, setDoublons] = useState<Doublon[]>([])
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null)
  const [enregistre, setEnregistre] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // Vérification d'adresse auprès de la Base Adresse Nationale.
  useEffect(() => {
    if (!lead) return
    void verifierAdresse(lead).then(setAdresses)
  }, [lead])

  // Doublon : c'est le contrôle qu'on oublie le plus, et celui qui crée le
  // plus de dégâts (deux artisans appelant le même client).
  useEffect(() => {
    const tel = form.client_telephone
    if (tel.replace(/\D/g, '').length < 9) return
    void chercherDoublon(tel).then(setDoublons)
  }, [form.client_telephone])

  const anomalies = verifierMecaniquement({
    client_telephone: form.client_telephone,
    client_code_postal: form.client_code_postal,
    client_email: form.client_email,
  })
  const bloquants = anomalies.filter((a) => a.gravite === 'bloquant')

  function appliquerAdresse(a: AdresseVerifiee) {
    setForm((f) => ({
      ...f,
      client_adresse: a.adresse,
      client_code_postal: a.code_postal,
      client_ville: a.ville,
    }))
    setGps({ lat: a.latitude, lon: a.longitude })
  }

  async function enregistrer() {
    setErreur(null)
    setEnregistre(true)
    try {
      const { data, error } = await supabase
        .from('projets')
        .insert({
          client_nom: form.client_nom.trim() || 'À qualifier',
          client_telephone: form.client_telephone.replace(/\s/g, '') || null,
          client_email: form.client_email.trim() || null,
          client_adresse: form.client_adresse.trim() || null,
          client_code_postal: form.client_code_postal.trim() || null,
          client_ville: form.client_ville.trim() || null,
          latitude: gps?.lat ?? null,
          longitude: gps?.lon ?? null,
          metier: form.metiers[0] ?? 'Rénovation',
          metiers: form.metiers.length ? form.metiers : ['Rénovation'],
          statut: 'nouveau',
          description: form.description.trim() || null,
        })
        .select('id')
        .single()

      if (error) throw error
      // Aucune affectation : l'attribution reste une décision humaine.
      onCree(data.id)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
      setEnregistre(false)
    }
  }

  const champ = (cle: keyof typeof form, label: string, type = 'text') => (
    <div>
      <Label htmlFor={cle}>{label}</Label>
      <Input
        id={cle}
        type={type}
        value={form[cle] as string}
        onChange={(e) => setForm((f) => ({ ...f, [cle]: e.target.value }))}
        className={cn(anomalies.some((a) => a.champ === cle) && 'border-destructive')}
      />
      {anomalies
        .filter((a) => a.champ === cle)
        .map((a, i) => (
          <p key={i} className="mt-1 text-xs text-destructive">
            {a.message}
          </p>
        ))}
    </div>
  )

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-28">
      <PageHeader titre="Vérifier avant d'enregistrer" />

      {doublons.length > 0 && (
        <div className="rounded-2xl border border-[#DC2626]/30 bg-[#DC2626]/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[#DC2626]">
            <AlertTriangle className="size-4" />
            Ce numéro existe déjà dans le CRM
          </p>
          {doublons.map((d) => (
            <p key={d.id} className="mt-1 text-xs text-[#991B1B]">
              {d.client_nom} — {d.client_ville ?? 'ville inconnue'} · {d.statut} · créé le{' '}
              {new Date(d.created_at).toLocaleDateString('fr-FR')}
            </p>
          ))}
          <p className="mt-1.5 text-xs text-[#991B1B]">
            Vérifiez qu'il ne s'agit pas du même chantier avant d'enregistrer.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {champ('client_nom', 'Nom du client')}
        {champ('client_telephone', 'Téléphone', 'tel')}
      </div>
      {champ('client_email', 'Email', 'email')}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">{champ('client_adresse', 'Adresse')}</div>
        {champ('client_code_postal', 'Code postal')}
        <div className="sm:col-span-2">{champ('client_ville', 'Ville')}</div>
      </div>

      {/* La BAN tranche les adresses approximatives : « rue de la Saint-Marc »
          n'existe pas, « rue de la Barrière Saint-Marc » oui. */}
      {adresses.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MapPin className="size-3.5" />
            Adresses officielles trouvées
          </p>
          <div className="space-y-1">
            {adresses.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => appliquerAdresse(a)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="min-w-0 truncate">{a.label}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 text-xs tabular-nums',
                    a.numeroExact && a.score > 0.8
                      ? 'bg-[#22C55E]/15 text-[#16A34A]'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {Math.round(a.score * 100)} %
                </span>
              </button>
            ))}
          </div>
          {gps && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-[#16A34A]">
              <Check className="size-3" /> Coordonnées GPS renseignées
            </p>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="description">Description (rapport généré)</Label>
        <Textarea
          id="description"
          rows={10}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="font-mono text-xs"
        />
      </div>

      {transcription && (
        <details className="rounded-xl border border-border/70 p-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Transcription brute
          </summary>
          <p className="mt-2 max-h-40 overflow-y-auto text-xs text-muted-foreground">
            {transcription}
          </p>
        </details>
      )}

      {erreur && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {erreur}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Button variant="outline" size="lg" onClick={onRecommencer}>
            <RotateCcw className="size-4" />
            Recommencer
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={enregistre || bloquants.length > 0 || !form.client_nom.trim()}
            onClick={() => void enregistrer()}
          >
            <UserPlus className="size-4" />
            {bloquants.length > 0 ? 'Corrigez les erreurs' : 'Créer le lead'}
          </Button>
        </div>
        <p className="mx-auto mt-1.5 max-w-2xl text-center text-xs text-muted-foreground">
          Le lead sera créé sans artisan. Vous l'attribuerez ensuite.
        </p>
      </div>
    </div>
  )
}
