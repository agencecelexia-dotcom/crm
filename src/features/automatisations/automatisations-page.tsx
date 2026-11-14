import { useState } from 'react'
import { Loader2, PauseCircle, RefreshCw, Search, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { formatDateHeure } from '@/lib/format'
import { useReglages, useSetReglage, useRelances, destinataireRelance, type Reglages } from './use-automatisations'
import { AUTOMATISATIONS, FAMILLES, type FamilleAutomatisation } from './catalogue'
import { DETAILS_CRM, noticeN8n } from './descriptions'
import { AutomatisationDetails } from './automatisation-details'
import { useAutomatisationsN8n, useJournalAutomatisations, useModifierN8n } from './use-n8n'
import type { AutomatisationN8n } from '../../../supabase/functions/_automatisations-n8n'

const CHAMPS = [
  ['relance_premier_h', 'Première relance (heures)'], ['relance_interval_h', 'Intervalle des relances (heures)'],
  ['relance_escalade_h', 'Alerte à l’agence (heures)'], ['post_rdv_premier_h', 'Après visite : première relance (heures)'],
  ['post_rdv_relance_h', 'Après visite : deuxième relance (heures)'], ['heure_debut', 'Début des envois (heure)'],
  ['heure_fin', 'Fin des envois (heure)'], ['creatives_plafond_mois', 'Plafond de créatives par mois'],
] as const
const TYPE_LABEL: Record<string, string> = { contrat: 'Contrat', contrat_escalade: 'Alerte contrat', inaction: 'Sans nouvelle', inaction_escalade: 'Alerte inaction', post_rdv: 'Après visite', orphelin: 'Non attribués' }
const normaliser = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr')

function activeCrm(cle: string, r: Reglages) {
  if (['auto_contrat','auto_inaction','auto_orphelin','auto_post_rdv'].includes(cle) && r.relances_pause) return false
  if (cle === 'auto_materiaux' && !r.bascules.auto_pre_metre) return false
  return r.bascules[cle] === true
}

export function AutomatisationsPage() {
  const reglages = useReglages()
  const set = useSetReglage()
  const n8n = useAutomatisationsN8n()
  const modifier = useModifierN8n()
  const journal = useJournalAutomatisations()
  const relances = useRelances(80)
  const [recherche, setRecherche] = useState('')
  const [filtre, setFiltre] = useState('tous')
  const [confirmation, setConfirmation] = useState<AutomatisationN8n | null>(null)
  const r = reglages.data
  const workflows = n8n.data?.workflows ?? []
  const correspond = (texte: string, active: boolean, manuel = false) => normaliser(texte).includes(normaliser(recherche.trim()))
    && (filtre === 'tous' || (filtre === 'actives' ? active : filtre === 'arretees' ? !active && !manuel : manuel))
  const visiblesCrm = r ? AUTOMATISATIONS.filter((a) => correspond(`${a.titre} ${a.description} ${DETAILS_CRM[a.cle]} ${FAMILLES[a.famille].titre}`, activeCrm(a.cle, r))) : []
  const visiblesN8n = workflows.filter((w) => { const notice = noticeN8n(w); return correspond(`${notice.titre} ${notice.description} ${w.nom} n8n`, w.active, !w.pilotable) })
  const actives = (r ? AUTOMATISATIONS.filter((a) => activeCrm(a.cle, r)).length : 0) + workflows.filter((w) => w.active).length
  const complet = !!r && !reglages.isError && !!n8n.data && !n8n.isError
  const enCours = set.isPending || modifier.isPending

  const sauver = async (cle: string, valeur: string, attendue: string) => {
    try {
      await set.mutateAsync({ cle, valeur, attendue })
      toast.success('Réglage enregistré')
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
      toast.error(message.includes('reglage_modifie') ? 'Ce réglage a été modifié ailleurs. Vérifiez la valeur actualisée.'
        : message.includes('plage_horaire') ? 'L’heure de fin doit être après l’heure de début.' : 'Enregistrement non confirmé. Vérifiez la valeur actualisée avant de réessayer.')
      throw error
    }
  }
  const basculer = (w: AutomatisationN8n, active: boolean) => modifier.mutate({ workflow: w, active }, {
    onSuccess: () => toast.success(`${noticeN8n(w).titre} : ${active ? 'activé' : 'désactivé'}`),
    onError: (e) => toast.error(e.message),
  })

  return <div className="mx-auto max-w-5xl space-y-6 pb-8">
    <PageHeader titre="Automatisations" sousTitre="Gardez la main sur ce qui se déclenche, ce qui s’envoie et ce qui se synchronise." />
    <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-4 text-sm text-violet-950">
      <div className="flex items-center gap-2 font-semibold"><Workflow className="size-4" /> Votre centre de contrôle</div>
      <p className="mt-1 leading-relaxed">Chaque interrupteur commande le service concerné. Survolez le bouton ⓘ ou touchez-le pour connaître son fonctionnement et l’effet d’un arrêt.</p>
      <p className="mt-2 text-xs leading-relaxed">Un arrêt bloque les nouveaux déclenchements. Un traitement déjà lancé ou un email déjà programmé peut encore aboutir. « Actif » indique que le déclenchement est autorisé, pas que chaque exécution a réussi.</p>
    </div>

    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
        <Input aria-label="Rechercher une automatisation" placeholder="Rechercher : email, inscription, rappel…" value={recherche} onChange={(e) => setRecherche(e.target.value)} className="h-11 pl-10" />
      </div>
      <select aria-label="Filtrer les automatisations" value={filtre} onChange={(e) => setFiltre(e.target.value)} className="h-11 rounded-lg border bg-background px-3 text-sm">
        <option value="tous">Tous les états</option><option value="actives">Actives</option><option value="arretees">Désactivées ou en pause</option><option value="manuelles">Manuelles ou archivées</option>
      </select>
      <Button variant="outline" className="h-11" disabled={enCours || reglages.isFetching || n8n.isFetching} onClick={() => { void reglages.refetch(); void n8n.refetch(); void journal.refetch() }}>
        <RefreshCw className={cn('size-4', (reglages.isFetching || n8n.isFetching) && 'animate-spin')} /> Actualiser
      </Button>
    </div>
    <p className="text-sm text-muted-foreground" aria-live="polite">{complet ? `${actives} actives · ${AUTOMATISATIONS.length + workflows.length} éléments recensés` : 'Inventaire en cours ou partiellement indisponible'}
      {n8n.data && !n8n.isError && <span className="ml-2 text-xs">État n8n vérifié le {formatDateHeure(n8n.data.verifie_le)}</span>}
    </p>

    <section aria-label="Automatismes du CRM" className="space-y-4">
      <div><h2 className="text-lg font-semibold">Dans le CRM</h2><p className="text-sm text-muted-foreground">Relances, notifications et traitements internes.</p></div>
      {reglages.isError ? <Erreur message="Impossible de lire les réglages du CRM." retry={() => void reglages.refetch()} /> : !r ? <Chargement /> : <>
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <PauseCircle className="mt-0.5 size-5 shrink-0 text-amber-700" />
          <div className="min-w-0 flex-1"><label htmlFor="pause-relances" className="font-medium">{r.relances_pause ? 'Relances en pause' : 'Relances autorisées'}</label>
            <p className="mt-1 text-sm text-muted-foreground">Ce réglage concerne uniquement les quatre relances ci-dessous. Vos choix individuels sont conservés ; les autres emails et rappels restent indépendants.</p>
          </div>
          <Switch id="pause-relances" aria-label="Autoriser les relances automatiques" checked={!r.relances_pause} disabled={enCours}
            onCheckedChange={(v) => { void sauver('relances_pause', v ? 'off' : 'on', r.relances_pause ? 'on' : 'off').catch(() => {}) }} />
        </div>
        {(Object.keys(FAMILLES) as FamilleAutomatisation[]).map((famille) => {
          const lot = visiblesCrm.filter((a) => a.famille === famille)
          if (!lot.length) return null
          const info = FAMILLES[famille]
          return <Card key={famille} className="overflow-hidden rounded-xl border-border/80 shadow-none">
            <CardHeader className="border-b bg-muted/30 py-4"><div className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: info.couleur }} /><CardTitre>{info.titre}</CardTitre><Badge variant="secondary" className="ml-auto">{lot.length}</Badge></div></CardHeader>
            <CardContent className="divide-y p-0">{lot.map((a) => {
              const suspendue = !!r.bascules[a.cle] && !activeCrm(a.cle, r)
              return <div key={a.cle} data-automatisation={a.cle} className="flex items-start gap-2 p-4 sm:gap-4 sm:p-5">
                <div className="min-w-0 flex-1"><label htmlFor={a.cle} className="text-sm font-semibold">{a.titre}</label><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{a.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2"><Etat active={activeCrm(a.cle, r)} pause={suspendue} /><span className="text-xs text-muted-foreground">{suspendue ? famille === 'relance' ? 'Choix conservé · relances en pause' : 'Dépend de la pré-mesure' : a.declencheur}</span></div>
                </div>
                <div className="flex shrink-0 flex-col items-center gap-2 sm:flex-row">
                  <AutomatisationDetails titre={a.titre}><p>{DETAILS_CRM[a.cle]}</p><p className="text-muted-foreground">Déclenchement : {a.declencheur}. {a.famille === 'relance' && 'Dépend également de la pause générale et de la plage horaire des relances.'}</p>{(a.famille === 'notif_interne' || a.famille === 'relance') && <p className="text-muted-foreground">Pour les emails, le moteur « Emails et notifications du CRM » doit aussi être actif dans n8n.</p>}</AutomatisationDetails>
                  <Switch id={a.cle} checked={r.bascules[a.cle]} disabled={enCours} onCheckedChange={(v) => { void sauver(a.cle, v ? 'on' : 'off', r.bascules[a.cle] ? 'on' : 'off').catch(() => {}) }} />
                </div>
              </div>
            })}</CardContent>
          </Card>
        })}
      </>}
    </section>

    <section aria-label="Workflows n8n" className="space-y-4">
      <div><h2 className="text-lg font-semibold">Services connectés · n8n</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Tous les scénarios de votre instance, y compris ceux des sites, du portail et les anciens modèles. Leur nom d’origine reste visible pour les reconnaître.</p></div>
      {n8n.isError ? <Erreur message={n8n.error.message} retry={() => void n8n.refetch()} /> : n8n.isPending ? <Chargement /> : workflows.length === 0 ? <p className="text-sm text-muted-foreground">Aucun workflow accessible dans cette instance n8n.</p> : <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {visiblesN8n.map((w) => {
          const notice = noticeN8n(w)
          return <div key={w.id} data-workflow={w.id} className="flex items-start gap-2 p-4 sm:gap-4 sm:p-5">
            <div className="min-w-0 flex-1"><label htmlFor={`n8n-${w.id}`} className="text-sm font-semibold">{notice.titre}</label><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{notice.description}</p><p className="mt-1 break-words text-xs text-muted-foreground">{w.nom}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2"><Etat active={w.active} manuel={!w.pilotable} archivee={w.archivee} /><span className="text-xs text-muted-foreground">{w.declencheurs.join(' · ')}</span>{w.brouillon && <Badge variant="outline" className="text-xs">Brouillon non publié</Badge>}</div>
            </div>
            <div className="flex shrink-0 flex-col items-center gap-2 sm:flex-row">
              <AutomatisationDetails titre={notice.titre}><p>{notice.details}</p><p className="text-muted-foreground">{w.archivee ? 'Scénario archivé : restaurez-le dans n8n avant de pouvoir l’activer.' : !w.pilotable ? 'Sans déclencheur automatique, aucun interrupteur de publication n’est nécessaire.' : 'L’arrêt suspend les nouveaux déclenchements. Les exécutions déjà lancées ne sont pas annulées. Après une pause depuis le CRM, la reprise conserve la version précédemment publiée.'}</p></AutomatisationDetails>
              {w.pilotable && <Switch id={`n8n-${w.id}`} checked={w.active} disabled={enCours} onCheckedChange={(active) => {
                if (active && notice.sensible) setConfirmation(w)
                else basculer(w, active)
              }} />}
            </div>
          </div>
        })}
      </div>}
    </section>
    {complet && visiblesCrm.length + visiblesN8n.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Aucune automatisation ne correspond à cette recherche.</p>}

    {r && !reglages.isError && <details className="rounded-xl border bg-card p-4 sm:p-5">
      <summary className="cursor-pointer font-semibold">Délais, horaires et plafond</summary>
      <p className="mt-3 text-sm text-muted-foreground">Les horaires ci-dessous s’appliquent aux relances, en heure de Paris. Les autres emails suivent leur propre déclenchement.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{CHAMPS.map(([cle, label]) => <Champ key={`${cle}-${r[cle]}`} cle={cle} label={label} val={r[cle]} disabled={enCours} onSave={(valeur) => sauver(cle, valeur, r[cle])} />)}</div>
    </details>}

    <details className="rounded-xl border bg-card p-4 sm:p-5" open>
      <summary className="cursor-pointer font-semibold">Derniers changements</summary>
      {journal.isError ? <p role="alert" className="mt-3 text-sm text-destructive">Le journal est indisponible.<button className="ml-2 underline" onClick={() => void journal.refetch()}>Réessayer</button></p> : journal.isPending ? <Chargement /> : !journal.data?.length ? <p className="mt-3 text-sm text-muted-foreground">Vos prochains changements apparaîtront ici.</p> : <ul className="mt-3 divide-y">{journal.data.map((x) => <li key={x.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><span className="font-medium">{AUTOMATISATIONS.find((a) => a.cle === x.cle)?.titre ?? (x.cle === 'relances_pause' ? 'Pause des relances' : CHAMPS.find(([cle]) => cle === x.cle)?.[1] ?? x.titre)}</span><span className="ml-2 text-muted-foreground">{x.avant === 'on' ? 'Activé' : x.avant === 'off' ? 'Désactivé' : x.avant ?? '—'} → {x.apres === 'on' ? 'Activé' : x.apres === 'off' ? 'Désactivé' : x.apres}</span></div>
        <time className="shrink-0 text-xs text-muted-foreground" dateTime={x.created_at}>{formatDateHeure(x.created_at)}</time>
      </li>)}</ul>}
    </details>
    <details className="rounded-xl border bg-card p-4 sm:p-5"><summary className="cursor-pointer font-semibold">Historique des relances</summary>
      {relances.isError ? <p role="alert" className="mt-3 text-sm text-destructive">Historique indisponible.</p> : relances.isPending ? <Chargement /> : !relances.data?.length ? <p className="mt-3 text-sm text-muted-foreground">Aucune relance enregistrée pour le moment.</p> : <ul className="mt-3 divide-y">{relances.data.map((x) => <li key={x.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:justify-between"><span>{TYPE_LABEL[x.type] ?? x.type} · {destinataireRelance(x)}{x.projet?.client_nom ? ` · ${x.projet.client_nom}` : ''}</span><span className="shrink-0 text-xs text-muted-foreground">{formatDateHeure(x.sent_at)}</span></li>)}</ul>}
    </details>
    <AlertDialog open={!!confirmation} onOpenChange={(open) => { if (!open) setConfirmation(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Réactiver la suppression des sites ?</AlertDialogTitle><AlertDialogDescription>Ce scénario peut supprimer les dépôts GitHub et les projets Vercel des sites concernés à la prochaine demande. Sa réactivation autorise ces suppressions.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Annuler</AlertDialogCancel><AlertDialogAction onClick={() => { if (confirmation) basculer(confirmation, true); setConfirmation(null) }}>Réactiver ce scénario</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}

function Chargement() { return <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" /> Lecture des états…</div> }
function Erreur({ message, retry }: { message: string; retry: () => void }) { return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>{message} Les commandes concernées restent indisponibles tant que leur état n’est pas vérifié.</p><Button variant="outline" className="mt-3" onClick={retry}>Réessayer</Button></div> }
function Etat({ active, pause, manuel, archivee }: { active: boolean; pause?: boolean; manuel?: boolean; archivee?: boolean }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium', active ? 'bg-emerald-100 text-emerald-900' : pause ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600')}><span className={cn('size-1.5 rounded-full', active ? 'bg-emerald-600' : pause ? 'bg-amber-600' : 'bg-slate-400')} />{archivee ? 'Archivé' : manuel ? 'Manuel' : pause ? 'En pause' : active ? 'Actif' : 'Désactivé'}</span>
}
function Champ({ cle, label, val, disabled, onSave }: { cle: string; label: string; val: string; disabled: boolean; onSave: (valeur: string) => Promise<void> }) {
  const heure = cle.startsWith('heure_')
  return <div className="space-y-1.5"><Label htmlFor={`reglage-${cle}`} className="text-xs">{label}</Label><Input id={`reglage-${cle}`} type="number" min={heure || cle === 'creatives_plafond_mois' ? 0 : 1} max={heure ? 23 : cle === 'creatives_plafond_mois' ? 100000 : 8760} step={1} className="h-11" defaultValue={val} disabled={disabled} onBlur={(e) => {
    const input = e.currentTarget
    if (input.value === val) return
    if (!input.value || !input.checkValidity()) { toast.error('Saisissez un nombre entier dans la plage autorisée.'); input.value = val; return }
    void onSave(String(Number(input.value))).catch(() => { input.value = val })
  }} /></div>
}
