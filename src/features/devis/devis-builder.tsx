import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Plus, Trash2, Loader2, Eye, Send, Save, ChevronDown, ListPlus, X, Calculator,
  MessageSquareText,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { uploaderDevisGenere } from '@/lib/storage'
import type { ArtisanEspace } from '@/types/database'
import { useEtatChiffrage } from '@/features/assurances/use-assurances'
import { calculerTotaux, estQuantiteParDefaut, uniteCommune } from './calculs'
import { devisEnBlob, type DevisData } from './devis-pdf'
import { ApercuDevis } from './apercu-devis'
import { devisEnHtml, objetCourriel } from './devis-html'
import {
  useCreerDevis,
  useSetDevisPdf,
  useEnvoyerDevis,
  type DevisPayload,
  type BrouillonDevis,
  useEnregistrerPrix,
  useSuggestionsDevis,
  type LigneSuggeree,
  type Suggestions,
  type LigneModele,
} from './use-devis'
import { BibliothequePrix, DemarrageDevis, EnregistrerModele } from './devis-demarrage'
import { useIdentite } from './use-identite'
import { EntretienDevis } from './entretien-devis'

const UNITES = ['u', 'm²', 'ml', 'm³', 'forfait', 'h', 'j', 'ens.']

// Montant avec centimes (les devis ont besoin du détail à 2 décimales).
const euro2 = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n || 0)
    .replace(/[\u202f\u00a0]/g, ' ') + ' €'

const nombre = (s: string) => {
    const normalise = s.trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
    return normalise === '' ? 0 : /^-?\d+(?:\.\d*)?$/.test(normalise) ? Number(normalise) : NaN
  }
const num = (s: string) => Number.isFinite(nombre(s)) ? nombre(s) : 0

interface LigneState {
  /** Déboursé sec : ce que la ligne lui coûte. Jamais imprimé sur le devis. */
  cout_unitaire: string
  /** Taux de TVA de la ligne — un chantier mêle souvent 10 % et 20 %. */
  tva_taux: string
  designation: string
  quantite: string
  unite: string
  prix_unitaire: string
}

export interface DevisInitial {
  brouillon?: BrouillonDevis
  affectation_token?: string
  client_nom?: string | null
  client_adresse?: string | null
  client_cp?: string | null
  client_ville?: string | null
  client_email?: string | null
  client_tel?: string | null
  objet?: string | null
  /** Métier du chantier : sert à proposer le devis type correspondant. */
  metier?: string | null
  /** Demande du client : point de départ de l'entretien. */
  description?: string | null
}

export function DevisBuilder({
  token,
  vendeur,
  initial,
  onClose,
  onDone,
}: {
  token: string
  vendeur: ArtisanEspace
  initial?: DevisInitial
  onClose: () => void
  onDone?: () => void
}) {
  const brouillon = initial?.brouillon
  const documentInitial = brouillon?.document_data
  const sauvegarde = useRef<{ id: string; numero: string; revision: number } | null>(brouillon ? { id: brouillon.id, numero: brouillon.numero, revision: brouillon.revision ?? 0 } : null)
  const [idempotence] = useState(() => brouillon?.idempotency_key ?? crypto.randomUUID())
  const entrepriseBlocId = useId()
  const clientBlocId = useId()
  const conditionsId = useId()
  const identiteQuery = useIdentite(token)
  const identite = identiteQuery.data
  const creer = useCreerDevis(token)
  const setPdf = useSetDevisPdf(token)
  const envoyer = useEnvoyerDevis(token)
  const [busy, setBusy] = useState(false)
  const [apercuData, setApercuData] = useState<DevisData | null>(null)
  const boutonApercu = useRef<HTMLButtonElement>(null)
  // `busy` ne protège que l'affichage : entre deux appuis rapprochés, l'état
  // React n'a pas eu le temps de se propager et l'enregistrement partait deux
  // fois — deux devis, deux numéros. Le verrou doit être synchrone.
  const enCours = useRef(false)
  const [enTeteOuvert, setEnTeteOuvert] = useState(false)
  // Quand le devis part d'un chantier, le client est déjà rempli : ces six
  // champs sont à vérifier, pas à saisir. Les déplier d'office reviendrait à
  // faire défiler deux écrans avant d'atteindre le travail.
  const [clientOuvert, setClientOuvert] = useState(!initial?.client_nom)
  // Le déboursé n'intéresse que ceux qui suivent leur marge. Tant qu'aucune
  // ligne n'en porte, il reste une rangée de moins sur chaque ligne.
  const [deboursesOuverts, setDeboursesOuverts] = useState(false)
  const [entretienOuvert, setEntretienOuvert] = useState(false)

  // En-tête entreprise (éditable, pré-rempli depuis « Mon entreprise »)
  const entBase = {
    nom: identite?.societe || vendeur.societe || '',
    adresse: identite?.adresse ?? vendeur.adresse ?? '',
    cp: identite?.code_postal ?? vendeur.code_postal ?? '',
    ville: identite?.ville ?? vendeur.ville ?? '',
    siren: identite?.siren ?? vendeur.siren ?? '',
    forme: identite?.forme_juridique ?? vendeur.forme_juridique ?? '',
    tel: identite?.telephone ?? vendeur.telephone ?? '',
    email: identite?.email ?? vendeur.email ?? '',
  }
  const [entModifs, setEntModifs] = useState<Partial<typeof entBase>>(documentInitial ? Object.fromEntries(Object.entries(documentInitial.vendeur).map(([k, v]) => [k, v ?? ''])) : {})
  const ent = { ...entBase, ...entModifs }
  const majEnt = (k: keyof typeof ent, v: string) => setEntModifs((p) => ({ ...p, [k]: v }))

  // Client
  const [cli, setCli] = useState({
    nom: brouillon?.client_nom ?? initial?.client_nom ?? '',
    adresse: brouillon?.client_adresse ?? initial?.client_adresse ?? '',
    cp: brouillon?.client_cp ?? initial?.client_cp ?? '',
    ville: brouillon?.client_ville ?? initial?.client_ville ?? '',
    email: brouillon?.client_email ?? initial?.client_email ?? '',
    tel: brouillon?.client_tel ?? initial?.client_tel ?? '',
  })
  const majCli = (k: keyof typeof cli, v: string) => setCli((p) => ({ ...p, [k]: v }))

  // Taux de commission et assurance : servent l'un à montrer ce qui restera à
  // l'artisan, l'autre à la mention obligatoire en pied de devis.
  const { data: etat } = useEtatChiffrage(token)
  const enregistrerPrix = useEnregistrerPrix(token)
  const suggerer = useSuggestionsDevis(token)
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null)
  // L'objet est ce que le client lit en tête de son devis. Y déverser la liste
  // des métiers du chantier — « Toiture, Petits travaux / Multiservices » — ne
  // lui apprend rien et se retrouve tel quel sur le PDF.
  const [objet, setObjet] = useState(brouillon?.objet ?? initial?.objet ?? '')
  const [lignes, setLignes] = useState<LigneState[]>(brouillon?.lignes?.length ? brouillon.lignes.map((l) => ({ designation: l.designation, quantite: String(l.quantite), unite: l.unite, prix_unitaire: String(l.prix_unitaire), cout_unitaire: l.cout_unitaire == null ? '' : String(l.cout_unitaire), tva_taux: String(l.tva_taux ?? 0) })) : [
    { designation: '', quantite: '1', unite: 'u', prix_unitaire: '', cout_unitaire: '', tva_taux: '10' },
  ])
  // Par défaut la franchise : c'est le régime en place jusqu'ici, et basculer
  // tout le monde en TVA ajouterait 10 % aux devis du jour au lendemain.
  // LE RÉGIME DE TVA ET L'ACOMPTE SUIVENT LA FICHE DE L'ARTISAN tant qu'il
  // n'y a pas touché. Ils étaient lus UNE fois, à l'ouverture — avant que la
  // fiche n'ait fini de charger : un artisan à la TVA qui ouvrait directement
  // le générateur voyait son devis partir en « TVA non applicable, art. 293 B »
  // avec 30 % d'acompte. La valeur affichée est donc DÉRIVÉE : son choix s'il
  // en a fait un, sinon celle de sa fiche dès qu'elle arrive.
  const [tvaChoisi, setTvaMode] = useState<'franchise' | 'normal' | null>(brouillon?.tva_mode === 'normal' ? 'normal' : brouillon?.tva_mode === 'franchise' ? 'franchise' : null)
  const tvaMode = tvaChoisi ?? identite?.tva_mode_defaut ?? 'franchise'
  const [acompteSaisi, setAcompte] = useState<string | null>(brouillon?.acompte_pct != null ? String(brouillon.acompte_pct) : null)
  const acompte = acompteSaisi ?? String(identite?.acompte_defaut ?? 30)
  const [conditionsSaisies, setConditions] = useState<string | null>(brouillon?.conditions ?? null)
  const conditions = conditionsSaisies ?? identite?.conditions_paiement ?? 'Devis gratuit, valable 1 mois. Acompte à la commande, solde à la fin des travaux.'
  const [validite] = useState(() => {
    if (brouillon?.date_validite) return brouillon.date_validite
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [today] = useState(() => new Date().toISOString())

  const version = JSON.stringify({ cli, objet, lignes, tvaChoisi, acompteSaisi, conditionsSaisies, entModifs })
  const [versionInitiale, setVersionInitiale] = useState(version)
  const modifie = version !== versionInitiale
  useEffect(() => {
    if (!modifie && !busy && !entretienOuvert) return
    const proteger = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', proteger)
    return () => window.removeEventListener('beforeunload', proteger)
  }, [modifie, busy, entretienOuvert])

  // HT, TVA, TTC, déboursé, marge et commission — voir `calculs.ts`.
  const chiffres = useMemo(
    () =>
      calculerTotaux(
        lignes.filter((l) => l.designation.trim()).map((l) => ({
          quantite: num(l.quantite),
          prix_unitaire: num(l.prix_unitaire),
          cout_unitaire: num(l.cout_unitaire),
          tva_taux: num(l.tva_taux),
        })),
        tvaMode === 'normal',
        etat?.taux_commission ?? 0,
      ),
    [lignes, tvaMode, etat?.taux_commission],
  )

  /** Verse une ligne proposée dans le devis, en remplaçant la ligne vide initiale. */
  function ajouterSuggestion(x: LigneSuggeree) {
    setLignes((arr) => [
      ...arr.filter((l) => l.designation.trim() || l.prix_unitaire.trim()),
      {
        designation: x.designation,
        quantite: String(x.quantite ?? 1),
        unite: x.unite || 'u',
        prix_unitaire: x.prix_unitaire != null ? String(x.prix_unitaire) : '',
        cout_unitaire: '',
        tva_taux: '10',
      },
    ])
  }

  /**
   * Verse un jeu de lignes — modèle, devis type, devis repris — à la suite de
   * ce qui est déjà saisi. La ligne vide initiale disparaît au passage.
   */
  function verserLignes(
    src: LigneModele[],
    nouvelObjet?: string | null,
    modeTva?: string | null,
  ) {
    if (!src?.length) return
    setLignes((arr) => [
      ...arr.filter((l) => l.designation.trim() || l.prix_unitaire.trim()),
      ...src.map((x) => ({
        designation: x.designation ?? '',
        quantite: String(x.quantite ?? 1),
        unite: x.unite || 'u',
        prix_unitaire: x.prix_unitaire != null ? String(x.prix_unitaire) : '',
        cout_unitaire: x.cout_unitaire != null ? String(x.cout_unitaire) : '',
        // Le taux de la ligne d'origine, sans quoi reprendre un devis à 10 %
        // et 20 % le ramenait tout entier à 10 %.
        tva_taux: x.tva_taux != null ? String(x.tva_taux) : '10',
      })),
    ])
    if (nouvelObjet && !objet.trim()) setObjet(nouvelObjet)
    if (modeTva === 'franchise' || modeTva === 'normal') setTvaMode(modeTva)
  }

  // Une ligne venue d'un modèle ou de la bibliothèque peut déjà porter son
  // déboursé : dans ce cas, le cacher serait perdre une information.
  const afficheDebourses = deboursesOuverts || lignes.some((l) => l.cout_unitaire.trim())

  /** Les lignes réellement remplies — ce qu'on enregistre comme modèle. */
  const lignesRemplies = useMemo(
    () =>
      lignes
        .filter((l) => l.designation.trim())
        .map((l) => ({
          designation: l.designation.trim(),
          unite: l.unite,
          quantite: num(l.quantite),
          prix_unitaire: num(l.prix_unitaire),
          cout_unitaire: l.cout_unitaire.trim() ? num(l.cout_unitaire) : null,
          // Sans lui, un modèle enregistré depuis un devis à 10 % et 20 %
          // revenait tout entier à 10 %.
          tva_taux: num(l.tva_taux),
        })),
    [lignes],
  )

  // L'unité métrique la plus représentée, dès lors qu'elle porte au moins
  // deux lignes : au-dessous, saisir la cote à la main va plus vite.
  const [cote, setCote] = useState('')
  const uniteCote = useMemo(() => uniteCommune(lignes), [lignes])

  function appliquerCote() {
    if (!uniteCote || !cote.trim()) return
    const [u, n] = uniteCote
    setLignes((arr) =>
      arr.map((l) =>
        l.unite === u && l.designation.trim() && estQuantiteParDefaut(l.quantite)
          ? { ...l, quantite: cote.trim() }
          : l,
      ),
    )
    toast.success(`${n} lignes mises à ${cote.trim()} ${u}`)
  }

  function majLigne(i: number, k: keyof LigneState, v: string) {
    setLignes((arr) => arr.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)))
  }
  const ajouterLigne = () =>
    setLignes((arr) => [...arr, { designation: '', quantite: '1', unite: 'u', prix_unitaire: '', cout_unitaire: '', tva_taux: '10' }])
  const retirerLigne = (i: number) => setLignes((arr) => arr.filter((_, idx) => idx !== i))

  function construireData(numero: string): DevisData {
    return {
      numero,
      date: today,
      dateValidite: validite,
      vendeur: {
        nom: ent.nom,
        adresse: ent.adresse,
        cp: ent.cp,
        ville: ent.ville,
        siren: ent.siren,
        forme: ent.forme,
        tel: ent.tel,
        email: ent.email,
        // Mentions d'immatriculation et coordonnées bancaires : elles ne sont
        // pas éditables ici, c'est « Mon entreprise » qui en est la source.
        logoUrl: identite?.logo_url,
        capital: identite?.capital_social,
        villeImmat: identite?.ville_immatriculation,
        tvaIntracom: identite?.tva_intracom,
        ape: identite?.code_ape,
        iban: identite?.iban,
        bic: identite?.bic,
      },
      client: { nom: cli.nom, adresse: cli.adresse, cp: cli.cp, ville: cli.ville, tel: cli.tel, email: cli.email },
      objet,
      lignes: lignes
        .filter((l) => l.designation.trim())
        .map((l) => ({
          designation: l.designation.trim(),
          quantite: num(l.quantite),
          unite: l.unite,
          prix_unitaire: num(l.prix_unitaire),
          // Sans le taux de la ligne, le PDF ne peut pas ventiler la TVA.
          tva_taux: tvaMode === 'normal' ? num(l.tva_taux) : 0,
        })),
      total: chiffres.ttc,
      totalHt: chiffres.ht,
      totalTva: chiffres.tva,
      tvaMode,
      acomptePct: acompte.trim() ? num(acompte) : null,
      conditions,
      assurance: etat?.decennale
        ? {
            assureur: etat.decennale.assureur,
            police: etat.decennale.police,
            zone: identite?.garantie_zone,
            rcProAssureur: identite?.assurance?.rc_pro_assureur,
            rcProPolice: identite?.assurance?.rc_pro_police,
          }
        : null,
      mediateur: identite?.mediateur_nom
        ? { nom: identite.mediateur_nom, url: identite.mediateur_url }
        : null,
      cgv: identite?.cgv,
      conditionsPaiement: null,
    }
  }

  // Fermer efface tout : un devis en cours ne se referme pas par accident.
  function demanderFermeture() {
    if (enCours.current || busy) {
      toast.info('Une opération est en cours. Attendez son résultat avant de fermer.')
      return
    }
    if ((!modifie && !entretienOuvert) || window.confirm('Abandonner ce devis ? Vos modifications non enregistrées seront perdues.')) onClose()
  }

  function valider(): boolean {
    if (identiteQuery.isLoading || identiteQuery.isError || !identite) {
      toast.error('Votre fiche entreprise doit être chargée avant de générer le devis')
      return false
    }
    if (!cli.nom.trim()) {
      toast.error('Indiquez le nom du client')
      return false
    }
    if (!lignes.some((l) => l.designation.trim())) {
      toast.error('Ajoutez au moins une ligne')
      return false
    }
    if (lignes.some((l) => !l.designation.trim() && (l.prix_unitaire.trim() || l.cout_unitaire.trim()))) {
      toast.error('Complétez la désignation de chaque ligne chiffrée')
      return false
    }
    if (lignes.some((l) => [l.quantite, l.prix_unitaire, l.cout_unitaire, l.tva_taux].some((v) => !Number.isFinite(nombre(v))))) {
      toast.error('Valeur numérique invalide', { description: 'Vérifiez les quantités et les prix.' })
      return false
    }
    if (lignesRemplies.some((l) => l.prix_unitaire < 0 || (l.cout_unitaire ?? 0) < 0)) {
      toast.error('Prix ou déboursé négatif', { description: 'Corrigez la ligne avant d’enregistrer.' })
      return false
    }
    if (!Number.isFinite(nombre(acompte)) || nombre(acompte) < 0 || nombre(acompte) > 100) {
      toast.error('L’acompte doit être compris entre 0 et 100 %')
      return false
    }
    if (lignesRemplies.some((l) => (l.quantite ?? 0) < 0)) {
      toast.error('Quantité négative', { description: 'Corrigez la ligne avant d’enregistrer.' })
      return false
    }
    // Un devis sans montant part au client comme les autres. Mieux vaut le
    // demander que de le découvrir dans sa boîte mail.
    const sansPrix = lignesRemplies.filter((l) => !l.prix_unitaire).length
    if (chiffres.ttc === 0 || sansPrix > 0) {
      const quoi = chiffres.ttc === 0
        ? 'Ce devis est à 0 €.'
        : `${sansPrix} ligne${sansPrix > 1 ? 's' : ''} sans prix.`
      if (!window.confirm(`${quoi} Continuer quand même ?`)) return false
    }
    return true
  }

  function apercu() {
    if (enCours.current || !valider()) return
    setApercuData(construireData(sauvegarde.current?.numero ?? 'APERÇU'))
  }

  /**
   * Enregistre le devis, puis selon le mode :
   *   'garder'  — le télécharge, pour que l'artisan en ait un exemplaire ;
   *   'client'  — l'envoie au client et fait passer le chantier en « devis
   *               envoyé », avec son montant.
   */
  async function enregistrer(mode: 'garder' | 'client') {
    const avecEnvoi = mode === 'client'
    if (avecEnvoi && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cli.email.trim())) {
      toast.error('Adresse email du client invalide', {
        description: 'Ouvrez le bloc Client pour la renseigner.',
      })
      setClientOuvert(true)
      return
    }
    if (enCours.current) return
    if (!valider()) return
    enCours.current = true
    setBusy(true)
    try {
      const payload: DevisPayload = {
        devis_id: sauvegarde.current?.id,
        expected_revision: sauvegarde.current?.revision,
        idempotency_key: idempotence,
        document_data: construireData('__NUMERO_DEVIS__'),
        email_html: devisEnHtml(construireData('__NUMERO_DEVIS__')),
        email_subject: objetCourriel(construireData('__NUMERO_DEVIS__')),
        affectation_token: brouillon?.affectation_token ?? initial?.affectation_token,
        client_nom: cli.nom,
        client_adresse: cli.adresse,
        client_cp: cli.cp,
        client_ville: cli.ville,
        client_email: cli.email,
        client_tel: cli.tel,
        objet,
        // Le serveur recalcule les totaux : il ne croit pas le client sur
        // parole, c'est ce chiffre qui porte la commission.
        lignes: lignes
          .filter((l) => l.designation.trim())
          .map((l) => ({
            designation: l.designation.trim(),
            quantite: num(l.quantite),
            unite: l.unite,
            prix_unitaire: num(l.prix_unitaire),
            cout_unitaire: l.cout_unitaire.trim() ? num(l.cout_unitaire) : null,
            tva_taux: tvaMode === 'normal' ? num(l.tva_taux) : 0,
          })),
        tva_mode: tvaMode,
        total: chiffres.ttc,
        acompte_pct: acompte.trim() ? num(acompte) : null,
        conditions,
        date_validite: validite,
      }
      const { id, numero, revision } = await creer.mutateAsync(payload)
      sauvegarde.current = { id, numero, revision }

      // Les lignes rejoignent sa bibliothèque : il ne les ressaisira plus.
      // Échec sans conséquence — le devis, lui, est déjà enregistré.
      // Le MÉTIER du chantier, pas l'objet du devis : ce dernier est du texte
      // libre (« Salle d'eau de Mme Durand »), et le ranger comme métier
      // faussait tout regroupement de la bibliothèque.
      void enregistrerPrix.mutateAsync({ lignes: payload.lignes, metier: initial?.metier ?? null })
        .catch(() => undefined)
      const blob = await devisEnBlob(construireData(numero))
      const url = await uploaderDevisGenere(token, numero, blob)
      await setPdf.mutateAsync({ id, url, revision })

      if (avecEnvoi) {
        await envoyer.mutateAsync({ id, revision })
        toast.success(`Devis ${numero} pris en charge pour envoi`, { description: 'La prise en charge est confirmée par le serveur ; la réception dépend de la messagerie du client.' })
      } else {
        telechargerBlob(blob, numero)
        toast.success(`Devis ${numero} enregistré`)
      }
      setVersionInitiale(version)
      onDone?.()
      onClose()
    } catch (e) {
      toast.error(sauvegarde.current ? 'Brouillon conservé, opération incomplète' : 'Sauvegarde impossible', { description: e instanceof Error ? e.message : undefined })
    } finally {
      enCours.current = false
      setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && demanderFermeture()}>
      <SheetContent side="bottom" className="mx-auto flex h-[96dvh] max-h-[96dvh] w-full max-w-[1200px] flex-col gap-0 overflow-hidden rounded-t-2xl border border-border bg-background">
        <SheetHeader className="shrink-0 border-b border-border bg-card px-5 py-4 pr-14 sm:px-6 sm:pr-14">
          <SheetTitle className="font-display text-xl font-medium">{brouillon ? `Modifier le devis ${brouillon.numero}` : 'Créer un devis'}</SheetTitle>
          <SheetDescription className="text-xs">
            {cli.nom ? `Pour ${cli.nom}${cli.ville ? ` · ${cli.ville}` : ''}` : 'Renseignez le client et les prestations'} · aperçu avant enregistrement ou envoi
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {identiteQuery.isError && <div role="alert" className="m-4 rounded-lg border border-border bg-card p-4 text-sm"><p>Votre fiche entreprise n’a pas pu être chargée. Les mentions et le régime de TVA doivent être vérifiés avant de générer le devis.</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void identiteQuery.refetch()}>Réessayer la fiche entreprise</Button></div>}
          <fieldset disabled={busy} className="grid min-w-0 items-start gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
          {/* En-tête entreprise (repliable) */}
          <div className="rounded-xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setEnTeteOuvert((v) => !v)}
              aria-expanded={enTeteOuvert}
              aria-controls={entrepriseBlocId}
              className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium"
            >
              <span className="min-w-0 truncate">Votre entreprise · {ent.nom || 'À renseigner'}</span>
              <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${enTeteOuvert ? 'rotate-180' : ''}`} />
            </button>
            {enTeteOuvert && (
              <div id={entrepriseBlocId} className="grid grid-cols-2 gap-3 border-t border-border p-4">
                <Champ label="Nom / société" value={ent.nom} onChange={(v) => majEnt('nom', v)} className="col-span-2" />
                <Champ label="Adresse" value={ent.adresse} onChange={(v) => majEnt('adresse', v)} className="col-span-2" />
                <Champ label="Code postal" value={ent.cp} onChange={(v) => majEnt('cp', v)} />
                <Champ label="Ville" value={ent.ville} onChange={(v) => majEnt('ville', v)} />
                <Champ label="SIREN" value={ent.siren} onChange={(v) => majEnt('siren', v)} />
                <Champ label="Forme juridique" value={ent.forme} onChange={(v) => majEnt('forme', v)} />
                <Champ label="Téléphone" value={ent.tel} onChange={(v) => majEnt('tel', v)} />
                <Champ label="Email" value={ent.email} onChange={(v) => majEnt('email', v)} />
              </div>
            )}
          </div>

          {/* Client — replié dès lors que le chantier l'a renseigné */}
          <div className="rounded-xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setClientOuvert((v) => !v)}
              aria-expanded={clientOuvert}
              aria-controls={clientBlocId}
              className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium"
            >
              <span className="min-w-0 truncate text-left">
                Client : {cli.nom || <span className="text-muted-foreground">à renseigner</span>}
                {cli.ville && <span className="font-normal text-muted-foreground"> · {cli.ville}</span>}
              </span>
              <ChevronDown
                className={`size-4 shrink-0 transition-transform ${clientOuvert ? 'rotate-180' : ''}`}
              />
            </button>
            {clientOuvert && (
              <div id={clientBlocId} className="grid grid-cols-2 gap-3 border-t border-border p-4">
                <Champ label="Nom" value={cli.nom} onChange={(v) => majCli('nom', v)} className="col-span-2" />
                <Champ label="Adresse" value={cli.adresse} onChange={(v) => majCli('adresse', v)} className="col-span-2" />
                <Champ label="Code postal" value={cli.cp} onChange={(v) => majCli('cp', v)} />
                <Champ label="Ville" value={cli.ville} onChange={(v) => majCli('ville', v)} />
                <Champ label="Email" value={cli.email} onChange={(v) => majCli('email', v)} />
                <Champ label="Téléphone" value={cli.tel} onChange={(v) => majCli('tel', v)} />
              </div>
            )}
          </div>

          {/* Objet */}
          <div className="rounded-xl border border-border bg-card p-4"><Champ label="Objet du devis" value={objet} onChange={setObjet} placeholder="Ex. Fourniture et pose de menuiseries" /></div>

          {/* Lignes */}
          <section aria-labelledby={`${clientBlocId}-prestations`} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
              <h2 id={`${clientBlocId}-prestations`} className="text-base font-medium">Prestations</h2>
              <Select
                value={tvaMode}
                onValueChange={(v) => setTvaMode(v as 'franchise' | 'normal')}
              >
                <SelectTrigger className="h-9 w-44" aria-label="Régime de TVA">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="franchise">Sans TVA (art. 293 B)</SelectItem>
                  <SelectItem value="normal">Avec TVA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Trois façons de remplir d'un geste : un modèle enregistré, le
                devis type du métier, ou un devis déjà fait qu'on reprend. Une
                fois les lignes posées, ce bloc n'a plus rien à proposer. */}
            {/* La seconde porte d'entrée : décrire plutôt que remplir. Celui
                qui sort d'une visite a le chantier en tête, pas ses lignes. */}
            {lignesRemplies.length === 0 && (
              <Button
                variant="outline"
                className="h-auto w-full flex-col items-start gap-1 border-border bg-card px-4 py-3 text-left"
                onClick={() => setEntretienOuvert(true)}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <MessageSquareText className="size-4 text-muted-foreground" aria-hidden />
                  Décrire le chantier
                </span>
                <span className="whitespace-normal text-xs font-normal text-muted-foreground">
                  Vous racontez, on vous pose les questions qui changent le prix, le devis sort
                  chiffré à vos tarifs.
                </span>
              </Button>
            )}

            <DemarrageDevis
              token={token}
              metier={initial?.metier}
              replie={lignesRemplies.length > 0}
              onAppliquer={verserLignes}
            />

            {/* Lignes proposées à partir du dossier et des échanges. Réservé
                aux devis ouverts depuis un chantier : sans dossier, rien à lire. */}
            {initial?.affectation_token && (
              <Button
                variant="outline"
                className="w-full"
                disabled={suggerer.isPending}
                onClick={() =>
                  suggerer.mutate(initial.affectation_token!, {
                    onSuccess: (s) => {
                      if (!s.ok) {
                        toast.error('Proposition indisponible', { description: s.error })
                        return
                      }
                      setSuggestions(s)
                      if (!s.lignes?.length) toast.info('Aucune ligne à proposer sur ce dossier')
                    },
                    onError: (e) =>
                      toast.error('Proposition indisponible', {
                        description: e instanceof Error ? e.message : undefined,
                      }),
                  })
                }
              >
                {suggerer.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ListPlus className="size-4" aria-hidden />
                )}
                Proposer des lignes depuis le dossier
              </Button>
            )}

            {!!suggestions?.lignes?.length && (
              <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">
                    {suggestions.lignes.length} lignes proposées
                  </p>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        suggestions.lignes?.forEach(ajouterSuggestion)
                        setSuggestions(null)
                      }}
                    >
                      Tout ajouter
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label="Fermer"
                      onClick={() => setSuggestions(null)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {suggestions.lignes.map((x, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => ajouterSuggestion(x)}
                        className="w-full rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:bg-accent"
                      >
                        <p className="text-sm font-medium">{x.designation}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {x.quantite} {x.unite}
                          {' · '}
                          {x.prix_unitaire != null
                            ? `${euro2(x.prix_unitaire)} — ${
                                x.source === 'bibliotheque' ? 'votre prix' : 'prix observé'
                              }`
                            : 'prix à saisir'}
                        </p>
                        {x.pourquoi && (
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{x.pourquoi}</p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                {!!suggestions.manques?.length && (
                  <div className="rounded-lg bg-card p-2.5">
                    <p className="text-xs font-medium">À vérifier sur place</p>
                    <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                      {suggestions.manques.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Les prix viennent de vos devis ou de ceux observés sur ce métier — jamais
                  d’une estimation. Vérifiez tout avant d’envoyer.
                </p>
              </div>
            )}

            {/* Bibliothèque de prix, avec recherche : au-delà d'une dizaine
                de lignes, une liste figée n'est plus consultable. */}
            <BibliothequePrix
              token={token}
              onAjouter={(x) =>
                verserLignes([
                  {
                    designation: x.designation,
                    unite: x.unite,
                    quantite: 1,
                    prix_unitaire: x.prix_unitaire,
                    cout_unitaire: x.cout_unitaire,
                  },
                ])
              }
            />

            {/* La cote commune, saisie une fois pour toutes les lignes qui la
                partagent. C'est le geste qui reste le plus répétitif une fois
                les lignes posées par un modèle. */}
            {uniteCote && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
                <div className="relative w-24 shrink-0">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="Cote"
                    value={cote}
                    onChange={(e) => setCote(e.target.value)}
                    className="h-10 w-full pr-9"
                    aria-label={`Quantité commune en ${uniteCote[0]}`}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    {uniteCote[0]}
                  </span>
                </div>
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {uniteCote[1]} lignes en {uniteCote[0]} sans quantité — saisissez la cote une
                  seule fois. Celles que vous avez déjà chiffrées ne bougeront pas.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={appliquerCote}
                  disabled={!cote.trim()}
                >
                  Appliquer
                </Button>
              </div>
            )}

            {lignes.map((l, i) => (
              <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <Textarea
                  placeholder="Désignation (ex. Fenêtre PVC 2 vantaux, pose comprise)"
                  value={l.designation}
                  onChange={(e) => majLigne(i, 'designation', e.target.value)}
                  rows={2}
                  aria-label="Désignation"
                />
                {/* Rangée 1 : quantité + unité + total de ligne + supprimer */}
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="Qté"
                    value={l.quantite}
                    onChange={(e) => majLigne(i, 'quantite', e.target.value)}
                    className="h-11 w-16 shrink-0"
                    aria-label="Quantité"
                  />
                  <Select value={l.unite} onValueChange={(v) => majLigne(i, 'unite', v)}>
                    <SelectTrigger className="h-11 w-24 shrink-0" aria-label="Unité de la ligne">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITES.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="min-w-0 flex-1 truncate text-right text-sm font-medium">
                    {euro2(num(l.quantite) * num(l.prix_unitaire))}
                  </span>
                  {lignes.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0 text-muted-foreground"
                      onClick={() => retirerLigne(i)}
                      aria-label="Retirer la ligne"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                {/* Rangée 2 : prix unitaire en pleine largeur (grande zone tactile mobile) */}
                <div className="relative">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="Prix unitaire — à chiffrer"
                    value={l.prix_unitaire}
                    onChange={(e) => majLigne(i, 'prix_unitaire', e.target.value)}
                    // Une ligne venue de l'entretien sans prix connu reste
                    // signalée ici : sinon elle se fond dans les autres et
                    // part à 0 € chez le client.
                    className={`h-11 w-full pr-8 ${
                      l.designation.trim() && !l.prix_unitaire.trim()
                        ? 'border-[#F59E0B] bg-[#F59E0B]/5'
                        : ''
                    }`}
                    aria-label="Prix unitaire"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
                </div>
                {/* Rangée 3 : déboursé et TVA. Le déboursé ne sort jamais sur
                    le devis du client — il ne sert qu'à voir la marge. */}
                {(afficheDebourses || tvaMode === 'normal') && (
                <div className="flex items-center gap-2">
                  {afficheDebourses && (
                  <div className="relative flex-1">
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="Déboursé (coût)"
                      value={l.cout_unitaire}
                      onChange={(e) => majLigne(i, 'cout_unitaire', e.target.value)}
                      className="h-10 w-full pr-8"
                      aria-label="Déboursé unitaire"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      €
                    </span>
                  </div>
                  )}
                  {tvaMode === 'normal' && (
                    <Select value={l.tva_taux} onValueChange={(v) => majLigne(i, 'tva_taux', v)}>
                      <SelectTrigger className="h-10 w-28 shrink-0" aria-label="Taux de TVA">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5.5">5,5 %</SelectItem>
                        <SelectItem value="10">10 %</SelectItem>
                        <SelectItem value="20">20 %</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                )}
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={ajouterLigne}>
              <Plus className="size-4" />
              Ajouter une ligne
            </Button>

            <EnregistrerModele
              token={token}
              lignes={lignesRemplies}
              metier={initial?.metier ?? (objet || null)}
            />
          </section>
          </div>

          <aside aria-label="Récapitulatif et conditions du devis" className="min-w-0 space-y-4 lg:sticky lg:top-6">
          {/* Totaux */}
          <section className="space-y-3 rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-medium">Récapitulatif</h2>
            {tvaMode === 'normal' && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total HT</span>
                  <span className="montant">{euro2(chiffres.ht)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">TVA</span>
                  <span className="montant">{euro2(chiffres.tva)}</span>
                </div>
              </>
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-medium">
                {tvaMode === 'normal' ? 'Total TTC' : 'Net à payer'}
              </span>
              <span className="montant text-2xl font-medium text-foreground">
                {euro2(chiffres.ttc)}
              </span>
            </div>
            {tvaMode === 'franchise' && <p className="border-t border-border pt-3 text-xs text-muted-foreground">TVA non applicable, art. 293 B du CGI.</p>}
          </section>

          {/* Ce que ça vous laisse — jamais imprimé sur le devis du client. */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-medium">Pour votre entreprise</h2>
            <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">Votre marge, net de commission</p>
              <p
                className={`montant mt-2 text-lg font-medium ${
                  chiffres.cout > 0 && chiffres.margePct < 15 ? 'text-destructive' : ''
                }`}
              >
                {chiffres.cout > 0 ? euro2(chiffres.marge - chiffres.commission) : '—'}
                {chiffres.cout > 0 && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {chiffres.ht > 0
                      ? (((chiffres.marge - chiffres.commission) / chiffres.ht) * 100).toFixed(0)
                      : '0'}{' '}
                    %
                  </span>
                )}
              </p>
            </div>
            <div className="border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                Commission Celexia
                {etat?.taux_commission != null &&
                  ` (${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(etat.taux_commission * 100)} %)`}
              </p>
              <p className="montant mt-2 text-lg font-medium">{euro2(chiffres.commission)}</p>
            </div>
            </div>
          <div className="mt-4 border-t border-border pt-3">
          {afficheDebourses ? (
            <p className="text-xs text-muted-foreground">
              {chiffres.cout === 0
                ? 'Renseignez le déboursé d’une ligne pour voir votre marge.'
                : 'Marge et commission ne figurent pas sur le devis remis au client.'}
            </p>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto w-full justify-start whitespace-normal px-0 text-left text-xs text-muted-foreground"
              onClick={() => setDeboursesOuverts(true)}
            >
              <Calculator className="size-4" />
              Saisir mes déboursés pour voir ma marge
            </Button>
          )}

          </div>
          </section>

          <section className="space-y-4 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-medium">Conditions de paiement</h2>
            <Champ label="Acompte (%)" value={acompte} onChange={setAcompte} type="number" />
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={conditionsId}>Conditions</Label>
              <Textarea id={conditionsId} value={conditions} onChange={(e) => setConditions(e.target.value)} rows={4} className="text-sm leading-relaxed" />
            </div>
          </section>
          </aside>
          </fieldset>
        </div>

        {/* Actions — précédées du total, qui reste ainsi sous les yeux quelle
            que soit la position dans un devis de quinze lignes. */}
        <div className="shrink-0 border-t border-border bg-card px-4 py-3 sm:px-6">
          <div className="mb-2.5 flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {lignesRemplies.length} ligne{lignesRemplies.length > 1 ? 's' : ''}
              {tvaMode === 'normal' ? ' · TTC' : ''}
            </span>
            <span className="montant text-lg font-medium">{euro2(chiffres.ttc)}</span>
          </div>
          {/* Trois colonnes dès le mobile : un bouton pleine largeur ici
              occupait exactement la place de « Reprendre ces lignes » dans
              l'entretien, et un second appui envoyait le devis par email. */}
          <div className="grid grid-cols-3 gap-2">
          <Button ref={boutonApercu} variant="outline" className="min-w-0 px-2 text-xs sm:text-sm" onClick={apercu} disabled={busy}>
            <Eye className="hidden size-4 sm:block" aria-hidden />
            Aperçu
          </Button>
          <Button variant="outline" className="min-w-0 px-2 text-xs sm:text-sm" onClick={() => enregistrer('garder')} disabled={busy} aria-busy={busy}>
            {busy ? <Loader2 className="hidden size-4 animate-spin sm:block" aria-hidden /> : <Save className="hidden size-4 sm:block" aria-hidden />}
            Enregistrer
          </Button>
          <Button className="min-w-0 px-2 text-xs sm:text-sm" onClick={() => enregistrer('client')} disabled={busy} aria-busy={busy}>
            {busy ? <Loader2 className="hidden size-4 animate-spin sm:block" aria-hidden /> : <Send className="hidden size-4 sm:block" aria-hidden />}
            Au client
          </Button>
          </div>
        </div>

        {/* Surcouche plein panneau. Elle s'ancre sur le SheetContent sans que
            celui-ci porte `relative` : il est déjà `fixed`, donc bloc conteneur
            pour ses enfants absolus. Lui ajouter `relative` écrase ce `fixed`
            et fait retomber toute la feuille dans le flux du document. */}
        {entretienOuvert && (
          <EntretienDevis
            token={token}
            metier={initial?.metier}
            affectationToken={initial?.affectation_token}
            descriptionInitiale={initial?.description}
            onAnnuler={() => setEntretienOuvert(false)}
            onTermine={(l, o) => {
              verserLignes(l, o)
              setEntretienOuvert(false)
            }}
          />
        )}
        {apercuData && <ApercuDevis data={apercuData} onClose={() => setApercuData(null)} retourFocus={() => boutonApercu.current?.focus()} />}
      </SheetContent>
    </Sheet>
  )
}

function Champ({
  label,
  value,
  onChange,
  className,
  type,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  className?: string
  type?: string
  placeholder?: string
}) {
  // Sans lien entre l’étiquette et le champ, un lecteur d’écran annonce
  // « champ de saisie » sans dire lequel.
  const id = useId()
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <Input
        id={id}
        className="h-10"
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function telechargerBlob(blob: Blob, numero: string) {
  const url = URL.createObjectURL(blob)
  const lien = document.createElement('a')
  lien.href = url
  lien.download = `devis-${numero}.pdf`
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
