import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Loader2, Mail, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase/client'
import { formatDate } from '@/lib/format'
import { emailInvitation, validerInvitation } from '../../../../supabase/functions/_invitation-artisan'

export function InvitationEmailForm({ taux, onRetour }: { taux: 10 | 15 | 20; onRetour: () => void }) {
  const [champs, setChamps] = useState({ prenom: '', nom: '', societe: '', email: '' })
  const [envoi, setEnvoi] = useState(false)
  const [resultat, setResultat] = useState<'confirme' | 'incertain' | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [id] = useState(() => crypto.randomUUID())
  const qc = useQueryClient()
  const apercu = emailInvitation({ ...champs, taux })
  const historique = useQuery({
    queryKey: ['invitations-artisans'],
    refetchInterval: resultat === 'incertain' ? 5_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase.from('invitations_artisans').select('id,email,taux,etat,created_at').order('created_at', { ascending: false }).limit(8)
      if (error) throw error
      return data as { id: string; email: string; taux: number; etat: string; created_at: string }[]
    },
  })
  const confirme = resultat === 'confirme' || historique.data?.some((r) => r.id === id && r.etat === 'confirme')

  async function envoyer(e: React.FormEvent) {
    e.preventDefault()
    if (envoi || resultat) return
    let payload
    try { payload = validerInvitation({ ...champs, taux }) } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Vérifiez les informations saisies')
      return
    }
    setErreur(null)
    setEnvoi(true)
    try {
      const { data, error } = await supabase.functions.invoke('invitation-artisan', { body: { id, ...payload } })
      let reponse = data
      if (error && 'context' in error && error.context instanceof Response) {
        reponse = await error.context.json().catch(() => null)
      }
      const refus: Record<string, string> = {
        connexion_requise: 'Reconnectez-vous au CRM avant d’envoyer cette invitation.',
        non_autorise: 'Votre compte ne peut pas envoyer d’invitations. Contactez un fondateur.',
        service_non_configure: 'Le service email n’est pas encore configuré. Aucune invitation n’a été envoyée.',
        limite_horaire: 'La limite de 60 invitations par heure est atteinte. Réessayez plus tard.',
        journal_indisponible: 'Le journal est indisponible. L’envoi n’a pas été lancé.',
        reservation_impossible: 'La demande n’a pas pu être enregistrée. L’envoi n’a pas été lancé.',
      }
      if (reponse?.error && refus[reponse.error]) {
        setErreur(refus[reponse.error])
        return
      }
      if (error || data?.ok !== true || data?.etat !== 'confirme') {
        setResultat('incertain')
      } else setResultat('confirme')
    } catch {
      setResultat('incertain')
    } finally {
      setEnvoi(false)
      void qc.invalidateQueries({ queryKey: ['invitations-artisans'] })
    }
  }

  return <div className="space-y-5">
    <Button type="button" variant="ghost" size="sm" onClick={onRetour} disabled={envoi}><ArrowLeft className="size-4" />Tous les canaux</Button>
    <form onSubmit={(e) => void envoyer(e)} className="space-y-4">
      <fieldset disabled={envoi || resultat != null} className="grid gap-3 sm:grid-cols-2 disabled:opacity-70">
        <label className="space-y-1.5 text-sm">Prénom <span className="text-xs text-muted-foreground">(facultatif)</span><Input value={champs.prenom} maxLength={100} autoComplete="given-name" onChange={(e) => setChamps({ ...champs, prenom: e.target.value })} /></label>
        <label className="space-y-1.5 text-sm">Nom <span className="text-xs text-muted-foreground">(facultatif)</span><Input value={champs.nom} maxLength={100} autoComplete="family-name" onChange={(e) => setChamps({ ...champs, nom: e.target.value })} /></label>
        <label className="space-y-1.5 text-sm sm:col-span-2">Société <span className="text-xs text-muted-foreground">(facultatif)</span><Input value={champs.societe} maxLength={160} autoComplete="organization" onChange={(e) => setChamps({ ...champs, societe: e.target.value })} /></label>
        <label className="space-y-1.5 text-sm sm:col-span-2">Email destinataire <span className="text-xs text-muted-foreground">(obligatoire)</span><Input type="email" value={champs.email} maxLength={254} required autoComplete="email" placeholder="contact@entreprise.fr" onChange={(e) => setChamps({ ...champs, email: e.target.value })} /></label>
      </fieldset>
      <p className="text-xs leading-relaxed text-muted-foreground">Seul l’email est nécessaire. Le message s’adapte aux informations renseignées. Le lien conserve le canal Email et le taux de {taux} % TTC.</p>
      <details className="rounded-lg border border-border bg-muted/20 p-3" open>
        <summary className="cursor-pointer text-sm font-medium">Aperçu du message</summary>
        <iframe title="Aperçu de l’invitation Celexia" sandbox="allow-same-origin" srcDoc={apercu.html} className="mt-3 h-64 w-full rounded-lg border border-border bg-white" />
      </details>
      {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
      {resultat ? <div role="status" className={`rounded-lg border p-4 text-sm ${confirme ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
        {confirme ? <><CheckCircle2 className="mb-2 size-5" />Invitation envoyée à {champs.email}. Gmail a confirmé la prise en charge.</> : <><AlertCircle className="mb-2 size-5" />Envoi non confirmé. Vérifiez l’historique ci-dessous et Gmail avant de créer une nouvelle invitation. Aucun renvoi automatique ne sera effectué.</>}
      </div> : <Button type="submit" className="w-full" disabled={envoi}>
        {envoi ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
        {envoi ? 'Envoi via Gmail…' : `Envoyer l’invitation à ${taux} % via Gmail`}
      </Button>}
    </form>
    <div className="border-t border-border pt-4">
      <h3 className="text-sm font-medium">Dernières invitations</h3>
      {historique.isError ? <p className="mt-2 text-xs text-destructive">Historique indisponible. Vérifiez Gmail avant de renvoyer une invitation.</p> : historique.isPending ? <p className="mt-2 text-xs text-muted-foreground">Chargement…</p> : !historique.data?.length ? <p className="mt-2 text-xs text-muted-foreground">Aucune invitation envoyée.</p> : <ul className="mt-2 divide-y divide-border">
        {historique.data.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"><span className="min-w-0 break-all">{r.email} · {r.taux} %<span className="ml-2 text-muted-foreground">{formatDate(r.created_at)}</span></span><span className={`rounded-md px-2 py-1 font-medium ${r.etat === 'confirme' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>{r.etat === 'confirme' ? 'Envoyée' : r.etat === 'incertain' ? 'À vérifier' : 'En cours'}</span></li>)}
      </ul>}
    </div>
  </div>
}
