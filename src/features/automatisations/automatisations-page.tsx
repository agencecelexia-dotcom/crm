import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CardTitre } from '@/components/card-titre'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { formatDateHeure } from '@/lib/format'
import { useReglages, useSetReglage, useRelances, destinataireRelance } from './use-automatisations'

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
          <Card className="mb-4 rounded-2xl border-border/70 shadow-card">
            <CardHeader>
              <CardTitre>Relances actives</CardTitre>
            </CardHeader>
            <CardContent className="space-y-4">
              <Bascule
                titre="Contrat non signé"
                desc="Relance l'artisan assigné qui n'a pas signé, puis escalade (email + alerte « à appeler »)."
                on={r.auto_contrat}
                onChange={(v) => toggle('auto_contrat', v)}
              />
              <Bascule
                titre="Inaction sur un chantier"
                desc="Relance l'artisan dont le chantier est figé (assigné/contacté/RDV/en attente)."
                on={r.auto_inaction}
                onChange={(v) => toggle('auto_inaction', v)}
              />
              <Bascule
                titre="Suivi post-RDV"
                desc="Relance l'artisan 24 h après son rendez-vous s'il n'a pas mis à jour le suivi (« comment s'est passé le RDV, pensez au devis »)."
                on={r.auto_post_rdv}
                onChange={(v) => toggle('auto_post_rdv', v)}
              />
              <Bascule
                titre="Leads non attribués"
                desc="Digest quotidien à l'agence des projets « nouveau » sans artisan depuis +24 h."
                on={r.auto_orphelin}
                onChange={(v) => toggle('auto_orphelin', v)}
              />
            </CardContent>
          </Card>

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
                          <Badge className="shrink-0 border-transparent text-xs" style={{ backgroundColor: t.color, color: '#fff' }}>
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

function Bascule({
  titre,
  desc,
  on,
  onChange,
}: {
  titre: string
  desc: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{titre}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={on} onCheckedChange={onChange} />
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
