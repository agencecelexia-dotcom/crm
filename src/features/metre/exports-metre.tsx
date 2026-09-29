import { useState, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Box, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { csvDuRapport, rapportMetre } from './rapport-metre'
import { nomDeFichier, telechargerRapport } from './rapport-pdf'
import type { Releve } from './releve'
import { requeteMateriauxToit, requetePhotosFacade } from './use-photos-facade'
import type { OutilsVue3D } from './vue-3d'

function telecharger(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/**
 * Le métré à emporter : le rapport PDF (la maison en 3D, le plan coté, les
 * tableaux, les élévations, les sources), le tableau pour Excel, et le modèle
 * 3D (.glb) quand la vue 3D a été ouverte.
 */
export function ExportsMetre({
  token,
  cleabs,
  releve,
  pans,
  titre,
  adresse,
  bdnb,
  outils3d,
}: {
  token: string
  cleabs: string | null
  releve: Releve
  pans: number[] | null
  titre: string | null
  adresse: string | null
  bdnb: { toit?: string | null; murs?: string | null } | null
  outils3d?: RefObject<OutilsVue3D | null>
}) {
  const qc = useQueryClient()
  const [enCours, setEnCours] = useState<'pdf' | 'csv' | 'glb' | null>(null)

  async function rapport() {
    // Les photos et le matériau du toit, déjà en cache le plus souvent.
    const [photos, materiaux] = await Promise.all([
      cleabs ? qc.fetchQuery(requetePhotosFacade(token, cleabs)).catch(() => []) : [],
      cleabs ? qc.fetchQuery(requeteMateriauxToit(token, cleabs)).catch(() => null) : null,
    ])
    return rapportMetre({ titre, adresse, date: new Date(), releve, pans, photos, materiaux, bdnb })
  }

  async function lancer(quoi: 'pdf' | 'csv' | 'glb') {
    setEnCours(quoi)
    try {
      if (quoi === 'glb') {
        const blob = await outils3d!.current!.glb()
        telecharger(blob, nomDeFichier(await rapport(), 'glb'))
      } else if (quoi === 'csv') {
        const r = await rapport()
        telecharger(new Blob([csvDuRapport(r)], { type: 'text/csv;charset=utf-8' }), nomDeFichier(r, 'csv'))
      } else {
        const r = await rapport()
        await telechargerRapport(r, releve, outils3d?.current?.image() ?? null)
      }
    } catch (e) {
      toast.error('Export impossible', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setEnCours(null)
    }
  }

  const icone = (quoi: typeof enCours, I: typeof FileText) =>
    enCours === quoi ? <Loader2 className="size-4 animate-spin" /> : <I className="size-4" />
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" className="min-h-11" disabled={!!enCours} onClick={() => lancer('pdf')}>
        {icone('pdf', FileText)}
        Rapport PDF
      </Button>
      <Button variant="outline" className="min-h-11" disabled={!!enCours} onClick={() => lancer('csv')}>
        {icone('csv', FileSpreadsheet)}
        Tableau Excel
      </Button>
      {/* Passés seulement quand la vue 3D est prête. */}
      {outils3d && (
        <Button variant="outline" className="col-span-2 min-h-11" disabled={!!enCours} onClick={() => lancer('glb')}>
          {icone('glb', Box)}
          Modèle 3D (.glb)
        </Button>
      )}
    </div>
  )
}
