import { Loader2, PauseCircle, PlayCircle } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatDateHeure } from '@/lib/format'
import { useReglages, useSetReglage, useRelances, destinataireRelance } from './use-automatisations'
import { AUTOMATISATIONS, FAMILLES, type FamilleAutomatisation } from './catalogue'

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  contrat: { label: 'Relance contrat', color: '#F59E0B' },
  contrat_escalade: { label: 'Escalade contrat (à appeler)', color: '#EF4444' },
  inaction: { label: 'Relance inaction', color: '#3B82F6' },
  inaction_escalade: { label: 'Escalade inaction (à appeler)', color: '#EF4444' },
  post_rdv: { label: 'Relance post-RDV', color: '#8B5CF6' },
  orphelin: { label: 'Digest leads non attribués', color: '#0F766E' },
}

export function AutomatisationsPage() {
  const { data: r, isLoading } = useReglages()
  const set = useSetReglage()
  const { data: relances } = useRelances(80)

  const toggle = (cle: string, valeur: boolean) =>
    set.mutate(
      { cle, valeur: valeur ? 'on' : 'off' },
      { onSuccess: () => toast.success(valeur ? 'Activé' : 'Désactivé') },
    )
  const setNum = (cle: string, valeur: string) => {
    if (valeur.trim() && !isNaN(Number(valeur))) set.mutate({ cle, valeur: valeur.trim() })
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader titre="Automatisations" sousTitre="Relances anti-inaction (emails + alertes)" />

      {isLoading || !r ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Interrupteur maître. Volontairement séparé et au-dessus : couper
              temporairement TOUT sans perdre le réglage fin de chaque relance. */}
          <Card
            className={cn(
              'mb-4 rounded-2xl shadow-card transition-colors',
              r.relances_pause ? 'border-[#F59E0B]/50 bg-[#F59E0B]/5' : 'border-border/70',
            )}
          >
            <CardContent className="flex items-start gap-3 py-4">
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full',
                  r.relances_pause
                    ? 'bg-[#F59E0B]/15 text-[#B45309]'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {r.relances_pause ? <PauseCircle className="size-5" /> : <PlayCircle className="size-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {r.relances_pause ? 'Relances en pause' : 'Relances automatiques actives'}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {r.relances_pause
                    ? "Aucune relance ne part vers les artisans. Les mails « nouveau chantier » et vos rappels de tâches continuent normalement. Les réglages ci-dessous sont conservés."
                    : 'Les relances ci-dessous tournent toutes les 30 min, dans la plage horaire définie.'}
                </p>
              </div>
              <Switch
                checked={!r.relances_pause}
                onCheckedChange={(v) =>
                  set.mutate(
                    { cle: 'relances_pause', valeur: v ? 'off' : 'on' },
                    {
                      onSuccess: () =>
                        toast.success(v ? 'Relances réactivées' : 'Relances mises en pause'),
                    },
                  )
                }
                aria-label="Activer ou mettre en pause toutes les relances automatiques"
              />
            </CardContent>
          </Card>

          {/* Toutes les automatisations, groupées par famille. La liste vient
              du catalogue : y ajouter une entrée suffit à la rendre pilotable
              ici, sans toucher à cet écran. */}
          {(Object.keys(FAMILLES) as FamilleAutomatisation[]).map((famille) => {
            const lot = AUTOMATISATIONS.filter((a) => a.famille === famille)
            if (lot.length === 0) return null
            const info = FAMILLES[famille]
            // Les relances dépendent en plus de l'interrupteur maître.
            const suspendue = famille === 'relance' && r.relances_pause

            return (
              <Card
                key={famille}
                className={cn(
                  'mb-4 rounded-2xl border-border/70 shadow-card transition-opacity',
                  suspendue && 'pointer-events-none opacity-50',
                )}
                aria-disabled={suspendue}
              >
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: info.couleur }}
                      aria-hidden
                    />
                    <CardTitre>{info.titre}</CardTitre>
                    <Badge variant="secondary" className="ml-auto text-xs font-normal">
                      {lot.filter((a) => r.bascules[a.cle]).length}/{lot.length} actives
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{info.description}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {lot.map((a) => (
                    <div key={a.cle} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {a.titre}
                          {a.lectureSeule && (
                            <span
                              className="ml-2 align-middle text-[10px] font-normal uppercase tracking-wide text-muted-foreground"
                              title="Cette automatisation tourne mais son interrupteur n'est pas encore câblé côté base."
                            >
                              non coupable
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{a.description}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground/70">
                          Déclencheur : {a.declencheur}
                        </p>
                      </div>
                      <Switch
                        checked={r.bascules[a.cle] ?? true}
                        disabled={a.lectureSeule}
                        onCheckedChange={(v) => toggle(a.cle, v)}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )
          })}

          <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
            <CardHeader>
              <CardTitre>Délais & horaires</CardTitre>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Champ label="1ʳᵉ relance (h)" cle="relance_premier_h" val={r.relance_premier_h} onSave={setNum} />
              <Champ label="Intervalle relances (h)" cle="relance_interval_h" val={r.relance_interval_h} onSave={setNum} />
              <Champ label="Escalade Thomas (h)" cle="relance_escalade_h" val={r.relance_escalade_h} onSave={setNum} />
              <div />
              <Champ label="Post-RDV : 1ʳᵉ relance (h)" cle="post_rdv_premier_h" val={r.post_rdv_premier_h} onSave={setNum} />
              <Champ label="Post-RDV : 2ᵉ relance (h)" cle="post_rdv_relance_h" val={r.post_rdv_relance_h} onSave={setNum} />
              <Champ label="Envois à partir de (h)" cle="heure_debut" val={r.heure_debut} onSave={setNum} />
              <Champ label="Envois jusqu'à (h)" cle="heure_fin" val={r.heure_fin} onSave={setNum} />
              <p className="col-span-2 text-xs text-muted-foreground">
                Aucun email n'est envoyé en dehors de cette plage horaire (Europe/Paris).
              </p>
            </CardContent>
          </Card>

          <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
            <CardHeader>
              <CardTitre>Historique des relances</CardTitre>
            </CardHeader>
            <CardContent>
              {!relances || relances.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune relance envoyée pour le moment.</p>
              ) : (
                <ul className="space-y-2">
                  {relances.map((x) => {
                    const t = TYPE_LABEL[x.type] ?? { label: x.type, color: '#64748B' }
                    return (
                      <li key={x.id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge className="shrink-0 rounded-full border-transparent text-xs font-medium" style={{ backgroundColor: `${t.color}1a`, color: t.color }}>
                            {t.label}
                          </Badge>
                          <span className="truncate text-muted-foreground">
                            → {destinataireRelance(x)}
                            {x.projet?.client_nom ? ` · projet ${x.projet.client_nom}` : ''}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDateHeure(x.sent_at)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Champ({
  label,
  cle,
  val,
  onSave,
}: {
  label: string
  cle: string
  val: string
  onSave: (cle: string, valeur: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        className="h-10"
        defaultValue={val}
        onBlur={(e) => e.target.value !== val && onSave(cle, e.target.value)}
      />
    </div>
  )
}
