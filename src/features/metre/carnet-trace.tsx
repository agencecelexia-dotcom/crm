import { useId } from 'react'
import { Check, Crosshair, Loader2, Pencil, RotateCcw, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { aire, formatM, formatM2, longueur, type Point } from './geometrie'
import type { Metre } from './use-metres'

import { traceManuelModifiable, traceModifie } from './edition-trace'

/** Le carnet modifie uniquement le dessin sauvegardé, jamais les quantités validées du dossier. */
export function CarnetTrace({ metre, edition, trace, nom, sommet, enCours, erreur, onNom, onEdition, onTrace, onSommet, onCentre, onSauver, onAnnuler, onFermer }: {
  metre: Metre; edition: boolean; trace: Point[]; nom: string; sommet: number | null
  enCours: boolean; erreur: string | null
  onNom: (nom: string) => void; onEdition: () => void; onTrace: (trace: Point[]) => void
  onSommet: (sommet: number | null) => void; onCentre: () => void
  onSauver: () => void; onAnnuler: () => void; onFermer: () => void
}) {
  const id = useId()
  const surface = metre.type === 'surface'
  const assez = trace.length >= (surface ? 3 : 2)
  const change = traceModifie(metre, nom, trace)
  return (
    <section aria-label="Tracé du carnet" className="space-y-4 rounded-xl border border-primary/25 bg-card p-4">
      <div><p className="text-xs text-muted-foreground">{edition ? 'Modification du tracé' : 'Tracé enregistré'}</p><h2 className="mt-1 break-words text-base font-medium">{metre.nom}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{edition ? 'Les changements remplacent ce tracé après enregistrement. Les quantités confirmées du dossier restent distinctes.' : 'Retrouvez votre dessin en violet sur la carte et ses dimensions avant de le modifier.'}</p></div>
      <p className="text-lg font-medium tabular-nums" aria-live="polite">{assez ? surface ? formatM2(aire(trace)) : formatM(longueur(trace, false)) : 'Tracé incomplet'}<span className="ml-2 text-xs font-normal text-muted-foreground">{trace.length} point{trace.length > 1 ? 's' : ''} · estimation à distance</span></p>
      {edition ? <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (assez && nom.trim() && change && !enCours) onSauver() }}>
        <fieldset disabled={enCours} className="min-w-0 space-y-4">
          <div className="space-y-1.5"><label htmlFor={`${id}-nom`} className="text-sm">Nom du tracé</label><Input id={`${id}-nom`} value={nom} onChange={(e) => onNom(e.target.value)} maxLength={120} required className="h-11" /></div>
          <div className="space-y-1.5"><label htmlFor={`${id}-point`} className="text-sm">Action sur la carte</label><select id={`${id}-point`} value={sommet ?? ''} onChange={(e) => onSommet(e.target.value === '' ? null : Number(e.target.value))} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Ajouter un point</option>{trace.map((_, i) => <option key={i} value={i}>Déplacer le point {i + 1}</option>)}</select><p className="text-xs leading-5 text-muted-foreground">{sommet == null ? 'Touchez la carte pour ajouter un point à la fin du tracé.' : `Touchez le nouvel emplacement du point ${sommet + 1}.`} Vous pouvez aussi déplacer la carte puis placer le point au centre.</p></div>
          <Button type="button" variant="outline" className="h-auto min-h-11 w-full whitespace-normal" onClick={onCentre}><Crosshair className="size-4 shrink-0" />Placer le point au centre</Button>
          <div className="grid gap-2 sm:grid-cols-2"><Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={!trace.length} onClick={() => { onTrace(trace.slice(0, -1)); onSommet(null) }}><Undo2 className="size-4 shrink-0" />Retirer le dernier point</Button><Button type="button" variant="outline" className="min-h-11" disabled={!trace.length} onClick={() => { if (window.confirm('Redessiner ce tracé ? La version enregistrée reste conservée jusqu’à votre sauvegarde.')) { onTrace([]); onSommet(null) } }}><RotateCcw className="size-4" />Redessiner</Button></div>
          {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
          <div className="grid gap-2 sm:grid-cols-2"><Button type="submit" className="h-auto min-h-11 whitespace-normal" disabled={!assez || !nom.trim() || !change || enCours}>{enCours ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Check className="size-4 shrink-0" />}Enregistrer les modifications</Button><Button type="button" variant="outline" className="min-h-11" onClick={onAnnuler}>Annuler les modifications</Button></div>
        </fieldset>
      </form> : <><div className="grid gap-2 sm:grid-cols-2">{traceManuelModifiable(metre) && <Button className="min-h-11" onClick={onEdition}><Pencil className="size-4" />Modifier le tracé</Button>}<Button variant="outline" className="min-h-11" onClick={onFermer}>Fermer le tracé</Button></div>{!traceManuelModifiable(metre) && <p className="text-xs leading-5 text-muted-foreground">Ce tracé est consultable. Sa modification n’est pas disponible pour ce chantier.</p>}</>}
    </section>
  )
}
