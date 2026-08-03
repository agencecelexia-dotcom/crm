# A4 — Qualité du code & architecture

> Audit du 2026-08-03 · périmètre : `src/` (138 fichiers, 18 476 LOC).
> Mesures réelles après `npm install` : `tsc -b --noEmit` → **0 erreur** · `eslint .` → **0 problème**.

## Résumé

Commençons par ce qui est objectivement bon, parce que c'est notable et que ça oriente les priorités.

**Le projet compile et lint sans la moindre erreur, sur 18 476 lignes, sans aucune CI pour l'imposer.** Il ne contient **aucun `any`**, **aucun `@ts-ignore`**, et **une seule** directive `eslint-disable` dans tout le dépôt. `tsconfig.app.json` active `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` et `verbatimModuleSyntax`. Le découpage par `features/` est cohérent et tenu. Les 12 fichiers de hooks suivent tous le même patron. C'est une base saine, et la plupart des défauts ci-dessous sont des ajouts, pas des réécritures.

| Sévérité | Nombre |
|---|---|
| CRITIQUE | 1 |
| ÉLEVÉ | 3 |
| MOYEN | 5 |
| FAIBLE | 3 |

Les trois plus graves : l'absence totale d'ErrorBoundary rend une page publique blanchissable par une simple valeur inattendue · la déconnexion ne vide jamais le cache de données clients · les conventions de clés react-query divergent en trois styles, avec des invalidations croisées écrites en dur.

---

### [CRITIQUE] A4-01 — Aucun ErrorBoundary : une exception de rendu blanchit toute l'application

**Où** : absence dans tout `src/` · chemin d'exposition : `src/features/contrats/espace-artisan-page.tsx:664`

**Constat** : recherche exhaustive sur `ErrorBoundary`, `componentDidCatch`, `getDerivedStateFromError` et `errorElement` — **zéro occurrence**. `App.tsx` ne définit aucune frontière d'erreur, et le routeur v7 est utilisé en mode `<BrowserRouter>` déclaratif, donc sans `errorElement`.

Conséquence : toute exception levée pendant le rendu remonte jusqu'à la racine, React démonte l'arbre entier, et l'utilisateur voit une page blanche — sans message, sans bouton, sans moyen de comprendre.

Un chemin d'exposition concret existe déjà :

```tsx
// espace-artisan-page.tsx:664
STATUTS[projet.statut].color
```

`projets.statut` est une colonne `text` sans contrainte (voir `03-logique-metier.md`, A3-06), et `noUncheckedIndexedAccess` n'est pas activé, donc TypeScript considère cet accès comme sûr. Une valeur absente de `STATUTS` produit `Cannot read properties of undefined`.

**Impact** : il s'agit d'une **page publique** — celle où l'artisan consulte ses chantiers et signe son contrat d'engagement. Un écran blanc y signifie un artisan bloqué, sans recours ni message, sur un acte contractuel. C'est aussi vrai des trois autres pages publiques, qui n'ont aucune protection.

**Correctif** — deux ajouts complémentaires. D'abord la frontière :

```tsx
// src/components/error-boundary.tsx
import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { erreur: Error | null }
> {
  state = { erreur: null as Error | null }
  static getDerivedStateFromError(erreur: Error) { return { erreur } }

  render() {
    if (!this.state.erreur) return this.props.children
    return this.props.fallback ?? (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold">Une erreur est survenue.</p>
        <p className="text-sm text-muted-foreground">
          Rechargez la page. Si le problème persiste, contactez Celexia.
        </p>
        <button onClick={() => window.location.reload()} className="…">Recharger</button>
      </div>
    )
  }
}
```

À poser dans `App.tsx`, autour de `<Routes>`, **et** individuellement autour de chaque page publique pour que l'échec de l'une n'affecte pas les autres. Ensuite, le repli sur le statut (`statutInfo()`, détaillé en A3-06) qui supprime la cause la plus probable.

**Effort** : S.

---

### [ÉLEVÉ] A4-02 — La déconnexion ne vide pas le cache : les données clients survivent en mémoire

**Où** : `src/lib/auth/auth-provider.tsx:34-36` · `src/app/layout/header.tsx:44` · `src/app/layout/sidebar.tsx:97`

**Constat** :

```ts
const signOut = async () => {
  await supabase.auth.signOut()
}
```

Deux problèmes. Le retour de `signOut()` — qui porte une éventuelle erreur — est **ignoré** : si la déconnexion échoue côté serveur, l'interface se comporte comme si elle avait réussi. Et surtout, **`queryClient.clear()` n'est jamais appelé** : aucune occurrence de `clear()` ou `removeQueries()` dans tout `src/`. Les deux points d'appel sont des `onClick={() => void signOut()}`, sans gestion d'échec.

**Impact** : après déconnexion, le cache react-query conserve en mémoire l'ensemble des données chargées — projets, coordonnées clients, artisans, montants, commissions. Sur un poste partagé ou un téléphone prêté, une reconnexion avec un autre compte, ou un simple retour arrière du navigateur, peut réafficher les données du compte précédent avant que les requêtes ne soient rejouées. Sur une application qui manipule des données personnelles de clients, c'est un défaut de cloisonnement.

**Correctif** :

```tsx
// auth-provider.tsx
import { useQueryClient } from '@tanstack/react-query'

const queryClient = useQueryClient()

const signOut = async () => {
  const { error } = await supabase.auth.signOut()
  queryClient.clear()              // vider dans tous les cas, y compris en cas d'échec serveur
  if (error) throw error
}
```

`AuthProvider` doit alors être **à l'intérieur** de `AppProviders` pour accéder au `QueryClient` — ce qui est déjà le cas puisque `App.tsx:36-37` imbrique `<AppProviders><AuthProvider>`.

**Effort** : S.

---

### [ÉLEVÉ] A4-03 — Trois conventions de clés react-query coexistent, avec des invalidations croisées en dur

**Où** : `use-projets.ts:18,34,51`, `use-artisans.ts:17,33,226`, `use-taches.ts:26`, `use-stats-artisans.ts:19`, `use-prospects.ts:13`, `use-devis.ts:22,105`, `action-du-jour.tsx:20`

**Constat** : trois styles cohabitent sans règle.

| Style | Exemples |
|---|---|
| Hiérarchique `['entite', id]` | `['projets']`, `['projets', id]`, `['affectations', projetId]` |
| Plat en kebab-case | `['scoring-artisan', id]`, `['stats-artisans']`, `['action-du-jour']`, `['prospects-autour', …]` |
| Constante de module | `const qc_key = ['taches']` (`use-taches.ts:26`), réutilisée pour la requête et sept invalidations |

Plus grave, les invalidations franchissent les frontières de features en littéraux écrits à la main : `use-artisans.ts:206` invalide `['contrats','signes']`, `use-prospects.ts:121-122` invalide `['artisans']` et `['couverture']`, et `use-devis.ts:105` invalide `['espace', token]` — une clé **définie ailleurs**, dans `espace-artisan-page.tsx:56`.

**Impact** : une faute de frappe dans un littéral produit une invalidation silencieusement inopérante — l'interface affiche des données périmées sans qu'aucune erreur ne soit levée, et le compilateur ne peut rien signaler. C'est la classe de bug la plus coûteuse à diagnostiquer, parce qu'elle est intermittente et non reproductible à volonté. Le couplage entre features est par ailleurs invisible : rien n'indique dans `espace-artisan-page.tsx` que `use-devis.ts` dépend de sa clé.

**Correctif** — une fabrique unique, typée, qui rend les fautes de frappe impossibles :

```ts
// src/lib/query-keys.ts
export const cles = {
  projets: {
    tous:   () => ['projets'] as const,
    un:     (id: string) => ['projets', id] as const,
    corbeille: () => ['projets', 'corbeille'] as const,
  },
  artisans: {
    tous:   () => ['artisans'] as const,
    un:     (id: string) => ['artisans', id] as const,
    scoring:(id: string) => ['artisans', id, 'scoring'] as const,
    stats:  () => ['artisans', 'stats'] as const,
  },
  affectations: { parProjet: (id: string) => ['affectations', id] as const },
  espace:  { parToken: (t: string) => ['espace', t] as const },
  taches:  { toutes: () => ['taches'] as const },
} as const
```

Migration réaliste, sans big bang : adopter la fabrique pour tout nouveau code, puis convertir feature par feature en commençant par celles qui ont des invalidations croisées (`artisans`, `devis`, `prospects`). Une invalidation devient alors `qc.invalidateQueries({ queryKey: cles.artisans.tous() })`, et le renommage d'une clé est une opération du compilateur.

Retirer au passage les `refetchOnWindowFocus: true` redondants (`use-affectations.ts:27,44`, `use-suivis.ts:11`, `use-taches.ts:32`, `espace-artisan-page.tsx:58`, `action-du-jour.tsx:21`) : c'est déjà le défaut global de `providers.tsx:12-20`.

**Effort** : M — la fabrique est rapide, la migration progressive.

---

### [ÉLEVÉ] A4-04 — Les erreurs de requête ne sont presque jamais affichées

**Où** : `espace-artisan-page.tsx:89` (seul usage de `isError`) · `action-du-jour.tsx:33` · l'ensemble des pages de liste

**Constat** : sur toutes les requêtes du projet, **une seule** gère l'état d'erreur. Partout ailleurs, un `useQuery` en échec laisse `data === undefined`, et le composant traite ce cas comme « vide » ou « en cours de chargement ». `action-du-jour.tsx:33` illustre le patron : `if (!data) return null` — le bloc disparaît sans un mot.

Côté mutations, le patron `onError` est présent 29 fois, mais plusieurs mutations n'en ont aucun : `use-notifications.ts:33-52`, `useDeleteNoteGenerale` (`use-notes-generales.ts:48`), `useAffecterProjets`, et `useCreerDevis` (`use-devis.ts:56-68`) qui n'a **ni `onError` ni `onSuccess`** — donc pas d'invalidation non plus.

**Impact** : une panne réseau, une expiration de session ou une erreur RLS se traduisent visuellement par « il n'y a rien ». L'utilisateur conclut que les données ont disparu, ou pire, agit sur une vue incomplète : un tableau de bord qui affiche 0 € parce que la requête a échoué est indiscernable d'un tableau de bord à 0 €. Sur des données financières, la distinction est essentielle.

**Correctif** : un composant d'état d'erreur réutilisable, à côté des `Skeleton` déjà utilisés dans 14 fichiers.

```tsx
// src/components/query-state.tsx
export function EtatRequete({ isLoading, isError, refetch, children, squelette }: {…}) {
  if (isLoading) return squelette ?? <Skeleton className="h-32 w-full" />
  if (isError) return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p className="font-medium">Impossible de charger ces données.</p>
      <button onClick={() => refetch()} className="mt-2 underline">Réessayer</button>
    </div>
  )
  return <>{children}</>
}
```

À appliquer en priorité au tableau de bord, à la page commissions et aux listes projets/artisans — les vues sur lesquelles une décision est prise.

**Effort** : M.

---

### [MOYEN] A4-05 — Aucune route 404 : toute URL inconnue redirige vers l'accueil

**Où** : `src/app/App.tsx:82`

**Constat** : `<Route path="*" element={<Navigate to="/" replace />} />`. Toute URL non reconnue renvoie silencieusement vers `/`, et donc vers `/login` si l'utilisateur n'est pas authentifié.

**Impact** : un artisan qui ouvre un lien tronqué par son client de messagerie — cas fréquent avec des tokens de 32 caractères — atterrit sur un écran de connexion qu'il ne peut pas franchir, sans aucune explication. Il conclura que le CRM est cassé, ou que le lien a expiré. Pour un usage grand public, c'est un vrai coût de support.

**Correctif** : une page 404 explicite, qui distingue les deux cas.

```tsx
<Route path="*" element={<PageIntrouvable />} />
```

`PageIntrouvable` affiche « Cette page n'existe pas », et si l'URL commence par `/artisan/`, `/mission/` ou `/signer/`, un message spécifique : « Ce lien semble incomplet ou expiré. Contactez Celexia au 07 69 13 61 82. » Le numéro est déjà dans le code (`inscription-artisan-page.tsx:23`).

**Effort** : S.

---

### [MOYEN] A4-06 — `espace-artisan-page.tsx` : 987 lignes, plusieurs responsabilités, sur une page publique

**Où** : `src/features/contrats/espace-artisan-page.tsx`

**Constat** : le plus gros fichier du projet. Il porte la requête de données (`:56-63`), la signature du contrat (`:547`), l'édition des informations client (`:854-877`), l'affichage des commissions (`:279-296`, `:338-372`), la liste filtrée des chantiers, et plusieurs sous-composants définis en ligne (`MesDevis` monté en `:231`, `DevisBuilder` en `:244`, `ClientBloc` en `:854`). Un drapeau fonctionnel y est codé en dur sous forme d'UUID (`METBACH_ID`, `:49`).

**Impact** : c'est la page la plus exposée du produit — publique, utilisée par tous les artisans, portant un acte contractuel — et la plus difficile à modifier sans régression. Sa taille explique aussi qu'elle concentre plusieurs défauts relevés ailleurs (A4-01, A4-04, appels RPC hors hooks).

**Correctif** — découpage concret, sans réécriture :

| Extraire vers | Contenu | Lignes source |
|---|---|---|
| `hooks/use-espace-artisan.ts` | la requête `get_espace_artisan` + sa clé | `:56-63` |
| `components/espace-signature-card.tsx` | contrat + `signer_contrat` + pad de signature | `~:500-560` |
| `components/espace-client-bloc.tsx` | `ClientBloc` et `update_projet_by_token` | `:854-877` |
| `components/espace-commissions.tsx` | totaux et taux de conversion | `:279-296`, `:338-372` |
| `components/espace-chantier-card.tsx` | carte d'un chantier + filtres | `~:640-720` |

La page conserve alors la composition et le routage, autour de 200 lignes. Commencer par `use-espace-artisan.ts` et `espace-client-bloc.tsx` : ce sont les deux qui portent des correctifs de sécurité prévus par ailleurs (validation des saisies), donc autant les isoler d'abord.

Même approche pour `artisan-form.tsx` (846 lignes) : en extraire les sections en `<FieldsetIdentite>`, `<FieldsetSociete>`, `<FieldsetZones>`, `<FieldsetAssurances>`, chacune recevant le `form` de react-hook-form.

**Effort** : M par fichier.

---

### [MOYEN] A4-07 — Les appels RPC hors hooks échappent au cache, aux retries et aux états de chargement

**Où** : `espace-artisan-page.tsx:547,858` · `mission-page.tsx:172` · `suivi-artisan.tsx:53,97` · `upload-devis.tsx:43,70` · `inscription-artisan-page.tsx:87,286,302` · `signer-page.tsx:34-46,58`

**Constat** : la couche données est par ailleurs homogène — 12 fichiers de hooks, tous au même patron. Mais **toutes les pages publiques** font exception : leurs appels RPC sont des `await` nus dans des gestionnaires d'événements. `signer-page.tsx:34-46` va plus loin et n'utilise pas react-query du tout, avec un `useEffect` + `.then()`.

**Impact** : ces appels ne bénéficient d'aucun des mécanismes de la couche données — pas de `retry: 1` (pourtant configuré globalement), pas de cache, pas d'état de chargement uniforme, pas d'invalidation. Sur les pages publiques, précisément celles consultées depuis un chantier en 4G instable, l'absence de retry signifie qu'une requête perdue est un échec définitif. C'est l'inverse de ce qu'il faudrait : ce sont les pages les moins fiables en réseau qui ont le moins de garanties.

**Correctif** : ramener ces appels dans des hooks, feature par feature, en commençant par les mutations contractuelles (`signer_contrat`, `set_montant_by_token`).

```ts
// src/features/contrats/hooks/use-signer-contrat.ts
export function useSignerContrat(token: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ nom, signature }: { nom: string; signature: string }) => {
      const { data, error } = await supabase.rpc('signer_contrat', {
        p_token: token, p_signataire: nom, p_signature: signature,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: cles.espace.parToken(token) }),
    onError: (e) => toast.error('Signature impossible', { description: messagePublic(e) }),
  })
}
```

`messagePublic` vient de `02-securite-app.md` (A2-04) : le même refactor sert les deux objectifs.

**Effort** : M.

---

### [MOYEN] A4-08 — Une quinzaine de formulaires écrivent en base sans schéma de validation

**Où** : zod n'est présent que dans `login-page.tsx:24`, `projet-form.tsx:68`, `artisan-form.tsx:36-76`

**Constat** : les trois formulaires validés le sont correctement, avec `zodResolver` et react-hook-form — le patron est connu et bien appliqué. Mais une quinzaine d'autres écrivent en base avec des gardes ad hoc ou aucune :

| Fichier:ligne | Écrit | Garde |
|---|---|---|
| `espace-artisan-page.tsx:854-877` | email, CP, adresse, budget du client | **aucune** |
| `devis-builder.tsx:163-175` | devis complet, lignes, prix, PII client | `!cli.nom.trim()` |
| `upload-devis.tsx:35-56` | montants, URL de devis | `isNaN(parseFloat)` |
| `montants-card.tsx:37-71` | montants, taux, date de signature | `parseFloat` |
| `notes-internes-card.tsx:34`, `suivi-card.tsx:26`, `notes-page.tsx:28` | contenus texte | aucune |
| `prospects-panel.tsx:142,372` | mise à jour prospect, création artisan | aucune |

Par ailleurs, **aucune réponse Supabase n'est validée** : tout est casté (`data as EspaceArtisan`, `data as Mission`…).

**Impact** : les deux premières lignes du tableau sont sur des **pages publiques**, et écrivent des données financières et des PII sans contrôle. Les correctifs serveur proposés en A1-09 et A3-07 traitent la sécurité ; la validation client reste nécessaire pour l'expérience — un message clair vaut mieux qu'un rejet serveur opaque.

**Correctif** : centraliser les schémas réutilisables, puis les appliquer.

```ts
// src/lib/schemas.ts
import { z } from 'zod'
export const email = z.string().email('Adresse email invalide')
export const codePostal = z.string().regex(/^\d{5}$/, 'Code postal invalide (5 chiffres)')
export const montantEuros = z.coerce.number()
  .min(0, 'Le montant ne peut pas être négatif')
  .max(10_000_000, 'Montant trop élevé')

export const clientSchema = z.object({
  client_nom: z.string().min(1, 'Nom requis'),
  client_email: email.optional().or(z.literal('')),
  client_code_postal: codePostal.optional().or(z.literal('')),
  budget_estime: montantEuros.optional(),
})
```

Priorité : `ClientBloc` et `upload-devis.tsx`, les deux points d'écriture publics.

**Effort** : M.

---

### [MOYEN] A4-09 — Les types de base de données sont maintenus à la main et non branchés au client

**Où** : `src/types/database.ts:1-2` · `src/lib/supabase/client.ts:10`

**Constat** : `src/types/database.ts` (373 lignes) porte en tête le commentaire *« On les maintient à la main (pas de génération auto) »*. Et `createClient(...)` n'est **pas paramétré** par un type `Database`, donc `.from()` et `.rpc()` renvoient des types non contraints, systématiquement castés à la main. On compte 5 doubles casts `as unknown as` (`use-projets.ts:26,43,199`, `use-automatisations.ts:103,122`) et 4 `Record<string, unknown>` pour les patches.

**Impact** : le cast est un point aveugle. Rien ne garantit que `src/types/database.ts` corresponde encore au schéma réel après 60 migrations. Un exemple concret de divergence non détectable : `Projet.statut` est typé comme une union fermée côté TypeScript, alors que la colonne SQL est un `text` sans contrainte — c'est exactement la faille qui rend A4-01 et A3-06 possibles. Le compilateur affirme une garantie que la base ne fournit pas.

**Correctif** : générer les types et brancher le client.

```bash
npx supabase gen types typescript --project-id oymnthijjbwkatrhqzvi > src/types/supabase.ts
```

```ts
// src/lib/supabase/client.ts
import type { Database } from '@/types/supabase'
export const supabase = createClient<Database>(url, key)
```

Conserver `src/types/database.ts` pour les types de vue (`EspaceArtisan`, `Mission`, `ContratPublic`) qui décrivent des retours JSON de RPC et n'ont pas d'équivalent généré. Régénérer après chaque migration — à ajouter au workflow CI proposé dans `05-build-tests-ci.md`.

**Effort** : M — la génération est immédiate, la résorption des erreurs révélées demande une passe.

---

### [FAIBLE] A4-10 — `noUncheckedIndexedAccess` désactivé, alors qu'il aurait attrapé le défaut critique

**Où** : `tsconfig.app.json`

**Constat** : `strict: true` est actif, mais `noUncheckedIndexedAccess` et `exactOptionalPropertyTypes` ne le sont pas. Le premier aurait typé `STATUTS[projet.statut]` en `… | undefined` et **fait échouer la compilation** sur la ligne à l'origine de A4-01.

**Impact** : la classe de bug la plus dangereuse du projet — l'accès indexé non vérifié sur une page publique — est invisible au compilateur.

**Correctif** :

```jsonc
// tsconfig.app.json
"noUncheckedIndexedAccess": true
```

L'activation fera apparaître un lot d'erreurs sur tous les accès indexés du projet. C'est le coût d'entrée, et il est ponctuel. À traiter en une passe dédiée, pas au milieu d'une autre modification.

**Effort** : M.

---

### [FAIBLE] A4-11 — 2 562 lignes exclues du lint et aucun lint type-aware

**Où** : `eslint.config.js:11`

**Constat** : `globalIgnores(['dist', 'src/components/ui/**', 'n8n/**'])` retire 28 fichiers (~2 562 lignes) du champ d'analyse. Et la configuration n'étend que `tseslint.configs.recommended`, pas `recommendedTypeChecked` : aucune règle utilisant les informations de type n'est active.

**Impact** : ignorer `src/components/ui/**` est défendable — c'est du code shadcn vendu, régénérable. Ignorer `n8n/**` l'est moins : `crm-celexia-events.code.js` porte l'injection HTML de A2-01, et aucun linter ne le regarde. L'absence de lint type-aware prive de règles précieuses comme `no-floating-promises`, qui aurait signalé les `void signOut()` de A4-02 et plusieurs `await` non gérés.

**Correctif** : activer le lint type-aware sur `src/`, et retirer `n8n/**` des exclusions.

```js
// eslint.config.js
tseslint.configs.recommendedTypeChecked,
{
  languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'warn',
  },
}
```

À faire après la CI (`05-build-tests-ci.md`), pour que le lot d'erreurs initial soit traité une fois et ne réapparaisse plus.

**Effort** : M.

---

### [FAIBLE] A4-12 — Code mort et drapeaux codés en dur

**Où** : `supabase/functions/upload-devis/index.ts` · `espace-artisan-page.tsx:49` · `0041_devis.sql:37` · `src/components/ui/command.tsx`

**Constat** :

- L'edge function `upload-devis` n'est appelée nulle part dans `src/` — code mort, mais déployé et exposé (voir A1-06).
- L'UUID `98a39398-2b7f-4a44-b9bc-aa6f893e9d32` sert de drapeau fonctionnel, **dupliqué** entre le front (`METBACH_ID`) et une migration SQL (`0041:37`). Activer la fonctionnalité pour un second artisan demanderait une migration **et** un déploiement front.
- `cmdk` n'est importé que par le composant shadcn `ui/command.tsx`, qu'aucune feature n'utilise : la palette de commandes n'existe pas.

**Impact** : faible individuellement. Le drapeau en dur est le plus gênant, parce qu'il rendra la généralisation du générateur de devis inutilement coûteuse.

**Correctif** : supprimer l'edge function et `ui/command.tsx` + `cmdk`. Remplacer le drapeau par une colonne `artisans.devis_actif boolean not null default false`, et filtrer dessus des deux côtés.

**Effort** : S.

---

## Dette technique : par où commencer

Ordonné par rapport impact/effort. Les quatre premiers points tiennent en une journée à deux et ferment les défauts les plus visibles côté utilisateur.

| # | Chantier | Pourquoi d'abord | Effort |
|---|---|---|---|
| 1 | **ErrorBoundary + `statutInfo()` + page 404** (A4-01, A4-05, A3-06) | Supprime le seul défaut critique du volet qualité : une page publique qui blanchit sur un acte contractuel. | S |
| 2 | **`queryClient.clear()` à la déconnexion** (A4-02) | Trois lignes, ferme une fuite de données clients entre sessions. | S |
| 3 | **Fabrique de clés react-query** (A4-03) | À poser avant tout nouveau code, sinon la dette continue de croître. Migration ensuite progressive. | M |
| 4 | **`EtatRequete` sur le tableau de bord et les commissions** (A4-04) | Empêche de confondre « échec de chargement » et « zéro euro » sur des vues financières. | M |
| 5 | **Génération des types Supabase + `createClient<Database>`** (A4-09) | Rend visibles les divergences entre `src/types/database.ts` et le schéma réel après 60 migrations. Prérequis utile aux refactors suivants. | M |

Le découpage des gros fichiers (A4-06) vient **après**, et de préférence à l'occasion d'une modification fonctionnelle de ces pages — un refactor de 987 lignes sans test de non-régression et sans CI est un risque net, pas un gain.

---

## Ce qui est bien fait

- **0 erreur TypeScript, 0 problème ESLint** sur 18 476 lignes, sans aucune CI pour l'imposer. C'est de la discipline, pas de la chance.
- **0 `any`, 0 `as any`, 0 `@ts-ignore`, 1 seul `eslint-disable`** dans tout le dépôt.
- **Le découpage par `features/`** est cohérent et tenu sur 14 modules. Les frontières `lib/` (technique), `components/` (partagé), `features/` (métier) sont respectées.
- **Les 12 fichiers de hooks suivent le même patron**, au point qu'un nouvel arrivant peut en écrire un correct après en avoir lu un seul.
- **`tsconfig.app.json` est bien configuré** : `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Au-delà des réglages par défaut de Vite.
- **Les squelettes de chargement sont présents dans 14 fichiers** — l'attention à l'état de chargement existe. Il ne manque que l'état d'erreur, son symétrique.
- **Le nommage est en français, cohérent et lisible** (`useProjets`, `affectations`, `montants-card`), aligné sur le vocabulaire métier. Sur un produit à deux, c'est un vrai facilitateur.
- **Les commentaires expliquent les décisions, pas le code.** Plusieurs migrations documentent explicitement les corrections de bugs (`0058:55`), et `0025:180` justifie l'exclusion volontaire du téléphone client. Cette trace a directement servi cet audit.
