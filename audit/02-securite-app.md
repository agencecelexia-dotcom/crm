# A2 — Sécurité applicative, dépendances & RGPD

> Audit du 2026-08-03 · périmètre : front, intégration n8n, dépendances, en-têtes HTTP, conformité.
> Mesures de dépendances réelles (`npm audit --omit=dev` après `npm install`), reproduites verbatim.
> **Avertissement** : la partie B décrit des risques de conformité. Ce n'est pas un avis juridique — les points sensibles (valeur probante des signatures, registre des traitements) doivent être validés par un conseil.

## Résumé

| Sévérité | Nombre |
|---|---|
| CRITIQUE | 2 |
| ÉLEVÉ | 6 |
| MOYEN | 7 |
| FAIBLE | 2 |

Les trois plus graves :

1. **Le webhook n8n est un relais de messagerie ouvert.** N'importe qui peut faire envoyer, depuis `agence.celexia@gmail.com`, un email au destinataire de son choix, avec un contenu HTML et une pièce jointe PDF arbitraires.
2. **jspdf est en version critique** (10 advisories, dont exécution de JavaScript arbitraire via AcroForm), et il génère des PDF à partir de contenu saisi par les artisans.
3. **Aucun en-tête de sécurité** : les pages de signature de contrat sont encapsulables dans une iframe tierce, et le token d'accès fuit vers Google Fonts et Fontshare via l'en-tête `Referer`.

Points solides : aucune clé de service n'a jamais été commitée · aucun `dangerouslySetInnerHTML` ni `innerHTML` dans tout `src/` · aucun `eval` · le géocodage respecte la politique d'usage de Nominatim.

---

# A. Sécurité applicative & dépendances

### [CRITIQUE] A2-01 — Le webhook n8n est un relais d'envoi d'emails ouvert

**Où** : `n8n/crm-celexia-events.code.js:10-20,54` · `n8n/README.md:6` · `src/lib/constants.ts:219`

**Constat** : trois faits se combinent.

D'abord, l'URL du webhook est **publique et présente dans le bundle JavaScript** livré à tout visiteur (`src/lib/constants.ts:219`) : `https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events`. Elle est aussi codée en dur dans 14 migrations SQL. Ensuite, `n8n/README.md:6` confirme que le webhook n'exige aucune authentification. Enfin, le nœud Code traite l'événement `envoyer_devis_pdf` ainsi :

```js
if (d.event === 'envoyer_devis_pdf') {
  if (!d.email || !d.pdf_base64) return [];
  return [{
    json: {
      to: d.email,                       // ← destinataire fourni par l'appelant
      subject: d.subject || (…),         // ← sujet fourni par l'appelant
      html: d.html || (…),               // ← corps HTML fourni par l'appelant, JAMAIS échappé
      has_pdf: true,
    },
    binary: { devis: { data: d.pdf_base64, … } },  // ← pièce jointe fournie par l'appelant
  }];
}
```

La fonction `esc()` définie plus bas (`:28-29`) échappe bien `&`, `<` et `>` — mais elle **n'est appliquée ni à `d.html`, ni à `d.subject`, ni au `href` du bouton** (`:54`, `<a href="${href}">`). Les quatre paramètres qui déterminent un email sortant sont donc entièrement contrôlés par l'appelant, sans authentification.

**Impact** : le système constitue un relais de messagerie ouvert, opéré depuis l'adresse Gmail de l'agence. Conséquences concrètes : campagnes de phishing usurpant l'identité de Celexia auprès de ses propres clients et artisans ; distribution de pièces jointes malveillantes sous couvert d'un devis ; épuisement du quota d'envoi Gmail (500 messages/jour sur un compte standard), ce qui **couperait toutes les notifications légitimes du CRM** ; et à terme mise en liste noire du domaine expéditeur, avec un impact commercial durable.

**Exploitation** — l'URL étant lisible dans le bundle, une seule requête suffit :

```bash
curl -s -X POST https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events \
  -H 'Content-Type: application/json' \
  -d '{
        "event": "envoyer_devis_pdf",
        "email": "cible@exemple.fr",
        "subject": "Celexia — régularisation de votre dossier",
        "html": "<p>Merci de régler votre commission ici : <a href=\"https://site-attaquant\">payer</a></p>",
        "pdf_base64": "JVBERi0xLjQK…"
      }'
```

**Correctif** — trois mesures, à appliquer ensemble.

1. **Authentifier le webhook.** Dans n8n, activer *Header Auth* sur le nœud Webhook et exiger un en-tête partagé. Côté SQL, passer par la fonction `notifier_n8n` centralisée proposée en A1-13 (`01-securite-base.md`).

2. **Ne plus appeler le webhook depuis le front.** Les quatre appels (`use-devis.ts:127`, `mission-link-card.tsx:38`, `inscription-artisan-page.tsx:47`, `contrat-card.tsx:65`) exposent nécessairement l'URL. Les remplacer par des RPC Supabase qui déclenchent l'envoi côté serveur. C'est aussi ce qui permettra de supprimer le `mode: 'no-cors'` — voir A2-08.

3. **Verrouiller le nœud Code** : n'accepter que des destinataires connus de la base, et échapper systématiquement.

```js
// Refuser tout envoi non authentifié
if ($input.first().json.headers['x-webhook-secret'] !== $env.CRM_WEBHOOK_SECRET) return [];

if (d.event === 'envoyer_devis_pdf') {
  if (!d.email || !d.pdf_base64) return [];
  if (d.pdf_base64.length > 8_000_000) return [];        // plafond ~6 Mo de PDF
  return [{
    json: {
      to: d.email,
      subject: esc(d.subject || ('Votre devis ' + (d.numero || ''))),
      html: frame('<p>Bonjour,<br><br>Votre devis est en pièce jointe.<br><br>Celexia</p>'),
      has_pdf: true,
    },
    binary: { devis: { data: d.pdf_base64, mimeType: 'application/pdf', fileName: 'devis.pdf' } },
  }];
}
```

Le corps HTML ne devrait pas être un paramètre d'entrée : le gabarit `frame()` existe déjà dans le fichier et suffit.

**Effort** : M.

---

### [CRITIQUE] A2-02 — jspdf en version critique, alimenté par des données d'artisans

**Où** : `package.json` (`jspdf ^3.0.4`) · `src/features/devis/devis-pdf.ts:58` · `src/features/contrats/contrat-pdf.ts:14`

**Constat** — sortie réelle de `npm audit --omit=dev` :

```
jspdf  <=4.2.0
Severity: critical
  GHSA-f8cm-6447-x5h2  Local File Inclusion / Path Traversal
  GHSA-pqxr-3g65-p328  PDF Injection dans AcroFormChoiceField → exécution JS arbitraire
  GHSA-p5xg-68wr-hm3m  PDF Injection dans AcroForm (RadioButton.createOption, propriété "AS")
  GHSA-9vjf-qc39-jprp  PDF Object Injection via addJS
  GHSA-cjw8-79x6-5cj4  Race condition dans le plugin addJS
  GHSA-95fx-jjr5-f39c  DoS via dimensions BMP non validées
  GHSA-67pg-wm7f-q7fj  DoS via dimensions GIF malveillantes
  GHSA-vm32-vv63-w422  Injection de métadonnées XMP
  GHSA-wfv2-pwc8-crg5  HTML Injection dans les chemins « New Window »
  GHSA-7x6v-j9x4-qf24  PDF Object Injection via FreeText color
fix available via `npm audit fix --force` → jspdf@4.2.1 (breaking)
```

**Exposition réelle du projet** — j'ai vérifié le chemin d'appel plutôt que de recopier l'avis :

- Le générateur de devis (`devis-builder.tsx`) est alimenté par des **saisies libres de l'artisan** : désignations de lignes, descriptions, coordonnées client. Ce contenu part dans `devis-pdf.ts`. Les advisories d'injection d'objets PDF (`GHSA-9vjf-qc39-jprp`, `GHSA-7x6v-j9x4-qf24`) sont donc **atteignables**, puisqu'elles reposent sur du texte non assaini inséré dans la structure du document.
- Les advisories **AcroForm** (`GHSA-pqxr-3g65-p328`, `GHSA-p5xg-68wr-hm3m`) supposent l'usage du module de formulaires. Je n'ai trouvé aucun appel AcroForm dans `devis-pdf.ts` ni `contrat-pdf.ts` — **cette classe précise n'est donc pas exploitable en l'état**, mais elle le deviendrait si des champs de formulaire étaient ajoutés au PDF.
- Les DoS BMP/GIF supposent une image fournie par l'attaquant. Les PDF n'incorporent que le logo et les signatures (dataURL PNG issus du `signature-pad`). Risque faible.
- Le path traversal (`GHSA-f8cm-6447-x5h2`) concerne des usages serveur. jspdf tourne ici dans le navigateur : **non exploitable**.

Conclusion honnête : la gravité « critique » du score global surestime le risque réel de *ce* projet, mais l'injection d'objets PDF via les saisies d'artisan est bien atteignable, et le PDF produit est ensuite envoyé au client final comme document contractuel.

**Correctif** :

```bash
npm i jspdf@^4.2.1
```

Version majeure : vérifier ensuite le rendu des deux générateurs (`devis-pdf.ts`, `contrat-pdf.ts`). Le correctif traite aussi `dompurify`, qui n'est présent que comme dépendance transitive de jspdf.

**Effort** : M — la mise à jour est triviale, la revérification du rendu des PDF ne l'est pas.

---

### [ÉLEVÉ] A2-03 — Aucun en-tête de sécurité : les pages de signature sont encapsulables

**Où** : `vercel.json` (4 lignes, uniquement une rewrite SPA) · `index.html`

**Constat** : aucun en-tête de sécurité n'est défini nulle part. Ni CSP, ni `X-Frame-Options`, ni `Strict-Transport-Security`, ni `X-Content-Type-Options`, ni `Referrer-Policy`, ni `Permissions-Policy`. `vercel.json` ne contient pas de clé `headers`, et `index.html` ne porte aucune balise `http-equiv`.

**Impact** — deux conséquences concrètes, pas théoriques.

**Clickjacking sur la signature de contrat.** En l'absence de `X-Frame-Options` ou de `frame-ancestors`, un attaquant peut charger `/signer/:token` dans une iframe transparente superposée à une page anodine, et faire signer le contrat d'engagement à un artisan qui croit cliquer ailleurs. La signature étant déjà dépourvue de vérification d'identité (A1-05), le résultat est un contrat signé, opposable en apparence.

**Fuite du token vers des tiers via `Referer`.** Le token d'accès est dans le chemin de l'URL. `index.html:22-29` charge des feuilles de style depuis `fonts.googleapis.com` et `api.fontshare.com`. En l'absence de `Referrer-Policy`, le navigateur transmet l'URL complète de la page courante dans l'en-tête `Referer` de ces requêtes. **Les tokens `/signer/:token`, `/mission/:token` et `/artisan/:token` sont donc communiqués à Google et à Fontshare**, et journalisés chez eux. C'est le vecteur de fuite le plus direct du système de tokens décrit en A1-03.

**Correctif** — `vercel.json` :

```json
{
  "rewrites": [
    { "source": "/((?!assets/|.*\\.[a-zA-Z0-9]+$).*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "no-referrer" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "Permissions-Policy", "value": "geolocation=(), microphone=(), camera=(), payment=()" },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; font-src 'self' https://fonts.gstatic.com https://cdn.fontshare.com data:; img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org https://recherche-entreprises.api.gouv.fr https://n8n.srv1241880.hstgr.cloud; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
        }
      ]
    }
  ]
}
```

`Referrer-Policy: no-referrer` est le point le plus important : il ferme la fuite de token. `style-src` conserve `'unsafe-inline'`, requis par Tailwind et les styles en ligne des composants ; le durcir supposerait un travail de nonces disproportionné ici.

**Vérification après déploiement** : `curl -sI https://crm-ci7k.vercel.app/ | grep -iE 'x-frame|content-security|referrer|strict-transport'`. Puis contrôler que la carte Leaflet, le géocodage et l'appel SIREN fonctionnent toujours — la CSP `connect-src` doit couvrir chaque domaine appelé.

**Effort** : S pour la pose, M avec la vérification de non-régression de la CSP.

---

### [ÉLEVÉ] A2-04 — Les messages d'erreur PostgreSQL bruts sont affichés aux artisans

**Où** : ~29 occurrences du motif, dont `src/features/contrats/upload-devis.tsx:52`, `espace-artisan-page.tsx`, `mission-page.tsx`, `inscription-artisan-page.tsx`

**Constat** : le patron copié dans tout le projet est

```ts
onError: (e) => toast.error('Échec', { description: e instanceof Error ? e.message : undefined })
```

Sur les pages authentifiées, c'est acceptable. Sur les **quatre pages publiques**, le message affiché est celui renvoyé par PostgREST ou PostgreSQL.

**Impact** : divulgation de la structure interne à un public non authentifié — noms de tables et de colonnes, contraintes violées, parfois des fragments de requête. C'est le préalable classique à une attaque plus ciblée : l'erreur indique quelles fonctions existent et ce qu'elles attendent. Effet secondaire : l'artisan reçoit un message incompréhensible au lieu d'une consigne utile.

**Correctif** : distinguer les deux publics. Créer un utilitaire unique :

```ts
// src/lib/erreurs.ts
const MESSAGES_PUBLICS: Record<string, string> = {
  '23505': 'Cet élément existe déjà.',
  '23514': 'Une des valeurs saisies n’est pas valide.',
  'PGRST116': 'Élément introuvable.',
}

/** Message affichable à un utilisateur non authentifié : jamais de détail technique. */
export function messagePublic(e: unknown): string {
  const code = (e as { code?: string } | null)?.code
  return (code && MESSAGES_PUBLICS[code]) || 'Une erreur est survenue. Réessayez ou contactez Celexia.'
}
```

puis l'utiliser dans tous les `onError` des pages publiques. Conserver `e.message` uniquement derrière `ProtectedRoute`.

**Effort** : M — mécanique, mais réparti sur une trentaine de points d'appel.

---

### [ÉLEVÉ] A2-05 — react-router expose un open redirect

**Où** : `package.json` (`react-router-dom ^7.13.0`) · `src/features/contrats/mission-page.tsx:96-98`

**Constat** — sortie réelle de `npm audit` :

```
react-router  6.0.0 - 8.2.0   Severity: high
  GHSA-wrjc-x8rr-h8h6  Open redirect via backslash dans <Link> et useNavigate (contournement de CVE-2025-68470)
  GHSA-chx6-hx7r-mcp5  DoS non authentifié via route matching inefficace
  GHSA-h8fp-f39c-q6mh  RSCErrorHandler : validation de protocole manquante (XSS)
  GHSA-337j-9hxr-rhxg  Injection de constructeur via deserializeErrors() (hydratation SSR)
  GHSA-qwww-vcr4-c8h2  Contournement CSRF en mode RSC
fix available via `npm audit fix`  (non breaking)
```

**Exposition réelle** : trois des cinq advisories (`RSCErrorHandler`, `deserializeErrors`, `mode RSC`) concernent le rendu serveur et les React Server Components. **Ce projet est une SPA purement cliente, sans SSR ni RSC — elles ne s'appliquent pas.**

Restent deux advisories pertinentes. Le **DoS par route matching** (`GHSA-chx6-hx7r-mcp5`) est atteignable puisque les routes sont publiques, mais l'impact se limite au navigateur de la victime.

L'**open redirect** (`GHSA-wrjc-x8rr-h8h6`) mérite l'examen. J'ai cherché les navigations construites depuis une entrée non maîtrisée. Le seul candidat est :

```tsx
// mission-page.tsx:96-98 — redirection des anciens liens de mission vers l'espace artisan
navigate(`/artisan/${data.artisan_token}`, { replace: true })
```

La valeur provient de la réponse de la RPC `get_mission_by_token`, donc de la base — pas directement de l'URL. Un attaquant devrait d'abord écrire un `artisans.token` malveillant, ce que rien ne permet aujourd'hui (`inscrire_artisan` ne fixe pas le token, il est généré par le `default`). **L'open redirect n'est donc pas exploitable en l'état**, mais il le deviendrait si une valeur d'URL était un jour passée à `navigate()`.

Correctif quoi qu'il en soit : `npm audit fix` corrige react-router sans rupture. La mise à jour ne coûte rien et referme la question.

**Correctif** :

```bash
npm audit fix   # met à jour react-router et dompurify, sans breaking change
```

**Effort** : S.

---

### [ÉLEVÉ] A2-06 — L'échec silencieux des appels `no-cors` masque les pannes de notification

**Où** : `src/lib/constants.ts:219` · `src/features/devis/use-devis.ts:127` · `src/features/projets/components/mission-link-card.tsx:38` · `src/features/artisans/pages/inscription-artisan-page.tsx:47` · `src/features/contrats/contrat-card.tsx:65`

**Constat** : les quatre appels front vers n8n utilisent `mode: 'no-cors'`, avec la réponse ignorée. Le commentaire du code l'assume : *« no-cors : pas de réponse attendue »*. En mode `no-cors`, le navigateur renvoie une réponse opaque : **le code applicatif ne peut pas distinguer un succès d'un échec**, y compris d'une erreur 500 ou d'une indisponibilité totale du serveur n8n.

**Impact** : ces appels déclenchent l'envoi du lien de mission à l'artisan, l'email de bienvenue à l'inscription et l'envoi du devis au client final. Si n8n tombe, si l'URL change, ou si le quota Gmail est épuisé (voir A2-01), **rien ne le signale** : ni l'utilisateur, ni les journaux. Les artisans ne reçoivent plus leurs liens, et l'agence croit que tout fonctionne. C'est une panne silencieuse sur un chemin critique du métier.

**Correctif** : déplacer ces envois côté serveur, ce qui résout simultanément A2-01 (exposition de l'URL) et le présent point. Une RPC Supabase appelle `notifier_n8n` (A1-13) et peut, elle, retourner un statut exploitable.

```ts
const { data, error } = await supabase.rpc('envoyer_lien_mission', { p_affectation_id: id })
if (error || !(data as { ok?: boolean })?.ok) {
  toast.error("Le lien n'a pas pu être envoyé", { description: 'Réessayez ou envoyez-le manuellement.' })
}
```

En complément, journaliser les envois dans une table `envois(type, cible, statut, created_at)` pour disposer d'une trace consultable.

**Effort** : M.

---

### [MOYEN] A2-07 — Le client Supabase démarre silencieusement sur une configuration factice

**Où** : `src/lib/supabase/client.ts:6-16`

**Constat** : en l'absence de variables d'environnement, le client est construit avec `https://placeholder.supabase.co` et `'placeholder-key'`, et un drapeau `supabaseMisconfigured` est exporté. Ce drapeau n'est consommé qu'à un seul endroit : `login-page.tsx:22`. La ligne 16 réexporte par ailleurs `supabaseAnonKey`, avec un commentaire indiquant que c'est destiné à « contourner la vérification JWT » des edge functions.

**Impact** : un déploiement dont les variables d'environnement sont mal renseignées ne échoue pas — il démarre et se comporte de manière incohérente selon les écrans. Les **pages publiques**, qui ne consultent pas le drapeau, tentent leurs appels RPC contre un domaine inexistant et affichent des erreurs réseau brutes à l'artisan. Le mode dégradé est plus coûteux à diagnostiquer qu'un échec net au démarrage.

**Correctif** : échouer immédiatement et visiblement.

```ts
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  throw new Error(
    'Configuration Supabase manquante : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont requis.',
  )
}
export const supabase = createClient(url, key)
```

Le `throw` au chargement du module produit un message explicite, en développement comme au build. Retirer par la même occasion la réexportation de `supabaseAnonKey`, devenue inutile si l'edge function est supprimée (A1-06).

**Effort** : S.

---

### [MOYEN] A2-08 — Le SIREN et les données d'entreprise ne sont pas validés à l'entrée

**Où** : `src/features/artisans/components/artisan-form.tsx:36-76` · `0053_zones_multiples.sql:119-152` · `src/lib/entreprise.ts`

**Constat** : le formulaire artisan dispose de deux schémas zod, `schema` (seul `nom` requis) et `strictSchema` (`:67-76`), ce dernier appliqué à la page publique `/rejoindre`. C'est une bonne pratique, correctement mise en œuvre côté client. Mais la RPC `inscrire_artisan` n'applique **aucune** de ces règles : SIREN, capital social, forme juridique, booléens d'assurance sont insérés bruts.

**Impact** : les données d'entreprise alimentent le **contrat d'engagement** généré par `ensure_engagement_contrat` — SIREN, forme juridique, représentant légal y figurent en toutes lettres. Un SIREN erroné ou fantaisiste produit un contrat identifiant incorrectement le cocontractant, ce qui affaiblit sa portée. Le contrôle existe côté client mais est contournable par appel direct de la RPC.

**Correctif** : dupliquer les règles essentielles en base, au moins pour ce qui figure au contrat.

```sql
-- SIREN : 9 chiffres, avec validation de la clé de Luhn
create or replace function public.siren_valide(p_siren text) returns boolean
language plpgsql immutable as $$
declare s int := 0; d int; i int;
begin
  if p_siren is null or p_siren !~ '^\d{9}$' then return false; end if;
  for i in 1..9 loop
    d := substr(p_siren, 10 - i, 1)::int;
    if i % 2 = 0 then d := d * 2; if d > 9 then d := d - 9; end if; end if;
    s := s + d;
  end loop;
  return s % 10 = 0;
end; $$;

alter table public.artisans add constraint artisans_siren_valide
  check (siren is null or public.siren_valide(siren));
```

**Effort** : M.

---

### [MOYEN] A2-09 — Le déploiement n8n écrit en production sans filet

**Où** : `scripts/deploy-n8n.py:12-41` · `n8n/README.md:4`

**Constat** : le script lit la clé API n8n depuis l'environnement, récupère le workflow `PkhPQia4Ci2wwsCn`, **repère le nœud Code par correspondance de chaîne** sur `'envoyer_lien_mission'` dans le champ `jsCode` (`:34-35`), en écrase le contenu et republie l'ensemble du workflow par un `PUT` (`:39-41`). Aucun mode simulation, aucune sauvegarde préalable, aucune confirmation. En cas d'erreur, le corps HTTP brut est déversé sur la sortie d'erreur (`:30`), ce qui peut exposer des éléments de réponse de l'API. `n8n/README.md:4` précise que l'instance est **partagée**.

**Impact** : une exécution malencontreuse écrase le workflow de production, et donc toutes les notifications du CRM. La détection par chaîne de caractères est fragile : si le contenu du nœud évolue, le script peut écrire dans le mauvais nœud ou échouer après avoir déjà modifié le workflow.

**Correctif** : sauvegarder avant d'écrire et exiger une confirmation explicite.

```python
# Sauvegarde horodatée AVANT toute écriture
import json, datetime, pathlib
sauvegarde = pathlib.Path(f"n8n/backup-{datetime.datetime.now():%Y%m%d-%H%M%S}.json")
sauvegarde.write_text(json.dumps(wf, indent=2, ensure_ascii=False))
print(f"Sauvegarde : {sauvegarde}")

if "--apply" not in sys.argv:
    print("Simulation. Relancer avec --apply pour écrire réellement.")
    sys.exit(0)
```

Cibler le nœud par son `id` plutôt que par le contenu de son code.

**Effort** : S.

---

### [MOYEN] A2-10 — Le générateur de zones réécrit une migration déjà appliquée

**Où** : `scripts/generer-zones.mjs:17,46`

**Constat** : le script interroge `geo.api.gouv.fr` et **écrase `supabase/migrations/0047_zones_seed.sql`**. Modifier le contenu d'une migration déjà exécutée en production est un anti-patron : le fichier ne décrit plus ce qui a réellement été appliqué, et tout outil qui suit les migrations par empreinte détectera une divergence. L'échappement se limite aux apostrophes (`:17`), sur des données provenant d'une API externe.

**Impact** : perte de traçabilité du schéma. Un nouvel environnement construit depuis les migrations ne reproduira pas l'état de la production. Le risque est faible aujourd'hui parce que l'`INSERT` est idempotent (`on conflict do update`), mais le principe est cassé.

**Correctif** : générer une **nouvelle** migration horodatée plutôt que d'écraser l'ancienne, ou sortir ces données du dossier `migrations/` vers un `supabase/seed/` appliqué séparément.

**Effort** : S.

---

### [FAIBLE] A2-11 — Le fichier d'état local de la CLI Supabase est versionné

**Où** : `supabase/.temp/linked-project.json` · `.gitignore`

Traité en A1-15 (`01-securite-base.md`). Rappel du correctif : ajouter `supabase/.temp/` à `.gitignore` et `git rm -r --cached supabase/.temp`.

**Effort** : S.

---

### [FAIBLE] A2-12 — 6,3 Mo de captures d'écran non référencées à la racine du dépôt

**Où** : racine du dépôt

**Constat** : quatre fichiers `Capture d'écran 2026-06-*.png` (3,6 Mo + 1,6 Mo + 600 Ko + 548 Ko) sont suivis par git, ne sont référencés par aucun code ni document, et représentent l'essentiel des 8 Mo du `.git`. Leurs noms contiennent des espaces, des accents et une apostrophe typographique.

**Impact** : clonages et opérations git alourdis. Aucun risque de sécurité. À vérifier tout de même : ces captures peuvent contenir des données de clients réels, auquel cas elles relèvent aussi du volet RGPD.

**Correctif** : `git rm` les fichiers et ajouter `*.png` à la racine dans `.gitignore` (en conservant `public/`). Les retirer de l'historique n'a d'intérêt que s'ils contiennent des données personnelles — dans ce cas, `git filter-repo` et réécriture de l'historique.

**Effort** : S.

---

# B. RGPD & conformité

> Ces points décrivent des risques de conformité et ne constituent pas un avis juridique.

## Cartographie des données personnelles traitées

| Personne concernée | Données | Où | Base légale probable |
|---|---|---|---|
| **Client final** | nom, téléphone, email, adresse postale complète, code postal, ville, coordonnées GPS, description du chantier, budget, **photos de l'intérieur du logement** | `projets`, bucket `projet-photos` | Intérêt légitime / exécution de mesures précontractuelles |
| **Artisan** | nom, prénom, société, SIREN, forme juridique, capital, représentant légal, téléphone, email, adresse, **signature manuscrite numérisée** | `artisans`, `contrats` | Exécution du contrat |
| **Prospect** | données d'entreprise issues de l'API publique SIRENE | `prospects` | Intérêt légitime (prospection B2B) |

La **signature manuscrite** est une donnée biométrique au sens large et un élément d'identification fort. Elle est stockée en dataURL dans `contrats.signature_data` et **renvoyée en clair** par `get_contrat_by_token`, `get_mission_by_token` et `get_espace_artisan` à quiconque détient le token concerné.

---

### [ÉLEVÉ] A2-13 — Aucune durée de conservation, et une purge historique irréversible

**Où** : `0014_purge_perdus.sql:45-51` · `0057_fix_devis_perdu_appels.sql:16` · `0033_corbeille.sql`

**Constat** : le RGPD impose une durée de conservation définie et proportionnée (article 5.1.e). Le système présente les deux écarts opposés, simultanément.

D'un côté, **conservation illimitée** : à l'exception de la corbeille (soft delete via `deleted_at`), aucune donnée n'est jamais purgée. Les projets perdus, les artisans écartés, les prospects non convertis, les suivis et les contrats non signés s'accumulent indéfiniment.

De l'autre, une **purge historique trop agressive** : `0014` a planifié une suppression **définitive** des projets perdus après 48 heures, avec cascade sur les affectations. Le job a été désactivé en `0057:16`, mais les données supprimées pendant sa période d'activité sont irrécupérables.

**Risque** : manquement au principe de limitation de la conservation, susceptible de fonder une réclamation ou un constat en cas de contrôle. La purge à 48 h pose le problème inverse : impossibilité de justifier d'un traitement passé en cas de litige commercial.

**Correctif** : définir et documenter une politique, puis l'implémenter en anonymisation plutôt qu'en suppression, afin de préserver les statistiques.

```sql
-- Anonymisation des projets sans suite au-delà de 3 ans
create or replace function public.anonymiser_projets_anciens()
returns void language sql security definer set search_path = public as $$
  update public.projets
     set client_nom = 'Anonymisé', client_telephone = null, client_email = null,
         client_adresse = null, description = null, photos = '{}'
   where statut = 'perdu'
     and coalesce(perdu_at, created_at) < now() - interval '3 years'
     and client_nom <> 'Anonymisé';
$$;
revoke execute on function public.anonymiser_projets_anciens() from public;
select cron.schedule('anonymisation', '0 3 1 * *', $$select public.anonymiser_projets_anciens()$$);
```

Durées à arrêter avec un conseil ; les ordres de grandeur usuels sont 3 ans après le dernier contact pour la prospection, et la durée de prescription commerciale (5 ans) pour les pièces contractuelles.

**Effort** : M.

---

### [ÉLEVÉ] A2-14 — La signature électronique n'est pas assortie d'éléments de preuve

**Où** : `0006_contrats.sql:61-88` · `src/features/contrats/signer-page.tsx:57` · `src/components/signature-pad.tsx`

**Constat** : le processus consiste à ouvrir un lien contenant un token, tracer une signature au doigt et saisir un nom libre. `signer_contrat` enregistre `signataire_nom`, `signature_data` et `signed_at`. **Aucun élément de preuve n'est conservé** : ni adresse IP, ni agent utilisateur, ni horodatage qualifié, ni vérification d'identité, ni second facteur, ni scellement du document signé.

Au sens du règlement eIDAS, il s'agit d'une **signature électronique simple**. Elle n'est pas dépourvue de valeur — l'article 25.1 interdit de refuser un effet juridique à une signature au seul motif qu'elle est électronique — mais en cas de contestation, **la charge de la preuve pèse sur celui qui s'en prévaut**, c'est-à-dire sur Celexia.

**Risque** : un artisan contestant devoir la commission peut nier avoir signé. En l'état, les éléments produisibles se limitent à une image et un horodatage serveur, sans lien technique avec sa personne. Le token étant par ailleurs transmissible et jamais expiré (A1-03), et signable par quiconque le détient (A1-05), la contestation serait solide. L'enjeu financier est direct : le contrat est le fondement de la commission.

**Correctif** — par ordre de rapport valeur/effort :

1. **Conserver les éléments de preuve** (effort S, gain immédiat) :

```sql
alter table public.contrats
  add column if not exists signature_ip inet,
  add column if not exists signature_user_agent text,
  add column if not exists contenu_hash text;   -- SHA-256 du texte signé, fige le document
```

Le `contenu_hash` est essentiel : sans lui, rien n'atteste que le texte signé est bien celui affiché ce jour-là, puisque `ensure_engagement_contrat` a été réécrite cinq fois.

2. **Second facteur** (effort M) : code à usage unique envoyé par SMS au numéro de l'artisan avant validation.

3. **Prestataire de signature qualifié** (effort L) : à envisager si le volume de contrats ou les montants le justifient.

Le point 1 doit être fait dans tous les cas. Le point 2 fait passer d'une signature « simple » à quelque chose de nettement plus défendable, pour un coût modeste.

**Effort** : S pour les preuves, M avec le second facteur.

---

### [MOYEN] A2-15 — Aucune information des personnes, aucun exercice des droits

**Où** : absence — recherche effectuée sur tout `src/`

**Constat** : aucune page de mentions légales, aucune politique de confidentialité, aucune information sur le traitement des données. La page publique `/rejoindre` collecte 28 champs de données d'entreprise et personnelles, **sans aucune mention** de l'identité du responsable de traitement, des finalités, de la durée de conservation ni des droits.

Aucun mécanisme d'exercice des droits n'existe : ni export des données d'une personne (article 15), ni effacement (article 17), ni rectification en libre-service. La corbeille (`0033`) est un outil d'exploitation interne, pas une réponse à une demande d'effacement.

**Risque** : le défaut d'information est le manquement le plus fréquemment relevé lors des contrôles, et le plus simple à constater — il suffit d'ouvrir la page. Le formulaire d'inscription artisan est visible publiquement.

**Correctif** :

1. Ajouter une route `/confidentialite` (page statique), liée depuis le pied de page de `/rejoindre` et depuis les pages publiques. Contenu : identité de Celexia (déjà présente dans le texte du contrat, `0055:29`), finalités, base légale, durées, destinataires (Supabase, n8n, Google, Vercel, OpenStreetMap), droits et modalités d'exercice.
2. Ajouter une case à cocher d'information — non pré-cochée — dans le tunnel d'inscription.
3. Implémenter deux RPC réservées aux associés, `exporter_donnees_personne(p_email)` et `effacer_donnees_personne(p_email)`, pour traiter une demande en quelques minutes plutôt qu'à la main.

**Effort** : M.

---

### [MOYEN] A2-16 — Aucune journalisation des accès aux données personnelles

**Où** : absence

**Constat** : aucune table d'audit. Rien n'enregistre qui a consulté ou modifié une fiche client, ni quand. Les RPC par token n'enregistrent pas non plus les consultations : `get_espace_artisan` renvoie les coordonnées complètes des clients sans laisser de trace.

**Risque** : en cas de violation de données (article 33 : notification à la CNIL sous 72 heures), il serait **impossible de déterminer l'étendue de la compromission** — quels clients ont été exposés, sur quelle période. Cela empêche à la fois la notification correcte et l'information des personnes concernées.

**Correctif** : une table d'audit minimale, alimentée aux points d'accès sensibles.

```sql
create table if not exists public.audit_acces (
  id bigserial primary key,
  quand timestamptz not null default now(),
  acteur text not null,          -- 'artisan:<uuid>' ou 'user:<uuid>'
  action text not null,          -- 'lecture_espace', 'lecture_mission', 'signature'
  cible_type text, cible_id uuid
);
alter table public.audit_acces enable row level security;
create policy "audit_lecture_auth" on public.audit_acces
  for select to authenticated using (true);
```

et un `insert` en tête de `get_espace_artisan`, `get_mission_by_token` et `signer_contrat`. Le coût est d'une écriture par consultation — négligeable au volume actuel.

**Effort** : M.

---

### [MOYEN] A2-17 — Les adresses des clients sont transmises à des services tiers

**Où** : `src/lib/geocoding.ts` (Nominatim / OpenStreetMap) · `src/lib/entreprise.ts` (API Recherche d'entreprises) · `n8n/crm-celexia-events.code.js` (Gmail)

**Constat** : chaque création de projet envoie **l'adresse postale du client** à Nominatim, service opéré par la fondation OpenStreetMap, pour obtenir des coordonnées. Le fichier respecte correctement la politique d'usage (une requête par seconde, cache local, contact identifiable en `:11`) — la qualité technique n'est pas en cause. Le point de conformité est que ce transfert vers un tiers n'est ni documenté ni mentionné aux personnes concernées.

Chaîne complète des sous-traitants : Supabase (hébergement — région à confirmer), Vercel (hébergement front), n8n auto-hébergé chez Hostinger, Google/Gmail (emails), OpenStreetMap (géocodage), API Recherche d'entreprises (données publiques, pas de donnée personnelle transmise).

**Risque** : absence de registre des traitements (article 30) et absence de contrats de sous-traitance (article 28). Sur la localisation : si le projet Supabase n'est pas hébergé dans l'Union européenne, tout transfert nécessiterait un encadrement supplémentaire. **À confirmer** dans le dashboard Supabase (Settings → General → Region).

**Correctif** : établir le registre des traitements (un tableau suffit pour une structure de cette taille), vérifier la région Supabase, signer les DPA proposés par Supabase, Vercel et Google, et mentionner le géocodage dans la politique de confidentialité (A2-15).

**Effort** : M — travail documentaire principalement.

---

## Ce qui est bien fait

- **Aucune clé de service n'a jamais été commitée.** Vérifié sur l'intégralité de l'historique git (`git log --all -S'eyJhbGciOi'`, `-S'SUPABASE_SERVICE_ROLE_KEY='`) : le seul résultat est le placeholder tronqué de `.env.example`. C'est loin d'être systématique dans les projets de cette taille.
- **Aucun `dangerouslySetInnerHTML`, aucun `innerHTML`, aucun `eval` dans tout `src/`.** La surface XSS côté React est essentiellement nulle — la seule injection HTML du système est dans le nœud n8n (A2-01), hors de React.
- **`.gitignore` couvre correctement les fichiers d'environnement**, y compris `.env.secrets` et `.env.secrets.local`.
- **Le géocodage respecte la politique d'usage de Nominatim** : file sérialisée à 1100 ms, cache `localStorage`, adresse de contact identifiable. C'est un usage respectueux d'un service gratuit, et c'est rarement fait.
- **Le formulaire public utilise un schéma zod strict** (`artisan-form.tsx:67-76`), plus exigeant que celui du CRM interne. La distinction est délibérée et bien vue — il ne manque que le pendant côté serveur.
- **`get_espace_artisan` masque les coordonnées du client tant que le contrat n'est pas signé** (`0060:55-59`) : une minimisation des données correctement implémentée, et pensée en amont.
- **Le texte du contrat identifie précisément le responsable** (dénomination, SASU, capital, RCS Créteil, TVA, siège, représentant) — la base d'une politique de confidentialité conforme est déjà rédigée.
