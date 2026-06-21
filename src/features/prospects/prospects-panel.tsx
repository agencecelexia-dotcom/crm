import { useState } from 'react'
import { Phone, PhoneOff, Ban, Tag, Check, UserPlus, Loader2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { METIERS, SOUS_METIERS } from '@/lib/constants'
import { formatTel } from '@/lib/format'
import type { Prospect } from '@/types/database'
import {
  useProspectsAutour,
  useMajProspect,
  usePasDeReponse,
  useConvertirEnArtisan,
} from './use-prospects'

export function ProspectsPanel({
  lat,
  lon,
  metierDefault,
  contexte,
  onClose,
}: {
  lat: number | null
  lon: number | null
  metierDefault?: string | null
  contexte?: string
  onClose: () => void
}) {
  const [metier, setMetier] = useState(metierDefault || 'tous')
  const metierParam = metier === 'tous' ? null : metier
  const { data: prospects, isLoading } = useProspectsAutour(lat, lon, metierParam)

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="flex max-h-[92dvh] flex-col overflow-hidden">
        <SheetHeader>
          <SheetTitle>Sociétés à démarcher autour</SheetTitle>
          <SheetDescription>
            {contexte ? `${contexte} — ` : ''}du plus proche au plus loin. Appelle et qualifie : un
            « négatif » ne réapparaîtra plus, un « pas de réponse » revient dans 2 jours.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-2">
          <Select value={metier} onValueChange={setMetier}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue placeholder="Métier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">Tous métiers</SelectItem>
              {METIERS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
          {lat == null || lon == null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Ce projet n'a pas de localisation — impossible de trier par distance.
            </p>
          ) : isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
          ) : !prospects || prospects.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aucune société à démarcher dans ce métier autour de ce point.
            </p>
          ) : (
            prospects.map((p) => <ProspectRow key={p.id} p={p} />)
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function ProspectRow({ p }: { p: Prospect }) {
  const maj = useMajProspect()
  const pasRep = usePasDeReponse()
  const convertir = useConvertirEnArtisan()
  const [tagging, setTagging] = useState(false)
  const [tags, setTags] = useState<string[]>(p.metiers ?? [])
  const [recruiting, setRecruiting] = useState(false)
  const [sousNiches, setSousNiches] = useState<string[]>([])
  const [rayon, setRayon] = useState(30)
  const busy = maj.isPending || pasRep.isPending || convertir.isPending

  const tel = p.tel || p.tel2
  const toggleTag = (m: string) =>
    setTags((t) => (t.includes(m) ? t.filter((x) => x !== m) : [...t, m]))
  const toggleSousNiche = (s: string) =>
    setSousNiches((t) => (t.includes(s) ? t.filter((x) => x !== s) : [...t, s]))

  return (
    <Card className="space-y-2 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{p.company_name || 'Société'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {p.profession || p.metiers?.join(', ') || '—'}
            {p.city && ` · ${p.city}`}
            {p.distance_km != null && ` · ${Math.round(p.distance_km)} km`}
          </p>
          {(p.nb_appels > 0 || p.statut === 'ok_autre_metier' || p.statut === 'interesse') && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {p.nb_appels > 0 && `📞 appelé ${p.nb_appels}× · `}
              {p.statut === 'ok_autre_metier' && '👍 OK apport (autres métiers) · '}
              {p.statut === 'interesse' && '⭐ intéressé · '}
              {p.metiers?.length ? `fait : ${p.metiers.join(', ')}` : ''}
            </p>
          )}
        </div>
        {tel && (
          <Button asChild size="sm" className="h-9 shrink-0 rounded-full">
            <a href={`tel:${tel}`}>
              <Phone className="size-4" />
              {formatTel(tel)}
            </a>
          </Button>
        )}
      </div>

      {/* Tag métiers (quand "OK apport — pas ce chantier") */}
      {tagging ? (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <p className="text-xs font-medium">Quels métiers fait-il vraiment ?</p>
          <div className="flex flex-wrap gap-1.5">
            {METIERS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => toggleTag(m)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  tags.includes(m)
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setTagging(false)}>
              Annuler
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={busy || tags.length === 0}
              onClick={() =>
                maj.mutate(
                  { id: p.id, patch: { statut: 'ok_autre_metier', metiers: tags } },
                  {
                    onSuccess: () => {
                      toast.success('Métiers enregistrés — prioritaire pour ces chantiers')
                      setTagging(false)
                    },
                  },
                )
              }
            >
              <Check className="size-4" />
              Enregistrer
            </Button>
          </div>
        </div>
      ) : recruiting ? (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <p className="text-xs font-medium">Recruter comme apporteur — que fait-il exactement ?</p>
          <div className="space-y-2">
            {(p.metiers?.length ? p.metiers : METIERS).map((m) =>
              SOUS_METIERS[m] ? (
                <div key={m} className="space-y-1">
                  <p className="text-[11px] font-semibold text-muted-foreground">{m}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SOUS_METIERS[m].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleSousNiche(s)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs transition-colors',
                          sousNiches.includes(s)
                            ? 'border-transparent bg-primary text-primary-foreground'
                            : 'border-border bg-card text-muted-foreground hover:bg-accent',
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Rayon d'intervention</span>
            <Select value={String(rayon)} onValueChange={(v) => setRayon(Number(v))}>
              <SelectTrigger className="h-9 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[15, 30, 50, 80].map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {r} km
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setRecruiting(false)}>
              Annuler
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={busy || sousNiches.length === 0}
              onClick={() =>
                convertir.mutate(
                  { prospectId: p.id, sousMetiers: sousNiches, rayonKm: rayon },
                  {
                    onSuccess: () =>
                      toast.success(`${p.company_name || 'Société'} recruté comme apporteur`),
                    onError: (e) =>
                      toast.error('Échec', { description: e instanceof Error ? e.message : undefined }),
                  },
                )
              }
            >
              {convertir.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Recruter
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full text-muted-foreground"
            disabled={busy}
            onClick={() => pasRep.mutate(p, { onSuccess: () => toast.success('Noté — revient dans 2 jours') })}
          >
            <PhoneOff className="size-3.5" />
            Pas de réponse
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full text-destructive"
            disabled={busy}
            onClick={() =>
              maj.mutate(
                { id: p.id, patch: { statut: 'negatif' } },
                { onSuccess: () => toast.success('Marqué négatif — ne réapparaîtra plus') },
              )
            }
          >
            <Ban className="size-3.5" />
            Négatif
          </Button>
          <Button variant="ghost" size="sm" className="h-8 rounded-full" disabled={busy} onClick={() => setTagging(true)}>
            <Tag className="size-3.5" />
            OK apport — pas ce chantier
          </Button>
          <Button
            size="sm"
            className="h-8 rounded-full"
            disabled={busy}
            onClick={() => {
              setSousNiches([])
              setRecruiting(true)
            }}
          >
            <UserPlus className="size-3.5" />
            Intéressé → Recruter
          </Button>
          {p.google_maps_url && (
            <Button asChild variant="ghost" size="sm" className="h-8 rounded-full text-muted-foreground">
              <a href={p.google_maps_url} target="_blank" rel="noopener">
                <ExternalLink className="size-3.5" />
                Maps
              </a>
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}
