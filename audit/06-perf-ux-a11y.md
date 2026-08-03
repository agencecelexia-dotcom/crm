# A6 — Performance, UX mobile & accessibilité

> Audit du 2026-08-03 · tailles de bundle **mesurées** (`npm run build` réel) · ratios de contraste **calculés** (formule WCAG 2.1).
> **Distinction importante** : les tailles et les contrastes sont des mesures. Les temps de chargement et les Core Web Vitals sont des **estimations dérivées des tailles** — l'application n'a pas pu être lancée (pas de `.env.local`, donc pas de session Supabase), aucune mesure Lighthouse n'a été effectuée.

## Résumé

| Sévérité | Nombre |
|---|---|
| ÉLEVÉ | 3 |
| MOYEN | 5 |
| FAIBLE | 3 |

Le gain le plus rentable, et de loin : **découper le bundle par route**. Aujourd'hui, un artisan qui ouvre son lien de mission depuis un chantier télécharge la bibliothèque de graphiques du tableau de bord et la bibliothèque de cartographie — dont il n'a aucun usage. Retirer ces deux seules dépendances du chargement initial économise **523,6 kB bruts / 155,6 kB gzip**, chiffre mesuré, pour environ une heure de travail.

À l'inverse, le volet **UX mobile est solide** : la barre de navigation respecte les cibles tactiles et l'encoche, les claviers contextuels sont correctement déclarés, et le pad de signature gère proprement le tactile. Le vrai défaut d'accessibilité est ailleurs — **8 des 10 couleurs de statut échouent au contraste WCAG AA** avec le texte blanc actuel.

---

## Budget de chargement actuel vs cible

Chiffres bruts issus de la sortie de build (mesurés). La colonne « cible » suppose le découpage par route décrit en A6-01.

| Type de page | Actuel (gzip) | Cible (gzip) | Ce qui est téléchargé pour rien |
|---|---|---|---|
| **`/rejoindre`**, `/signer/:token`, `/mission/:token`, `/artisan/:token` (pages publiques, artisans sur chantier) | **~519 kB** | ~200 kB | recharts (110,7 kB) + leaflet (44,9 kB) + CSS leaflet + tout le code des 21 pages du CRM |
| **`/login`** | **~519 kB** | ~120 kB | l'intégralité de l'application, avant même de savoir si l'utilisateur a un compte |
| **`/` (tableau de bord)**, associés authentifiés | **~519 kB** | ~350 kB | leaflet (44,9 kB), non utilisé sur cette page |
| **`/carte`** | **~519 kB** | ~300 kB | recharts (110,7 kB), non utilisé sur cette page |

Composition du chargement initial actuel — **mesuré** :

```
index-Vp0lmbaI.js          885,10 kB  │ gzip: 258,51 kB   ← tout le code applicatif, 21 pages
vendor-charts-Du07T8HK.js  369,66 kB  │ gzip: 110,66 kB   ← recharts, 1 seul importeur
vendor-supabase-BY7vTDRq   208,14 kB  │ gzip:  54,42 kB
vendor-map-BRoCYxZ4.js     153,97 kB  │ gzip:  44,92 kB   ← leaflet, 2 importeurs
vendor-react-DK-K0gij.js    49,58 kB  │ gzip:  17,58 kB
vendor-query-DWZInx4z.js    36,21 kB  │ gzip:  10,80 kB
index-CduOLvqZ.css         111,44 kB  │ gzip:  22,07 kB
                          ─────────────────────────────
TOTAL                    1 814,10 kB  │ gzip: 518,96 kB
```

Correctement différés en revanche — le `import()` dynamique fonctionne là où il a été mis en place (`devis-pdf.ts:58`, `contrat-pdf.ts:14`, `pdf-extract.ts:95`) : `jspdf` (385 kB), `vendor-pdf`/pdfjs (432 kB), `pdf.worker` (1 255 kB), `html2canvas` (201 kB), `purify.es` (26 kB). Soit **2,3 Mo tenus hors du chemin critique**. La technique est donc connue et appliquée ; il ne reste qu'à l'étendre aux routes.

---

### [ÉLEVÉ] A6-01 — Aucun découpage par route : les pages publiques chargent tout le CRM

**Où** : `src/app/App.tsx:7-31` · `src/vite.config.ts:18-25`

**Constat** : recherche exhaustive de `React.lazy`, `lazy(` et `<Suspense` dans `src/` — **zéro occurrence**. `App.tsx:7-31` importe statiquement les 21 composants de page. Le graphe de modules est donc unique : tout ce qui est atteignable depuis `App` part dans le chunk initial.

Le `manualChunks` de `vite.config.ts:18-25` sépare bien six vendors, mais **séparer n'est pas différer** : `vendor-charts` et `vendor-map` sont importés statiquement par `App.tsx:12` et `:13`/`:16`, donc chargés en même temps que le reste.

Concrètement, recharts (369,66 kB) n'a qu'un seul importeur, `dashboard-page.tsx` — une page réservée aux deux associés. Leaflet n'est utilisé que par `carte-page.tsx` et `couverture-carte.tsx`. **Aucun des deux n'est utile sur les quatre pages publiques.** S'y ajoute `import 'leaflet/dist/leaflet.css'` dans `main.tsx:3`, qui charge la feuille de style de la cartographie sur absolument toutes les pages, y compris `/login`.

**Impact** : l'artisan est la population la plus pénalisée, et c'est celle sur laquelle l'agence a le moins de marge. Il ouvre son lien depuis un chantier, en 4G souvent médiocre, sur un téléphone d'entrée ou de milieu de gamme. Il télécharge ~519 kB compressés (1,81 Mo décompressés), dont l'essentiel ne lui servira jamais, puis son téléphone doit analyser et exécuter ~1,7 Mo de JavaScript avant le premier rendu utile.

**Estimation** (dérivée des tailles, non mesurée) : sur une 4G dégradée à ~1,6 Mbit/s effectifs, soit ~200 kB/s, le transfert seul prend ~2,6 s. En ajoutant la latence d'établissement et le coût d'analyse/exécution du JavaScript sur un mobile milieu de gamme (~1 à 2 s pour ce volume), un **LCP de l'ordre de 4 à 6 s** est plausible — bien au-delà du seuil « bon » de 2,5 s. Le CLS devrait être correct (les squelettes réservent l'espace) et l'INP acceptable une fois l'application chargée.

**Correctif** — découpage par route dans `App.tsx` :

```tsx
import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'

// Pages publiques : gardées en statique, ce sont les plus sensibles à la latence
import { LoginPage } from '@/features/auth/login-page'
import { SignerPage } from '@/features/contrats/signer-page'
import { MissionPage } from '@/features/contrats/mission-page'
import { EspaceArtisanPage } from '@/features/contrats/espace-artisan-page'
import { InscriptionArtisanPage } from '@/features/artisans/pages/inscription-artisan-page'

// Pages du CRM : chargées à la demande
const DashboardPage   = lazy(() => import('@/features/dashboard/dashboard-page').then(m => ({ default: m.DashboardPage })))
const CartePage       = lazy(() => import('@/features/carte/carte-page').then(m => ({ default: m.CartePage })))
const CouverturePage  = lazy(() => import('@/features/couverture/couverture-page').then(m => ({ default: m.CouverturePage })))
// … idem pour les 16 autres pages privées

const Chargement = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <Loader2 className="size-6 animate-spin text-muted-foreground" />
  </div>
)

// puis, dans la partie privée :
<Route element={<AppLayout />}>
  <Route path="/" element={<Suspense fallback={<Chargement />}><DashboardPage /></Suspense>} />
  {/* … */}
</Route>
```

Et déplacer la CSS Leaflet hors de `main.tsx` vers les seuls composants qui en ont besoin :

```ts
// carte-page.tsx et couverture-carte.tsx, en tête
import 'leaflet/dist/leaflet.css'
```

**Gain** — la part **mesurée** est immédiate : retirer `vendor-charts` (369,66 kB / 110,66 kB gzip) et `vendor-map` (153,97 kB / 44,92 kB gzip) du graphe initial représente **523,63 kB bruts / 155,58 kB gzip**, soit **30 % du poids gzip actuel**. Le découpage du chunk `index` (885 kB) par route apporterait davantage, mais le montant exact dépend de la répartition réelle du code partagé — c'est une estimation, pas une mesure, et il faudra relancer le build pour la trancher.

Ajouter enfin le garde-fou de budget proposé dans `05-build-tests-ci.md` (annexe A), avec un seuil abaissé après le découpage.

**Effort** : S — une heure environ, pour le meilleur rapport gain/effort de tout l'audit.

---

### [ÉLEVÉ] A6-02 — Huit des dix couleurs de statut échouent au contraste WCAG AA

**Où** : `src/lib/constants.ts:155-169` · `src/components/statut-badge.tsx`

**Constat** : chaque statut définit une couleur de fond et `textOnColor: '#FFFFFF'`. J'ai calculé les ratios de contraste réels selon la formule WCAG 2.1 :

| Statut | Couleur | Texte blanc | Verdict (seuil AA texte normal : 4,5:1) | Texte noir |
|---|---|---|---|---|
| `devis_envoye` | `#F59E0B` | **2,15:1** | échec net | 9,78:1 |
| `devis_signe` | `#22C55E` | **2,28:1** | échec net | 9,22:1 |
| `en_attente` | `#06B6D4` | **2,43:1** | échec net | 8,65:1 |
| `contacte` | `#0EA5E9` | **2,77:1** | échec net | 7,58:1 |
| `a_rappeler` | `#F97316` | **2,80:1** | échec net | 7,49:1 |
| `artisan_assigne` | `#3B82F6` | **3,68:1** | échec (acceptable si texte large) | 5,71:1 |
| `perdu` | `#EF4444` | **3,76:1** | échec (acceptable si texte large) | 5,58:1 |
| `rdv_pris` | `#8B5CF6` | **4,23:1** | échec limite | 4,96:1 |
| `nouveau` | `#64748B` | 4,76:1 | conforme | 4,41:1 |
| `termine` | `#0F766E` | 5,47:1 | conforme | 3,84:1 |

Le violet primaire `#7C3AED` sur blanc atteint **5,70:1** — conforme AA. La palette de marque n'est pas en cause ; ce sont les badges de statut.

**Impact** : les statuts sont l'information la plus dense de l'interface — ils pilotent le kanban, les listes, les pins de la carte et l'espace artisan. Un badge « Devis signé » à 2,28:1 est difficilement lisible en plein soleil sur un chantier, situation d'usage principale du produit. Le problème touche tout le monde, pas seulement les personnes malvoyantes.

**Correctif** : choisir la couleur de texte en fonction du fond plutôt que de forcer le blanc. Les valeurs de la colonne « texte noir » montrent que les huit statuts défaillants deviennent tous largement conformes avec un texte sombre.

```ts
// src/lib/constants.ts — textOnColor recalculé
export const STATUTS: Record<StatutProjet, { label: string; color: string; textOnColor: string }> = {
  nouveau:         { label: 'Nouveau',          color: '#64748B', textOnColor: '#FFFFFF' }, // 4,76
  a_rappeler:      { label: 'À rappeler',       color: '#F97316', textOnColor: '#1C1917' }, // 7,49
  en_attente:      { label: 'En attente',       color: '#06B6D4', textOnColor: '#0C2A33' }, // 8,65
  artisan_assigne: { label: 'Artisan assigné',  color: '#2563EB', textOnColor: '#FFFFFF' }, // 5,17 après assombrissement
  contacte:        { label: 'Client contacté',  color: '#0EA5E9', textOnColor: '#0A2540' }, // 7,58
  rdv_pris:        { label: 'RDV pris',         color: '#7C3AED', textOnColor: '#FFFFFF' }, // 5,70 (aligne sur la marque)
  devis_envoye:    { label: 'Devis envoyé',     color: '#F59E0B', textOnColor: '#1C1917' }, // 9,78
  devis_signe:     { label: 'Devis signé',      color: '#22C55E', textOnColor: '#052E16' }, // 9,22
  termine:         { label: 'Terminé',          color: '#0F766E', textOnColor: '#FFFFFF' }, // 5,47
  perdu:           { label: 'Perdu',            color: '#DC2626', textOnColor: '#FFFFFF' }, // 4,83 après assombrissement
}
```

Deux couleurs sont légèrement assombries (`artisan_assigne`, `perdu`) pour rester en texte blanc là où l'identité visuelle le justifie ; les six autres passent en texte sombre. Vérifier ensuite le rendu des pins Leaflet, qui utilisent les mêmes valeurs.

**Effort** : S.

---

### [ÉLEVÉ] A6-03 — Aucune pagination : toutes les listes chargent l'intégralité des tables

**Où** : `use-projets.ts:16-28` · `use-artisans.ts:15-27` · `use-taches.ts` · `use-notes-generales.ts` · `use-prospects.ts:13` · `carte-page.tsx:215,236`

**Constat** : `useInfiniteQuery` et `.range()` ne sont utilisés **nulle part** dans le projet. `.limit()` n'apparaît que quatre fois, dont deux `limit(1)`. Toutes les listes font un `select('*')` non borné : projets, artisans, corbeille, artisans écartés, notes, tâches, et `prospects_autour` sur un rayon de 150 à 200 km.

`carte-page.tsx:215,236` pose par ailleurs un marqueur Leaflet **par artisan et par projet**, sans regroupement.

**Impact** — projection par volume :

| Volume | Comportement attendu |
|---|---|
| < 200 lignes | Correct. C'est vraisemblablement la situation actuelle. |
| ~500 lignes | Ralentissement perceptible au chargement des listes ; la carte commence à saccader au déplacement sur mobile. |
| ~2 000 lignes | Listes difficilement utilisables sur téléphone (plusieurs milliers de nœuds DOM) ; carte quasi bloquée ; charge utile réseau de plusieurs mégaoctets à chaque `refetchOnWindowFocus`. |
| ~10 000 lignes | Inutilisable sur mobile. |

Le point aggravant est `refetchOnWindowFocus: true` en réglage global (`providers.tsx:12-20`) : **chaque retour sur l'onglet recharge l'intégralité des tables**. Sur un forfait mobile, c'est une consommation de données inutile et répétée.

Le risque n'est pas immédiat — il dépend du volume réel en base — mais il est structurel : rien ne dégradera progressivement, l'application deviendra lente d'un coup, à un seuil qu'on ne verra pas venir.

**Correctif**, par ordre de priorité :

1. **Colonnes explicites plutôt que `select('*')`** — gain immédiat, sans changement d'interface. `projets` porte des colonnes lourdes (`description`, `photos`) inutiles en vue liste :

```ts
.select('id, client_nom, client_ville, metier, statut, created_at, montant_devis_signe, commission')
```

2. **Pagination serveur** sur les listes principales :

```ts
export function useProjets(page = 0, taille = 50) {
  return useQuery({
    queryKey: cles.projets.page(page),
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('projets').select('…', { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(page * taille, page * taille + taille - 1)
      if (error) throw error
      return { lignes: data, total: count ?? 0 }
    },
    placeholderData: (prev) => prev,   // évite le clignotement au changement de page
  })
}
```

3. **Regroupement des marqueurs** sur la carte — `react-leaflet-cluster`, ou un filtrage par emprise visible.

À faire **avant** que le volume ne l'impose : rétrofitter la pagination sur une interface déjà construite autour de listes complètes coûte nettement plus cher.

**Effort** : S pour le point 1, M pour les points 2 et 3.

**À confirmer** : la section `volumetrie` de `audit/verification-prod.sql` donne le nombre de lignes réel par table, et donc l'urgence.

---

### [MOYEN] A6-04 — Le géocodage bloque jusqu'à 4,4 secondes pendant une création

**Où** : `src/lib/geocoding.ts:39-49` · `use-projets.ts:86` · `use-artisans.ts:61` · `inscription-artisan-page.tsx:32`

**Constat** : `geocoding.ts` impose une file sérialisée avec `MIN_INTERVALLE_MS = 1100`, par respect de la politique d'usage de Nominatim — c'est correct et volontaire. Mais les trois appelants **bouclent sur jusqu'à quatre variantes d'adresse** :

```ts
for (const c of candidats) { coord = await geocoder(c); if (coord) break }
```

Dans le pire cas — adresse mal formée, quatre tentatives infructueuses — cela fait **plus de 4,4 secondes**, à l'intérieur de la mutation de création.

**Impact** : le README annonce « saisie rapide, utilisable d'une main **pendant un appel** ». Or l'enregistrement d'un nouveau projet peut bloquer plusieurs secondes pendant que l'associé a le client au téléphone. Sur la page publique d'inscription artisan, même effet : l'artisan attend sans savoir pourquoi.

**Correctif** : sortir le géocodage du chemin critique. Enregistrer d'abord, géocoder ensuite.

```ts
// 1. Créer immédiatement, sans coordonnées
const projet = await creerProjet({ ...input, latitude: null, longitude: null })
// 2. Géocoder en tâche de fond, puis mettre à jour
void geocoderPuisMettreAJour(projet.id, input)
```

Le pin de carte apparaît quelques secondes plus tard, ce qui est sans conséquence : personne ne consulte la carte dans la seconde qui suit la création. Si le géocodage synchrone est conservé, afficher au minimum un état explicite (« Localisation de l'adresse… ») plutôt qu'un bouton figé.

Idéalement, déplacer le géocodage en tâche planifiée côté base, ce qui supprimerait aussi l'envoi des adresses clients depuis le navigateur (voir `02-securite-app.md`, A2-17).

**Effort** : M.

---

### [MOYEN] A6-05 — Requêtes N+1 séquentielles sur des opérations courantes

**Où** : `use-affectations.ts:104-113,127-138` · `assign-artisan.tsx:83` · `use-contrats.ts:37-45` · `projet-photos.tsx:23-25`

**Constat** : quatre schémas séquentiels là où le parallélisme ou une requête unique suffirait.

| Où | Motif | Coût |
|---|---|---|
| `use-affectations.ts:104-113` | `for (const p of ps) { await supabase.from('projets').update(…) }` | 1 aller-retour par projet |
| `assign-artisan.tsx:83` | `for (const a of toRemove) await retirer.mutateAsync(…)`, chaque retrait faisant DELETE + SELECT + UPDATE | 3 allers-retours × N, en série |
| `use-contrats.ts:37-45` | deux requêtes attendues l'une après l'autre dans un même `queryFn` | latence doublée sans raison |
| `projet-photos.tsx:23-25` | `for (const f of files) await uploaderPhoto(…)` | uploads séquentiels |

**Impact** : sur une liaison mobile avec 150 ms de latence, affecter 10 projets représente ~1,5 s d'attente, et en retirer 5 environ 2,3 s. L'aspect intégrité de ce même défaut — état partiel en cas de coupure — est traité dans `03-logique-metier.md` (A3-08), et la RPC transactionnelle qui y est proposée **résout aussi le problème de performance** : un seul aller-retour au lieu de N.

Pour les cas où le parallélisme suffit :

```ts
// use-contrats.ts — deux requêtes indépendantes
const [contrats, artisans] = await Promise.all([
  supabase.from('contrats').select('…'),
  supabase.from('artisans').select('…'),
])

// projet-photos.tsx — uploads concurrents
const urls = await Promise.all(files.map((f) => uploaderPhoto(projetId, f)))
```

**Effort** : S pour `Promise.all`, M pour la RPC d'affectation (mutualisé avec A3-08).

---

### [MOYEN] A6-06 — Chaque événement d'authentification re-rend l'application entière

**Où** : `src/app/App.tsx:36-38`

**Constat** : `AuthProvider` enveloppe `BrowserRouter`. Tout changement d'état renvoyé par `onAuthStateChange` — y compris le **rafraîchissement automatique du jeton, environ toutes les heures** — met à jour l'état du provider et déclenche un nouveau rendu de tout l'arbre situé en dessous, c'est-à-dire l'application complète.

**Impact** : un à-coup périodique pendant l'utilisation, plus marqué sur les pages lourdes (carte avec ses marqueurs, tableau de bord avec ses graphiques). Sur mobile, c'est perceptible. L'impact reste modéré car React réconcilie efficacement, mais le rendu des composants Leaflet et Recharts n'est pas gratuit.

**Correctif** : ne propager que ce qui change réellement, en mémorisant la valeur du contexte.

```tsx
const valeur = useMemo(
  () => ({ session, isLoading, signIn, signOut }),
  [session, isLoading],   // signIn/signOut sont stables si définis avec useCallback
)
return <AuthContext.Provider value={valeur}>{children}</AuthContext.Provider>
```

et envelopper `signIn`/`signOut` dans `useCallback`. Comparer par ailleurs `session?.user?.id` plutôt que l'objet `session` complet avant de mettre à jour l'état, afin d'ignorer les rafraîchissements de jeton qui ne changent pas l'utilisateur.

**Effort** : S.

---

### [MOYEN] A6-07 — La PWA est annoncée mais n'existe pas

**Où** : `public/manifest.webmanifest` · `index.html:13` · `README.md:169,204`

**Constat** : le manifeste est valide et complet (`name`, `short_name`, `start_url`, `scope`, `display: standalone`, `theme_color`, icônes 192 et 512 en `any maskable`, toutes présentes dans `/public`). Mais **aucun service worker n'existe** : zéro occurrence de `serviceWorker`, `workbox`, `vite-plugin-pwa` ou `sw.js` dans tout le dépôt. Les critères d'installabilité de Chrome exigent un gestionnaire `fetch` ; en son absence, l'invite d'installation n'apparaît pas et il n'y a ni cache, ni fonctionnement hors ligne.

**Est-ce un vrai besoin ?** Tranchons honnêtement : **non, pas pour le mode hors ligne.** Toutes les données proviennent de Supabase en temps réel, et les actions du CRM sont des écritures (créer un projet, saisir un montant, affecter un artisan). Un mode hors ligne imposerait une file de synchronisation et une résolution de conflits — un chantier conséquent pour un bénéfice marginal, puisque saisir un projet sans réseau, sans pouvoir géocoder ni vérifier les doublons, n'a guère de sens.

**En revanche, deux bénéfices sont réels et peu coûteux** : la mise en cache du *shell* applicatif (le JavaScript et la CSS), qui rendrait les visites suivantes quasi instantanées — particulièrement précieux vu les 519 kB de A6-01 — et l'installation sur l'écran d'accueil, qui donne un accès en un geste, utile pour un outil consulté plusieurs fois par jour.

**Correctif** — se limiter au cache du shell, sans prétendre au hors-ligne :

```bash
npm i -D vite-plugin-pwa
```

```ts
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa'

plugins: [
  react(),
  tailwindcss(),
  VitePWA({
    registerType: 'autoUpdate',
    manifest: false,                       // le manifeste existant est conservé
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      navigateFallback: '/index.html',
      // Ne JAMAIS mettre en cache les réponses Supabase : données financières et PII
      navigateFallbackDenylist: [/^\/api/],
      runtimeCaching: [],
    },
  }),
]
```

Le point important est `runtimeCaching: []` : mettre en cache des réponses Supabase exposerait des données clients dans le stockage du navigateur, ce qui aggraverait le défaut de cloisonnement déjà relevé en A4-02.

Si ce chantier n'est pas retenu, **retirer la mention PWA du README** (A5-03) : une promesse non tenue dans la documentation coûte plus cher qu'une fonctionnalité absente.

**Effort** : S.

---

### [MOYEN] A6-08 — Aucun retour visuel pendant les opérations longues

**Où** : `use-projets.ts:86` (géocodage) · `projet-photos.tsx:23-25` (uploads) · `devis-pdf.ts:58` (génération de PDF)

**Constat** : trois opérations dépassent régulièrement la seconde sans indication de progression : le géocodage (jusqu'à 4,4 s, A6-04), les uploads de photos en série, et la génération de PDF — qui déclenche le chargement dynamique de `jspdf` (385 kB) et parfois `html2canvas` (201 kB), soit ~173 kB gzip à télécharger avant même de commencer.

Les squelettes de chargement sont bien présents pour les requêtes (14 fichiers), mais **les mutations longues n'ont pas d'équivalent**.

**Impact** : l'utilisateur clique une seconde fois, croyant que rien ne s'est passé. Sur une création de projet, cela produit un doublon.

**Correctif** : désactiver le bouton pendant l'opération et nommer l'étape en cours.

```tsx
<Button disabled={mutation.isPending}>
  {mutation.isPending
    ? <><Loader2 className="mr-2 size-4 animate-spin" />Localisation de l’adresse…</>
    : 'Enregistrer le projet'}
</Button>
```

Pour la génération de PDF, précharger `jspdf` au survol du bouton (`onMouseEnter={() => void import('jspdf')}`) : le téléchargement démarre pendant que l'utilisateur vise, et le clic paraît instantané.

**Effort** : S.

---

### [FAIBLE] A6-09 — Boutons à icône seule sans libellé accessible

**Où** : composants utilisant `lucide-react` sans texte associé

**Constat** : les icônes lucide sont rendues en SVG sans texte. Les boutons qui n'affichent qu'une icône — actions de liste, fermeture, suppression, navigation — sont annoncés par les lecteurs d'écran comme « bouton », sans indication de leur fonction, sauf si un `aria-label` est fourni.

**À nuancer** : `bottom-nav.tsx` fait les choses correctement (`aria-label="Navigation principale"` sur le `<nav>`, et chaque lien porte un libellé textuel visible sous l'icône). Les composants Radix (Dialog, Sheet, DropdownMenu) gèrent nativement leurs libellés de fermeture. Le défaut est donc partiel, concentré sur les boutons d'action des listes et des fiches.

**Impact** : faible sur un outil interne à deux personnes. À prendre plus au sérieux sur les pages publiques, consultées par un nombre indéterminé d'artisans.

**Correctif** : ajouter systématiquement `aria-label` sur les boutons sans texte visible.

```tsx
<Button size="icon" variant="ghost" aria-label="Supprimer le projet">
  <Trash2 className="size-4" />
</Button>
```

La règle `jsx-a11y/control-has-associated-label` peut automatiser la détection, si `eslint-plugin-jsx-a11y` est ajouté à la configuration (voir `04-qualite-code.md`, A4-11).

**Effort** : M — mécanique, réparti sur de nombreux points.

---

### [FAIBLE] A6-10 — Aucune prise en compte de `prefers-reduced-motion`

**Où** : `src/index.css` · `tw-animate-css`

**Constat** : le projet utilise `tw-animate-css` et des transitions (`transition-colors`, `animate-spin`, `active:scale-[0.98]` dans `bottom-nav.tsx:31`). Aucune règle `@media (prefers-reduced-motion: reduce)` n'est définie.

**Impact** : les personnes sensibles au mouvement — vestibulaire, migraines — n'ont aucun moyen d'atténuer les animations, alors que leur système est configuré pour le signaler. L'impact reste limité ici, les animations étant sobres.

**Correctif** — quelques lignes dans `src/index.css` :

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Vérifier ensuite que les indicateurs de chargement restent perceptibles (un `animate-spin` figé n'informe plus) — leur préférer un état textuel lorsque le mouvement est réduit.

**Effort** : S.

---

### [FAIBLE] A6-11 — Les polices sont chargées depuis deux CDN tiers, sans repli

**Où** : `index.html:22-29`

**Constat** : deux feuilles de style externes sont chargées, depuis `fonts.googleapis.com` (Plus Jakarta Sans) et `api.fontshare.com` (Clash Display). Les `preconnect` sont correctement posés (`:20-21`), ce qui est un bon réflexe. Mais aucune stratégie de repli n'est prévue si l'un de ces domaines est lent ou inaccessible.

**Impact** : deux requêtes bloquantes vers des tiers avant le premier rendu du texte. `display=swap` est présent sur les deux URL, ce qui évite le texte invisible — le texte s'affiche donc dans une police de repli puis bascule, au prix d'un léger décalage visuel. Effet secondaire important, traité dans `02-securite-app.md` (A2-03) : ces requêtes transmettent l'URL courante — **token compris** — à Google et Fontshare via l'en-tête `Referer`.

**Correctif** : héberger les polices localement. Cela supprime les deux dépendances externes, la fuite via `Referer`, et permet de restreindre la CSP.

```bash
npm i -D @fontsource-variable/plus-jakarta-sans
```

```ts
// src/main.tsx
import '@fontsource-variable/plus-jakarta-sans'
```

Clash Display n'étant pas disponible sur Fontsource, télécharger les fichiers `.woff2` dans `public/fonts/` et déclarer les `@font-face` dans `src/index.css`, avec `font-display: swap`. Vérifier la licence Fontshare pour l'auto-hébergement.

**Effort** : S.

---

## Ce qui est bien fait

Le volet mobile est nettement plus solide que le volet performance — c'est un point à souligner, car c'est la promesse principale du produit.

- **La barre de navigation est exemplaire** (`bottom-nav.tsx`) : `min-h-[56px]` dépasse le seuil recommandé de 48 px, `pb-[env(safe-area-inset-bottom)]` gère correctement l'encoche des iPhone, `aria-label` sur le `<nav>`, libellé textuel sous chaque icône, et retour tactile via `active:scale-[0.98]`. La promesse « utilisable d'une main » est tenue.
- **Les claviers contextuels sont correctement déclarés** : `type="tel"` (`projet-form.tsx:138`, `artisan-form.tsx:336`), `type="email"` (`:150`, `:348`), `inputMode="decimal"` sur tous les champs monétaires (`montants-card.tsx:91,102,145,160`, `devis-builder.tsx:293,331`), `inputMode="numeric"` sur les entiers. C'est un détail souvent négligé, et il fait une vraie différence à la saisie sur téléphone.
- **Le pad de signature gère proprement le tactile** (`signature-pad.tsx`) : événements *pointer* plutôt que *mouse*, `style={{ touchAction: 'none' }}` (`:74`) pour empêcher le défilement pendant le tracé, et `preventDefault()` aux bons endroits (`:39`, `:48`). Sans dépendance externe.
- **La hauteur des champs est harmonisée à `h-11`** (44 px) sur les formulaires — cohérent avec les recommandations de cible tactile.
- **Le chargement différé est déjà maîtrisé là où il a été appliqué** : `jspdf`, `pdfjs-dist` et `html2canvas` sont chargés par `import()` dynamique, soit **2,3 Mo tenus hors du chemin critique**. La technique est connue de l'équipe ; A6-01 ne demande que de l'étendre aux routes.
- **Le `manualChunks` est déjà pensé** (`vite.config.ts:18-25`), avec six chunks vendors distincts — le socle du découpage est en place.
- **Les squelettes de chargement sont présents dans 14 fichiers**, avec un soin particulier sur `espace-artisan-page.tsx:67-88`.
- **Le violet de marque `#7C3AED` est conforme WCAG AA sur blanc** (5,70:1). La palette principale est accessible ; seules les couleurs de statut posent problème.
- **Le géocodage respecte scrupuleusement la politique d'usage de Nominatim** — file sérialisée à 1100 ms, cache `localStorage`, adresse de contact identifiable. La lenteur relevée en A6-04 est la conséquence d'un choix respectueux, pas d'une négligence : le correctif consiste à sortir l'opération du chemin critique, pas à accélérer les appels.
