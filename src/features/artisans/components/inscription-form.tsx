import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, Pencil, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DEPARTEMENTS, DEPARTEMENT_NOM, METIERS, SOUS_METIERS } from '@/lib/constants'
import { geocoder } from '@/lib/geocoding'
import { cn } from '@/lib/utils'
import type { ArtisanInput, ZoneCouverte } from '@/types/database'
import { SocieteSearch } from './societe-search'
import { metiersInscription, preparerInscription, schemaBrouillonInscription, validerInscription, type DonneesInscription, type ErreursInscription } from '../inscription-modele'

const ETAPES = ['Vos coordonnées', 'Votre entreprise', 'Votre activité et votre secteur', 'Vérifiez vos informations']
const AIDES = ['Ces coordonnées nous permettront de vous joindre pour un chantier.', 'Recherchez votre entreprise pour gagner du temps, ou saisissez ses informations.', 'Choisissez les travaux que vous réalisez et les endroits où vous vous déplacez.', 'Vous pouvez encore tout modifier avant de passer au contrat.']
const SELECT = 'h-12 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm'
const CHOIX = 'min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors'

function lireBrouillon(cle: string) {
  try {
    const brut = JSON.parse(sessionStorage.getItem(cle) ?? 'null')
    const donnees = schemaBrouillonInscription.safeParse(brut?.donnees)
    if (donnees.success) return { donnees: donnees.data, etape: Number.isInteger(brut.etape) ? Math.min(3, Math.max(0, brut.etape)) : 0 }
  } catch { /* La saisie reste possible si le stockage du navigateur est indisponible. */ }
  return { donnees: schemaBrouillonInscription.parse({}), etape: 0 }
}

function Champ({ nom, titre, erreur, aide, ...props }: ComponentProps<typeof Input> & { nom: string; titre: string; erreur?: string; aide?: string }) {
  return <div className="min-w-0 space-y-2">
    <Label htmlFor={`inscription-${nom}`}>{titre}</Label>
    <Input {...props} id={`inscription-${nom}`} className="h-12" aria-required={titre.endsWith('*')} aria-invalid={Boolean(erreur)} aria-describedby={erreur ? `${nom}-erreur` : aide ? `${nom}-aide` : undefined} />
    {erreur ? <p id={`${nom}-erreur`} className="text-sm text-destructive">{erreur}</p> : aide && <p id={`${nom}-aide`} className="text-xs leading-relaxed text-muted-foreground">{aide}</p>}
  </div>
}

function Resume({ titre, modifier, children }: { titre: string; modifier: () => void; children: ReactNode }) {
  return <section className="rounded-xl border border-border p-4 sm:p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{titre}</h3><Button type="button" variant="ghost" className="min-h-11" onClick={modifier} aria-label={`Modifier : ${titre}`}><Pencil className="size-3.5" aria-hidden />Modifier</Button></div>
    <div className="space-y-1.5 break-words text-sm leading-relaxed text-muted-foreground">{children}</div>
  </section>
}

export function InscriptionForm({ invitationToken, taux, onSubmit, submitting, erreurEnvoi }: {
  invitationToken: string; taux: number; onSubmit: (input: ArtisanInput) => Promise<void>; submitting: boolean; erreurEnvoi: string | null;
}) {
  const cle = `celexia-inscription-brouillon-v1:${invitationToken}`
  const [initial] = useState(() => lireBrouillon(cle))
  const [d, setD] = useState(initial.donnees)
  const [etape, setEtape] = useState(initial.etape)
  const [erreurs, setErreurs] = useState<ErreursInscription>({})
  const [localisation, setLocalisation] = useState(false)
  const verrou = useRef(false)
  const titreRef = useRef<HTMLHeadingElement>(null)
  const zonesVerifiees = useRef(new Map<string, ZoneCouverte>())
  useEffect(() => { try { sessionStorage.setItem(cle, JSON.stringify({ donnees: d, etape })) } catch { /* Saisie en mémoire disponible. */ } }, [cle, d, etape])

  function changer<K extends keyof DonneesInscription>(nom: K, valeur: DonneesInscription[K]) {
    setD((avant) => ({ ...avant, [nom]: valeur }))
    setErreurs((avant) => Object.fromEntries(Object.entries(avant).filter(([k]) => k !== nom && !(nom === 'zones' && k.startsWith('zone-')))))
  }
  function aller(index: number) {
    setErreurs({})
    setEtape(index)
    requestAnimationFrame(() => { titreRef.current?.focus({ preventScroll: true }); titreRef.current?.scrollIntoView({ block: 'start' }) })
  }
  function afficherErreurs(liste: ErreursInscription) {
    setErreurs(liste)
    requestAnimationFrame(() => document.getElementById(`inscription-${Object.keys(liste)[0]}`)?.focus())
  }
  async function verifierZones(): Promise<ZoneCouverte[] | null> {
    if (d.mode !== 'rayon') return []
    setLocalisation(true)
    try {
      const zones: ZoneCouverte[] = []
      for (const [i, z] of d.zones.entries()) {
        const cleZone = `${z.ville.trim().toLowerCase()}|${z.cp}`
        let zone = zonesVerifiees.current.get(cleZone)
        if (!zone) {
          const coord = await geocoder(`${z.cp} ${z.ville.trim()}, France`)
          if (!coord) {
            afficherErreurs({ [`zone-ville-${i}`]: 'Cette ville n’a pas pu être localisée. Vérifiez le nom et le code postal, puis réessayez. Vous pouvez aussi choisir vos départements.' })
            return null
          }
          zone = { ville: z.ville.trim(), lat: coord.lat, lon: coord.lon, rayon_km: z.rayon }
          zonesVerifiees.current.set(cleZone, zone)
        }
        zones.push({ ...zone, rayon_km: z.rayon })
      }
      return zones
    } finally { setLocalisation(false) }
  }
  async function continuer() {
    if (verrou.current || submitting) return
    const champsInvalides = validerInscription(d, etape)
    if (Object.keys(champsInvalides).length) return afficherErreurs(champsInvalides)
    verrou.current = true
    try {
      if (etape === 1 && !d.zones.length) changer('zones', [{ ville: d.ville.trim(), cp: d.code_postal, rayon: 30 }])
      if (etape === 2 && !await verifierZones()) return
      if (etape < 3) { aller(etape + 1); return }
      for (let i = 0; i < 3; i++) {
        const invalides = validerInscription(d, i)
        if (Object.keys(invalides).length) { aller(i); afficherErreurs(invalides); return }
      }
      const zones = await verifierZones()
      if (!zones) { setEtape(2); return }
      await onSubmit(preparerInscription(d, zones))
    } finally { verrou.current = false }
  }
  function champ(nom: keyof DonneesInscription, titre: string, options: ComponentProps<typeof Input> & { aide?: string } = {}) {
    return <Champ nom={nom} titre={titre} erreur={erreurs[nom]} value={String(d[nom])} onChange={(e) => changer(nom, e.target.value)} {...options} />
  }
  const occupe = submitting || localisation
  const metiers = metiersInscription(d)
  const etapesCourtes = ['Contact', 'Entreprise', 'Activité', 'Vérification', 'Contrat']

  return <form noValidate onSubmit={(e) => { e.preventDefault(); void continuer() }} className="space-y-6">
    <div>
      <p className="text-xs font-medium text-primary">Étape {etape + 1} sur 5 · {etapesCourtes[etape]}</p>
      <ol aria-label="Étapes de l’inscription" className="mt-3 flex gap-1.5">{etapesCourtes.map((nom, i) => <li key={nom} aria-current={i === etape ? 'step' : undefined} aria-label={`${i + 1}. ${nom}${i < etape ? ', terminé' : ''}`} className={cn('h-1.5 flex-1 rounded-full', i <= etape ? 'bg-primary' : 'bg-muted')} />)}</ol>
      <h2 ref={titreRef} tabIndex={-1} className="mt-6 scroll-mt-6 text-xl font-semibold outline-none sm:text-2xl">{ETAPES[etape]}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{AIDES[etape]}</p>
      {etape < 3 && <p className="mt-3 text-xs text-muted-foreground">Les champs marqués * sont obligatoires.</p>}
    </div>
    {(Object.keys(erreurs).length > 0 || erreurEnvoi) && <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{erreurEnvoi || 'Vérifiez les champs indiqués ci-dessous. Votre saisie est conservée.'}</div>}
    <fieldset disabled={occupe} className="min-w-0 space-y-6 disabled:opacity-70">
      <legend className="sr-only">{ETAPES[etape]}</legend>
      {etape === 0 && <>
        <div className="grid gap-5 sm:grid-cols-2">{champ('prenom', 'Prénom (facultatif)', { autoComplete: 'given-name' })}{champ('nom', 'Nom *', { autoComplete: 'family-name' })}</div>
        {champ('telephone', 'Téléphone *', { type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: '06 12 34 56 78' })}
        {champ('email', 'Email *', { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'none', spellCheck: false, placeholder: 'vous@entreprise.fr', aide: 'Utilisez l’adresse à laquelle vous souhaitez recevoir les informations de Celexia.' })}
      </>}
      {etape === 1 && <>
        <SocieteSearch onSelect={(r) => {
          setD((avant) => ({ ...avant, societe: r.raison_sociale || avant.societe, siren: r.siren || avant.siren, forme_juridique: r.forme_juridique || avant.forme_juridique, adresse: r.adresse || avant.adresse, code_postal: r.code_postal || avant.code_postal, ville: r.ville || avant.ville, representant: r.representant || avant.representant, qualite_representant: r.qualite_representant || avant.qualite_representant }))
          setErreurs({})
        }} />
        {champ('societe', 'Nom de l’entreprise *', { autoComplete: 'organization', aide: 'Pour une entreprise individuelle, indiquez le nom sous lequel vous exercez.' })}
        {champ('siren', 'SIREN ou SIRET *', { inputMode: 'numeric', maxLength: 20, aide: '9 chiffres pour un SIREN, 14 pour un SIRET. Si vous indiquez un SIRET, ses 9 premiers chiffres serviront de SIREN au contrat.' })}
        {champ('adresse', 'Adresse de l’entreprise *', { autoComplete: 'street-address', placeholder: '12 rue des Lilas' })}
        <div className="grid gap-5 sm:grid-cols-[140px_1fr]">{champ('code_postal', 'Code postal *', { autoComplete: 'postal-code', inputMode: 'numeric', maxLength: 5 })}{champ('ville', 'Ville *', { autoComplete: 'address-level2' })}</div>
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">Informations complémentaires pour le contrat</summary>
          <div className="mt-5 space-y-5"><p className="text-xs leading-relaxed text-muted-foreground">Complétez les informations qui s’appliquent à votre entreprise. Elles restent modifiables avant la création du contrat.</p>
            <div className="grid gap-5 sm:grid-cols-2">{champ('forme_juridique', 'Forme juridique (facultatif)', { placeholder: 'EI, SARL, SASU…' })}{champ('capital_social', 'Capital social en € (si applicable)', { inputMode: 'decimal' })}</div>
            {champ('ville_immatriculation', 'Ville d’immatriculation (si applicable)')}
            {champ('representant', 'Représentant de l’entreprise (facultatif)', { placeholder: [d.prenom, d.nom].filter(Boolean).join(' '), aide: 'Sans précision, nous reprenons le prénom et le nom indiqués à la première étape.' })}
            {champ('qualite_representant', 'Fonction du représentant (facultatif)', { placeholder: 'Gérant, présidente, entrepreneur individuel…' })}
          </div>
        </details>
      </>}
      {etape === 2 && <>
        <fieldset id="inscription-metiers" tabIndex={-1} className="space-y-3 outline-none" aria-describedby={erreurs.metiers ? 'metiers-erreur' : undefined}>
          <legend className="mb-3 text-sm font-semibold">Quels travaux réalisez-vous ? *</legend>
          <p className="text-xs text-muted-foreground">Vous pouvez sélectionner plusieurs métiers.</p>
          <div className="flex flex-wrap gap-2">{METIERS.map((m) => <button type="button" key={m} aria-pressed={d.metiers.includes(m)} onClick={() => changer('metiers', d.metiers.includes(m) ? d.metiers.filter((n) => n !== m) : [...d.metiers, m])} className={cn(CHOIX, d.metiers.includes(m) ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border hover:bg-muted')}>{d.metiers.includes(m) && <Check className="mr-1.5 inline size-3.5" aria-hidden />}{m}</button>)}</div>
          {champ('autre_metier', 'Autre métier (facultatif)', { placeholder: 'Ex. Ferronnerie', aide: 'Votre saisie sera retenue en continuant. Séparez plusieurs métiers par une virgule.' })}
          {erreurs.metiers && <p id="metiers-erreur" className="text-sm text-destructive">{erreurs.metiers}</p>}
        </fieldset>
        {d.metiers.some((m) => SOUS_METIERS[m]?.length) && <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Préciser vos spécialités (facultatif)</summary><div className="mt-4 space-y-4">{d.metiers.filter((m) => SOUS_METIERS[m]?.length).map((m) => <fieldset key={m}><legend className="mb-2 text-sm font-medium">{m}</legend><div className="flex flex-wrap gap-2">{SOUS_METIERS[m].map((s) => <button type="button" key={s} aria-pressed={d.sous_metiers.includes(s)} onClick={() => changer('sous_metiers', d.sous_metiers.includes(s) ? d.sous_metiers.filter((n) => n !== s) : [...d.sous_metiers, s])} className={cn(CHOIX, d.sous_metiers.includes(s) ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>{s}</button>)}</div></fieldset>)}</div></details>}
        <section aria-labelledby="titre-secteur" className="space-y-4 border-t border-border pt-6">
          <div><h3 id="titre-secteur" className="font-semibold">Où intervenez-vous ? *</h3><p className="mt-1 text-sm text-muted-foreground">Choisissez votre mode de déplacement.</p></div>
          <div className="grid gap-2 sm:grid-cols-2">{(['rayon', 'departements'] as const).map((mode) => <button type="button" key={mode} aria-pressed={d.mode === mode} onClick={() => { changer('mode', mode); setErreurs({}) }} className={cn('min-h-16 rounded-xl border p-3 text-left', d.mode === mode ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted')}><span className="block text-sm font-medium">{mode === 'rayon' ? 'Autour d’une ville' : 'Par départements'}</span><span className="mt-1 block text-xs text-muted-foreground">{mode === 'rayon' ? 'Une ville et une distance maximale' : 'Un ou plusieurs départements entiers'}</span></button>)}</div>
          {d.mode === 'rayon' ? <>
            <p className="text-xs leading-relaxed text-muted-foreground">Votre ville d’entreprise est proposée au départ. Modifiez-la si besoin : les villes et les distances affichées seront retenues en continuant.</p>
            {d.zones.map((zone, i) => <fieldset key={i} className="space-y-4 rounded-xl border border-border bg-muted/20 p-4"><legend className="px-1 text-sm font-medium">{d.zones.length > 1 ? `Secteur ${i + 1}` : 'Votre secteur'}</legend>
              <div className="grid gap-4 sm:grid-cols-[1fr_120px]"><Champ nom={`zone-ville-${i}`} titre="Ville d’intervention *" value={zone.ville} erreur={erreurs[`zone-ville-${i}`]} onChange={(e) => changer('zones', d.zones.map((z, j) => i === j ? { ...z, ville: e.target.value } : z))} /><Champ nom={`zone-cp-${i}`} titre="Code postal *" inputMode="numeric" maxLength={5} value={zone.cp} erreur={erreurs[`zone-cp-${i}`]} onChange={(e) => changer('zones', d.zones.map((z, j) => i === j ? { ...z, cp: e.target.value } : z))} /></div>
              <div className="space-y-2"><Label htmlFor={`distance-${i}`}>Distance autour de cette ville</Label><select id={`distance-${i}`} className={SELECT} value={zone.rayon} onChange={(e) => changer('zones', d.zones.map((z, j) => i === j ? { ...z, rayon: Number(e.target.value) } : z))}>{[15, 30, 50, 80, 120, 200, 300].map((r) => <option key={r} value={r}>Jusqu’à {r} km</option>)}</select></div>
              {zone.ville && <p className="flex items-start gap-2 text-sm text-primary"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{zone.ville} et les environs, dans un rayon de {zone.rayon} km.</span></p>}
              {d.zones.length > 1 && <Button type="button" variant="ghost" className="min-h-11 text-muted-foreground" onClick={() => changer('zones', d.zones.filter((_, j) => i !== j))} aria-label={`Retirer le secteur ${i + 1}`}><X className="size-4" aria-hidden />Retirer ce secteur</Button>}
            </fieldset>)}
            {erreurs.zones && <p role="alert" className="text-sm text-destructive">{erreurs.zones}</p>}
            {d.zones.length < 5 && <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => changer('zones', [...d.zones, { ville: '', cp: '', rayon: 30 }])}><Plus className="size-4" aria-hidden />Couvrir une autre ville</Button>}
          </> : <div id="inscription-departements" tabIndex={-1} className="space-y-3 outline-none">
            <Label htmlFor="choix-departement">Sélectionnez vos départements *</Label>
            <select id="choix-departement" className={SELECT} value="" aria-invalid={Boolean(erreurs.departements)} aria-describedby="aide-departements" onChange={(e) => { if (e.target.value) changer('departements', [...d.departements, e.target.value]) }}><option value="">Choisir un département…</option>{DEPARTEMENTS.filter((dept) => !d.departements.includes(dept.code)).map((dept) => <option key={dept.code} value={dept.code}>{dept.code} — {dept.nom}</option>)}</select>
            <p id="aide-departements" className="text-xs text-muted-foreground">Chaque département sélectionné est retenu immédiatement. Vous pouvez en choisir plusieurs.</p>
            {!!d.departements.length && <ul aria-label="Départements sélectionnés" className="space-y-2">{d.departements.map((code) => <li key={code} className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 pl-3 text-sm"><Check className="size-4 shrink-0 text-primary" aria-hidden /><span className="min-w-0 flex-1">{code} — {DEPARTEMENT_NOM(code)}</span><Button type="button" variant="ghost" className="size-11 shrink-0" aria-label={`Retirer ${DEPARTEMENT_NOM(code)}`} onClick={() => changer('departements', d.departements.filter((c) => c !== code))}><X className="size-4" aria-hidden /></Button></li>)}</ul>}
            {erreurs.departements && <p className="text-sm text-destructive">{erreurs.departements}</p>}
          </div>}
        </section>
        <details className="rounded-xl border border-border p-4" open={Boolean(erreurs.nb_salaries || erreurs.annees_experience) || undefined}><summary className="cursor-pointer text-sm font-medium">Votre expérience et vos assurances (facultatif)</summary><div className="mt-5 space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">{champ('nb_salaries', 'Nombre de salariés', { inputMode: 'numeric', aide: 'Indiquez 0 si vous travaillez sans salarié.' })}{champ('annees_experience', 'Années d’expérience', { inputMode: 'numeric' })}</div>
          <div className="grid gap-5 sm:grid-cols-2">{(['assurance_rc_pro', 'assurance_decennale'] as const).map((nom) => <div key={nom} className="space-y-2"><Label htmlFor={nom}>{nom === 'assurance_rc_pro' ? 'Assurance responsabilité civile professionnelle' : 'Assurance décennale'}</Label><select id={nom} className={SELECT} value={d[nom]} onChange={(e) => changer(nom, e.target.value)}><option value="">Non renseigné</option><option value="oui">Oui</option><option value="non">Non</option></select></div>)}</div>
          <div className="space-y-2"><Label htmlFor="specificites">Un complément sur votre activité ?</Label><Textarea id="specificites" rows={3} value={d.specificites} onChange={(e) => changer('specificites', e.target.value)} placeholder="Types de travaux, disponibilités, particularités…" /></div>
        </div></details>
      </>}
      {etape === 3 && <>
        <Resume titre="Vos coordonnées" modifier={() => aller(0)}><p className="font-medium text-foreground">{[d.prenom, d.nom].filter(Boolean).join(' ')}</p><p>{d.telephone}</p><p className="break-all">{d.email}</p></Resume>
        <Resume titre="Votre entreprise" modifier={() => aller(1)}><p className="font-medium text-foreground">{d.societe}</p><p>SIREN : {d.siren.replace(/\s/g, '').slice(0, 9)}</p><p>{d.adresse}<br />{d.code_postal} {d.ville}</p>{d.forme_juridique && <p>{d.forme_juridique}{d.capital_social && ` · Capital : ${d.capital_social} €`}</p>}{d.ville_immatriculation && <p>Immatriculation : {d.ville_immatriculation}</p>}<p>Représentant : {d.representant || [d.prenom, d.nom].filter(Boolean).join(' ')}{d.qualite_representant && ` · ${d.qualite_representant}`}</p></Resume>
        <Resume titre="Votre activité et votre secteur" modifier={() => aller(2)}><p className="font-medium text-foreground">{metiers.join(', ')}</p>{!!d.sous_metiers.length && <p>{d.sous_metiers.filter((s) => metiers.some((m) => SOUS_METIERS[m]?.includes(s))).join(', ')}</p>}{d.mode === 'rayon' ? d.zones.map((z, i) => <p key={i}>{z.ville} ({z.cp}) et les environs à {z.rayon} km</p>) : <p>{d.departements.map((c) => `${c} — ${DEPARTEMENT_NOM(c)}`).join(', ')}</p>}{d.nb_salaries && <p>{d.nb_salaries} salarié(s)</p>}{d.annees_experience && <p>{d.annees_experience} année(s) d’expérience</p>}{d.assurance_rc_pro && <p>RC professionnelle : {d.assurance_rc_pro === 'oui' ? 'oui' : 'non'}</p>}{d.assurance_decennale && <p>Décennale : {d.assurance_decennale === 'oui' ? 'oui' : 'non'}</p>}{d.specificites && <p>{d.specificites}</p>}</Resume>
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5"><p className="text-xs font-semibold uppercase tracking-wide text-primary">Taux de commission</p><p className="mt-2 text-lg font-semibold">{taux} % du montant TTC des devis signés</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Ce taux est repris dans le contrat présenté à l’étape suivante. Prenez le temps de le lire avant de signer.</p></div>
      </>}
    </fieldset>
    <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-between">
      {etape > 0 && <Button type="button" variant="outline" onClick={() => aller(etape - 1)} disabled={occupe} className="min-h-12"><ArrowLeft className="size-4" aria-hidden />Retour</Button>}
      <Button type="submit" disabled={occupe} className="min-h-12 whitespace-normal px-5 sm:ml-auto">{occupe ? <><Loader2 className="size-4 animate-spin" aria-hidden />{localisation ? 'Vérification du secteur…' : 'Préparation du contrat…'}</> : <>{etape === 3 ? 'Lire mon contrat' : 'Continuer'}<ArrowRight className="size-4" aria-hidden /></>}</Button>
    </div>
    <p className="text-center text-xs leading-relaxed text-muted-foreground">Vous pouvez revenir aux étapes précédentes. Votre saisie est conservée dans cet onglet.</p>
  </form>
}
