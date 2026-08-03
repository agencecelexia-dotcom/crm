# A1 — Sécurité base de données & accès public

> Audit du 2026-08-03 · périmètre : 60 migrations `supabase/migrations/`, edge function, `src/lib/storage.ts`.
> Tout ce qui suit est vérifié dans le code. Ce qui dépend de l'état réel de la prod est marqué **« à confirmer »** et couvert par `audit/verification-prod.sql`.

## Résumé

| Sévérité | Nombre |
|---|---|
| CRITIQUE | 4 |
| ÉLEVÉ | 5 |
| MOYEN | 4 |
| FAIBLE | 2 |

Les trois plus graves :

1. **Le bucket `devis` est public et ouvert en écriture et en suppression à `anon`** — n'importe qui sur Internet peut lister, écraser et supprimer l'intégralité des devis PDF, qui contiennent les coordonnées des clients.
2. **Huit fonctions `SECURITY DEFINER` n'ont jamais reçu de `GRANT`** — PostgreSQL accorde alors `EXECUTE` à `PUBLIC`, donc `anon` peut les appeler. L'une d'elles, `traiter_relances()`, déclenche des envois d'emails en masse.
3. **Les tokens d'accès sont des identifiants porteurs permanents**, sans expiration ni révocation, et un token en révèle d'autres — un lien transmis par WhatsApp reste valable à vie.

Points solides à conserver : les 14 tables ont bien la RLS activée · aucune page publique ne fait de `.from()` direct, tout passe par des RPC · le bucket `documents` est correctement privé avec URLs signées 1 h · les tokens utilisent `gen_random_uuid()` (entropie suffisante) · aucune clé n'a jamais été commitée.

---

## Modèle d'accès actuel, en une phrase

Deux populations accèdent à la base : les **2 associés** via Supabase Auth (une seule policy, `to authenticated using (true)`, sur les 14 tables), et les **artisans**, qui n'ont pas de compte et passent exclusivement par des **RPC `SECURITY DEFINER` autorisées au rôle `anon`**, gardées par un token dans l'URL. Toute la sécurité des artisans repose donc sur la qualité de ces 15 fonctions et sur la confidentialité des tokens.

---

### [CRITIQUE] A1-01 — Le bucket `devis` est public et modifiable par n'importe qui

**Où** : `supabase/migrations/0024_affectations.sql:52-67`, `src/lib/storage.ts:39-52`

**Constat** : le bucket est créé avec `public = true`, puis reçoit quatre policies dont le seul prédicat est l'appartenance au bucket :

```sql
create policy "devis_read"   on storage.objects for select using (bucket_id = 'devis');
create policy "devis_write"  on storage.objects for insert to anon, authenticated with check (bucket_id = 'devis');
create policy "devis_update" on storage.objects for update to anon, authenticated using  (bucket_id = 'devis');
create policy "devis_delete" on storage.objects for delete to anon, authenticated using  (bucket_id = 'devis');
```

Aucune restriction de chemin, de préfixe ni de propriétaire. `devis_read` n'a même pas de clause `to`, donc s'applique au rôle `PUBLIC`. Le commentaire de la migration justifie le choix par « lien imprévisible » — mais l'imprévisibilité de l'URL ne protège pas d'une **énumération via l'API de listing**, que la policy `select` autorise explicitement.

**Impact** : les devis contiennent nom, adresse, téléphone du client et montants. Trois conséquences distinctes : fuite massive de données personnelles ; destruction de pièces contractuelles (un `delete` sur tout le bucket) ; substitution d'un devis par un autre document, avec un impact contractuel direct puisque ces PDF servent de preuve du montant sur lequel la commission est calculée.

**Exploitation** : la clé `anon` est publique par construction (elle est dans le bundle JS). Avec elle :

```bash
# 1. Lister tous les devis
curl -s "$SUPABASE_URL/storage/v1/object/list/devis" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"prefix":"","limit":1000}'
# 2. Télécharger (bucket public, aucune auth requise)
curl -s "$SUPABASE_URL/storage/v1/object/public/devis/<chemin>" -o devis.pdf
# 3. Supprimer
curl -s -X DELETE "$SUPABASE_URL/storage/v1/object/devis/<chemin>" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
```

**Correctif** — passer le bucket en privé et restreindre `anon` à l'insertion sous le préfixe de son propre token d'affectation, en s'appuyant sur le fait que `src/lib/storage.ts:46` écrit déjà sous `${token}/…` :

```sql
update storage.buckets set public = false where id = 'devis';

drop policy if exists "devis_read"   on storage.objects;
drop policy if exists "devis_write"  on storage.objects;
drop policy if exists "devis_update" on storage.objects;
drop policy if exists "devis_delete" on storage.objects;

-- Lecture : réservée aux associés. Les artisans passent par une URL signée.
create policy "devis_read_auth" on storage.objects
  for select to authenticated using (bucket_id = 'devis');

-- Écriture anonyme : uniquement sous un préfixe correspondant à un token d'affectation VALIDE.
create policy "devis_write_token" on storage.objects
  for insert to anon with check (
    bucket_id = 'devis'
    and exists (select 1 from public.affectations a
                where a.token = split_part(name, '/', 1))
  );

-- Ni update ni delete pour anon : le dépôt est append-only.
create policy "devis_manage_auth" on storage.objects
  for all to authenticated using (bucket_id = 'devis') with check (bucket_id = 'devis');
```

Puis remplacer `getPublicUrl` par `createSignedUrl` dans `src/lib/storage.ts:51,66` (le helper existe déjà lignes 99-110 pour le bucket `documents` — le réutiliser).

**Effort** : M — la migration SQL est courte, mais il faut adapter `storage.ts` et vérifier les URLs déjà stockées dans `affectations.devis_url`, qui pointent vers l'ancien chemin public.

---

### [CRITIQUE] A1-02 — Huit fonctions `SECURITY DEFINER` sont exécutables par `anon` sans l'avoir voulu

**Où** : `0029_automatisations.sql:50` (`traiter_relances`), `0045_rappels.sql` (`traiter_rappels`), `0039_taches.sql:30` (`rafraichir_taches`), `0015_app_settings.sql` (`cfg`), `0034_stats_artisans.sql:7` (`stats_artisans`), `0035_action_du_jour.sql` (`action_du_jour`), `0036_estimation_auto.sql:5` (`estimer_projet`), `0058_perdu_remonte_reassignation.sql:6` (`add_suivi_by_token` 4-args)

**Constat** : en PostgreSQL, `CREATE FUNCTION` accorde `EXECUTE` à `PUBLIC` par défaut. Aucune de ces huit fonctions ne reçoit de `GRANT` explicite, et **aucun `REVOKE` n'existe nulle part dans les 60 migrations** (0 occurrence). Combinées à `SECURITY DEFINER`, elles s'exécutent avec les droits du propriétaire, en contournant la RLS.

Le cas de `add_suivi_by_token` est le plus révélateur d'un accident : `0032_relance_post_rdv.sql:14` fait `drop function public.add_suivi_by_token(text,text,text)` puis crée la variante 4-args — **sans réémettre le `grant`**. La fonction reste appelable, mais par `PUBLIC` au lieu de `anon, authenticated`. Personne ne s'en est aperçu parce que le résultat fonctionnel est identique.

**Impact**, par fonction :

| Fonction | Ce qu'un appel anonyme provoque |
|---|---|
| `traiter_relances()` | Parcourt les affectations en retard et **émet des `net.http_post` vers n8n**, qui envoie des emails. Appelée en boucle, elle transforme le CRM en générateur de spam depuis l'adresse de l'agence. |
| `traiter_rappels()` | Idem, sur les rappels datés. |
| `rafraichir_taches()` | **Écrit** dans `taches` : régénère les tâches automatiques. Appels concurrents = duplication ou perte de tâches. |
| `stats_artisans()`, `action_du_jour()` | **Fuite de données** : statistiques agrégées et pilotage commercial de l'agence, lisibles par n'importe qui. |
| `cfg()` | Lit `app_settings`, qui contient notamment la signature de l'apporteur. |
| `estimer_projet()` | Lecture seule, impact faible (divulgue la grille d'estimation). |
| `add_suivi_by_token` 4-args | Devait être exposée à `anon` — l'exposition est ici *conforme au besoin*, mais **non intentionnelle**, ce qui est le vrai problème. |

**Exploitation** : `curl -s "$SUPABASE_URL/rest/v1/rpc/traiter_relances" -X POST -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"` — en boucle.

**Correctif** — poser une politique par défaut restrictive, puis ré-autoriser explicitement :

```sql
-- 1. Fermer le robinet par défaut pour toute nouvelle fonction
alter default privileges in schema public revoke execute on functions from public;

-- 2. Fermer les fonctions internes existantes
revoke execute on function public.traiter_relances()   from public;
revoke execute on function public.traiter_rappels()    from public;
revoke execute on function public.rafraichir_taches()  from public;
revoke execute on function public.cfg(text)            from public;
revoke execute on function public.estimer_projet(text, text[], text) from public;

-- 3. Réserver aux associés ce qui les concerne
revoke execute on function public.stats_artisans()  from public;
revoke execute on function public.action_du_jour()  from public;
grant  execute on function public.stats_artisans()  to authenticated;
grant  execute on function public.action_du_jour()  to authenticated;

-- 4. Rendre explicite l'exposition voulue
revoke execute on function public.add_suivi_by_token(text,text,text,timestamptz) from public;
grant  execute on function public.add_suivi_by_token(text,text,text,timestamptz) to anon, authenticated;
```

Les fonctions appelées par pg_cron s'exécutent avec le rôle du job, pas via PostgREST : le `revoke ... from public` ne casse pas les tâches planifiées.

**Effort** : S — une seule migration, aucun changement applicatif.

**À confirmer en prod** : `audit/verification-prod.sql` section `fonctions` renvoie l'ACL réelle. Une valeur `acl` à `NULL` confirme le diagnostic.

---

### [CRITIQUE] A1-03 — Les tokens sont des identifiants porteurs permanents, non révocables, et se propagent

**Où** : `0006_contrats.sql:12`, `0007_mission_espace_artisan.sql:10`, `0019_espace_artisan.sql:8`, `0024_affectations.sql:11`, `0060_espace_artisan_commission.sql:46`, `0053_zones_multiples.sql:154-155`

**Constat** : les quatre tokens sont générés par `replace(gen_random_uuid()::text, '-', '')` — 122 bits d'entropie, **l'entropie n'est pas le problème**. Le problème est le cycle de vie :

- Aucune colonne `expires_at`, `revoked_at` ou `token_version` sur `contrats`, `projets`, `artisans` ou `affectations`.
- Aucune fonction de rotation. Le seul `update ... set token` du dépôt est le backfill unique de `0019_espace_artisan.sql:13`.
- **Un token en révèle d'autres** : `get_espace_artisan` renvoie le `af.token` de chaque chantier (`0060:46`) et le `c.token` du contrat ; `get_mission_by_token` renvoie l'`artisan_token` (`0020:81`) ; `inscrire_artisan` renvoie `contrat_token` **et** `espace_token` à un appelant anonyme (`0053:154-155`).
- Ces tokens circulent en clair dans des liens envoyés par email et WhatsApp (`0029:89`, `0032:129`, `0056:41`…), et sont donc présents dans les historiques de navigation, les en-têtes `Referer` sortants et les logs d'accès Vercel.

**Impact** : un artisan **écarté** (`0042_artisans_ecartes.sql`) conserve un accès complet à son espace, à ses chantiers et aux PII des clients concernés — il n'existe aucun moyen de lui couper l'accès autrement qu'en supprimant sa ligne. Un lien transféré par erreur donne un accès permanent et intraçable. Et comme un token en révèle d'autres, la compromission d'un seul lien de mission expose l'espace artisan complet.

**Correctif** — deux niveaux, du plus simple au plus complet.

Niveau 1, révocabilité immédiate (quelques lignes, applicable tout de suite) :

```sql
alter table public.artisans     add column if not exists token_revoked_at timestamptz;
alter table public.affectations add column if not exists token_revoked_at timestamptz;
alter table public.contrats     add column if not exists token_revoked_at timestamptz;
```

puis, dans **chaque** fonction `*_by_token`, remplacer `where token = p_token` par
`where token = p_token and token_revoked_at is null`.

Fonction de révocation réservée aux associés :

```sql
create or replace function public.revoquer_acces_artisan(p_artisan_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.artisans set token_revoked_at = now() where id = p_artisan_id;
  update public.affectations set token_revoked_at = now() where artisan_id = p_artisan_id;
$$;
revoke execute on function public.revoquer_acces_artisan(uuid) from public;
grant  execute on function public.revoquer_acces_artisan(uuid) to authenticated;
```

À brancher sur l'action « écarter un artisan » de `artisan-detail-page.tsx`.

Niveau 2 : cesser de renvoyer des tokens dans les réponses. `get_espace_artisan` n'a pas besoin d'exposer `af.token` — la page pourrait appeler une RPC dédiée qui vérifie l'appartenance du chantier à l'artisan.

**Effort** : M pour le niveau 1, L pour le niveau 2.

---

### [CRITIQUE] A1-04 — `inscrire_artisan` : écriture anonyme non validée, non limitée en débit, et déclenchant des emails

**Où** : `0053_zones_multiples.sql:102-158`, `src/features/artisans/pages/inscription-artisan-page.tsx:73,87`, `0054_notif_inscription.sql:30`

**Constat** : la fonction insère **28 colonnes** dans `artisans` à partir d'un `jsonb` brut fourni par un appelant anonyme. La seule validation serveur est :

```sql
if coalesce(trim(p_payload->>'nom'),'') = '' and coalesce(trim(p_payload->>'societe'),'') = '' then
  return json_build_object('ok', false, 'error', 'Nom ou société requis');
end if;
```

Rien d'autre n'est contrôlé : ni le format de l'email, ni le SIREN, ni les booléens d'assurance, ni **`taux_commission`**, qui est écrit tel quel via `coalesce(nullif(p_payload->>'taux_commission','')::numeric, 0.10)` (`0053:143`). Le bornage 5–30 % existe uniquement dans le front (`inscription-artisan-page.tsx:73`), donc uniquement pour qui utilise le formulaire.

L'insertion déclenche `trg_notif_artisan_inscrit` (`0054:30`) → `net.http_post` vers n8n → email.

**Impact** : trois effets cumulés. Pollution de la base par des fiches artisans arbitraires, sans aucune limite de débit. Un email par insertion, donc un vecteur d'inondation de la boîte de l'agence et de consommation du quota Gmail. Et surtout la maîtrise du taux de commission — traité en détail dans `audit/03-logique-metier.md` (A3-01 et A3-03), car l'impact est financier.

**Exploitation** :

```bash
for i in $(seq 1 1000); do
  curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/inscrire_artisan" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"p_payload":{"societe":"X'$i'","taux_commission":0}}'
done
```

**Correctif** — valider côté serveur, et rendre le taux non contrôlable par l'appelant :

```sql
-- Le taux ne vient JAMAIS du payload : il est porté par le canal d'inscription.
-- Table de liens d'invitation, gérée par les associés.
create table if not exists public.liens_inscription (
  code text primary key,
  taux_commission numeric not null check (taux_commission between 0.05 and 0.30),
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.liens_inscription enable row level security;
create policy "liens_auth" on public.liens_inscription
  for all to authenticated using (true) with check (true);
```

Dans `inscrire_artisan`, remplacer la lecture du taux par une résolution depuis `p_payload->>'code_lien'` sur cette table, avec repli sur `0.10` si le code est absent ou inactif. Ajouter par ailleurs :

```sql
-- Validation minimale
if p_payload->>'email' is not null
   and p_payload->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
  return json_build_object('ok', false, 'error', 'Email invalide');
end if;

-- Anti-flood : 3 inscriptions max par heure toutes sources confondues
if (select count(*) from public.artisans
    where created_at > now() - interval '1 hour'
      and source like 'auto:%') >= 3 then
  return json_build_object('ok', false, 'error', 'Trop de demandes, réessayez plus tard');
end if;
```

Le garde-fou anti-flood ci-dessus est volontairement grossier : pour une agence qui reçoit quelques inscriptions par semaine, il suffit. Une vraie limitation par IP nécessiterait de passer par une edge function.

**Effort** : M.

---

### [ÉLEVÉ] A1-05 — `signer_contrat` signe un contrat pour quiconque détient le token, sans vérification d'identité

**Où** : `0006_contrats.sql:61-88`

**Constat** : la fonction accepte `p_signataire` et `p_signature` **entièrement contrôlés par l'appelant**, et ne vérifie que l'égalité du token et l'idempotence (`statut <> 'signe'`). Aucune corrélation avec l'artisan, aucun horodatage de preuve, aucune conservation de l'IP ou du user-agent.

**Impact** : quiconque intercepte ou reçoit par transfert un lien `/signer/:token` peut signer le contrat d'engagement au nom de l'artisan, avec un nom et une image de signature arbitraires. C'est le contrat qui fixe la commission due à l'agence : sa valeur probante en cas de litige est directement en jeu. Le volet juridique est traité dans `audit/02-securite-app.md` (partie RGPD/eIDAS).

**Correctif** : conserver a minima les éléments de preuve, ce qui ne coûte presque rien et change beaucoup en cas de contestation.

```sql
alter table public.contrats
  add column if not exists signature_ip inet,
  add column if not exists signature_user_agent text;
```

et passer ces valeurs depuis une edge function (le front ne connaît pas sa propre IP publique). Idéalement, ajouter une seconde preuve d'identité : code à usage unique envoyé par SMS au numéro de l'artisan avant signature.

**Effort** : M pour la trace, L pour le code SMS.

---

### [ÉLEVÉ] A1-06 — L'edge function `upload-devis` expose un service_role derrière un CORS ouvert

**Où** : `supabase/functions/upload-devis/index.ts` (66 lignes, lues intégralement)

**Constat** : cumul de six faiblesses.

1. Le client est créé avec `SUPABASE_SERVICE_ROLE_KEY` (`:23-26`) — la RLS est totalement contournée.
2. Aucune vérification de JWT dans le code. Il n'existe **pas de `supabase/config.toml` versionné**, donc `verify_jwt` n'est pas épinglé : la protection dépend d'un réglage de dashboard non tracé. *À confirmer.*
3. `Access-Control-Allow-Origin: '*'` (`:7`), appliqué à toutes les réponses (`:60-65`).
4. L'extension du fichier vient de l'entrée utilisateur et est concaténée dans le chemin (`:38-39`) avec `upsert: true`.
5. Aucun plafond de taille avant `atob` (`:37`) — un base64 volumineux consomme la mémoire de la fonction.
6. Les erreurs Supabase brutes sont renvoyées au client (`:44`, `:52`, `:56`).

**Point aggravant, et paradoxalement rassurant** : cette fonction **n'est jamais appelée par le front** (aucune occurrence de `functions.invoke` ni de `upload-devis` dans `src/`). Le chemin réellement utilisé passe par `src/lib/storage.ts:39-52`. C'est donc du code mort exposé publiquement.

Voir aussi `src/lib/supabase/client.ts:16`, qui réexporte `supabaseAnonKey` avec le commentaire « pour que les appels edge function puissent contourner la vérification JWT » — l'intention documentée est de contourner la vérification.

**Correctif** : la supprimer. C'est le correctif le plus sûr, et il est gratuit puisqu'elle n'est pas utilisée.

```bash
supabase functions delete upload-devis
git rm -r supabase/functions/upload-devis
```

Si elle doit être conservée, alors : épingler `verify_jwt = true` dans un `supabase/config.toml` versionné, restreindre `Access-Control-Allow-Origin` à l'origine de production, forcer l'extension à `pdf`, plafonner la taille avant décodage, et renvoyer des messages d'erreur génériques.

**Effort** : S pour la suppression.

---

### [ÉLEVÉ] A1-07 — Le bucket `projet-photos` est énumérable par n'importe qui

**Où** : `0018_photos_et_suivi.sql:11-23`

**Constat** : bucket créé avec `public = true`, et la policy de lecture est déclarée **sans clause `to`** :

```sql
create policy "photos_read" on storage.objects for select using (bucket_id = 'projet-photos');
```

En l'absence de `to`, la policy s'applique au rôle `PUBLIC`, donc à `anon`. L'écriture et la suppression sont, elles, correctement réservées à `authenticated` — le problème est limité à la lecture et à l'énumération.

**Impact** : les photos de chantier sont énumérables et téléchargeables par tous. Elles montrent l'intérieur de domiciles de clients et peuvent contenir des éléments identifiants (façade, plaque de rue, courrier). Le commentaire de la migration les qualifie de « non sensible » : c'est inexact au sens du RGPD, dès lors qu'elles sont rattachables à une adresse client.

**Correctif** : symétrique de A1-01 — bucket privé, lecture `authenticated`, et URLs signées pour l'artisan.

```sql
update storage.buckets set public = false where id = 'projet-photos';
drop policy if exists "photos_read" on storage.objects;
create policy "photos_read_auth" on storage.objects
  for select to authenticated using (bucket_id = 'projet-photos');
```

Attention : `get_mission_by_token` et `get_espace_artisan` renvoient `p.photos` sous forme d'URLs publiques. Il faudra générer des URLs signées côté fonction, sinon les photos cesseront de s'afficher pour l'artisan.

**Effort** : M.

---

### [ÉLEVÉ] A1-08 — Toute session authentifiée a un accès total, sans distinction

**Où** : `0003_rls.sql:12-26` et 12 policies identiques dans les migrations suivantes

**Constat** : les 14 tables ont exactement une policy, de la forme `for all to authenticated using (true) with check (true)`. **Aucune policy du dépôt ne référence `auth.uid()`, `auth.jwt()` ou `auth.role()`** — vérifié, zéro occurrence sur les 60 migrations. Il n'y a donc aucune notion de propriétaire de ligne, aucun rôle, aucune séparation.

Pour deux associés aux droits volontairement identiques, ce choix est défendable et je ne le compte pas comme un défaut en soi. Le risque est ailleurs : **ce modèle n'a aucune marge**. Le jour où un compte supplémentaire est créé — un stagiaire, un comptable, un développeur externe — il obtient immédiatement la totalité des données clients, des montants et des commissions, sans qu'aucune ligne de code ne s'y oppose.

**Le risque devient critique si l'inscription libre est restée activée** côté dashboard Supabase : n'importe qui créerait alors un compte et hériterait de `using (true)` sur tout. Le code seul ne permet pas de trancher.

**Impact** : accès total à l'ensemble des données de l'entreprise pour tout compte authentifié, présent ou futur.

**Correctif immédiat, à faire aujourd'hui** : dans le dashboard Supabase → *Authentication → Providers → Email*, désactiver **Enable sign-ups**. Les deux comptes existants continuent de fonctionner ; la création se fait à la main.

**Correctif structurel**, dès qu'un troisième utilisateur est envisagé : introduire une table `profils(user_id, role)` et remplacer `using (true)` par des prédicats fondés sur `auth.uid()`.

**Effort** : S pour la désactivation des inscriptions, L pour le modèle de rôles.

**À confirmer en prod** : section `comptes_auth` de `audit/verification-prod.sql`. **Un nombre de comptes supérieur à 2 est un signal d'alarme à traiter immédiatement.**

---

### [ÉLEVÉ] A1-09 — Les RPC par token permettent d'écrire des données financières sans aucune borne

**Où** : `0025_rpc_affectations.sql:130-152` (`set_montant_by_token`), `:155-177` (`set_devis_by_token`), `:180-213` (`update_projet_by_token`)

**Constat** : ces trois fonctions vérifient l'existence du token, puis écrivent sans aucune validation.

- `set_montant_by_token` écrit un `numeric` arbitraire dans `montant_devis_signe` — négatif, nul ou démesuré. C'est la base de calcul de la commission.
- `set_devis_by_token` écrit une **chaîne d'URL arbitraire** dans `devis_url`, sans vérifier qu'elle pointe vers le bucket du projet. Un artisan peut y placer l'URL de son choix, qui sera ensuite affichée et ouverte par les associés depuis le CRM.
- `update_projet_by_token` réécrit nom, email, adresse, code postal, ville, description et budget du client. Le téléphone est délibérément exclu — bonne intention, mais l'email ne l'est pas, alors qu'il permet le même détournement de canal.

**Impact** : falsification de la base de calcul de la commission (détaillé dans `03-logique-metier.md`), et injection d'URL arbitraire suivie par un associé depuis une session authentifiée.

**Correctif** :

```sql
-- Bornes sur les montants
create or replace function public.set_montant_by_token(p_token text, p_slot text, p_montant numeric)
returns json language plpgsql security definer set search_path = public as $func$
declare af public.affectations;
begin
  if p_montant is null or p_montant < 0 or p_montant > 10000000 then
    return json_build_object('ok', false, 'error', 'Montant invalide');
  end if;
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if    p_slot = 'devis'       then update public.affectations set montant_devis = p_montant where id = af.id;
  elsif p_slot = 'devis_signe' then update public.affectations set montant_devis_signe = p_montant where id = af.id;
  else  return json_build_object('ok', false); end if;
  return json_build_object('ok', true);
end; $func$;
```

Pour `set_devis_by_token`, contraindre l'URL au bucket attendu :

```sql
if p_url !~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/(public|sign)/devis/' || af.token || '/') then
  return json_build_object('ok', false, 'error', 'URL non autorisée');
end if;
```

Et dans `update_projet_by_token`, valider le format de l'email et borner `p_budget`.

**Effort** : S.

---

### [MOYEN] A1-10 — Deux fonctions de lecture écrivent en base par effet de bord

**Où** : `0060_espace_artisan_commission.sql:22`, `0020_termine_et_redirection.sql:77`, via `ensure_engagement_contrat` (`0055:4`)

**Constat** : `get_espace_artisan` et `get_mission_by_token`, présentées comme des lectures, appellent `ensure_engagement_contrat`, qui **insère une ligne dans `contrats`** si aucune n'existe. Une simple consultation crée donc de la donnée.

**Impact** : un `GET` sur un lien d'espace artisan génère un contrat. Conséquences : compteurs faussés, et surtout impossibilité de mettre ces lectures en cache ou de les rejouer sans effet. Combiné à A1-03 (propagation de tokens), un robot qui suivrait les liens présents dans les emails créerait des contrats.

**Correctif** : séparer la lecture de la création. `get_*` ne renvoie que le contrat existant (`null` sinon) ; une RPC explicite `preparer_contrat(p_token)` est appelée par le front au moment où l'artisan clique sur « signer ». C'est d'ailleurs le comportement qu'avait `get_mission_by_token` en `0008:28`, dont le commentaire indique « lecture seule (plus de création automatique) » — la régression a été réintroduite depuis.

**Effort** : M.

---

### [MOYEN] A1-11 — `_devis_artisan` renvoie la ligne artisan complète, token compris, derrière un UUID en dur

**Où** : `0041_devis.sql:34-38`, `src/features/contrats/espace-artisan-page.tsx:49`

**Constat** :

```sql
select * into a from public.artisans
where token = p_token and a.id = '98a39398-2b7f-4a44-b9bc-aa6f893e9d32';
```

Un identifiant de production est codé en dur dans une migration, comme drapeau d'activation du générateur de devis pour un seul artisan. Le même UUID est répété côté front (`METBACH_ID`). La fonction retourne `a` en entier, donc **y compris `a.token`**, aux fonctions appelantes.

**Impact** : modéré aujourd'hui (le garde-fou restreint fortement l'usage), mais c'est une dette qui deviendra un incident : le jour où la fonctionnalité est généralisée, ce filtre sautera et la fonction exposera l'intégralité de la ligne artisan. Par ailleurs, un drapeau fonctionnel dans une migration ne peut pas être modifié sans nouvelle migration.

**Correctif** : remplacer par une colonne `artisans.devis_actif boolean not null default false`, filtrer dessus, et ne sélectionner que les colonnes nécessaires (`a.id`, `a.societe`) plutôt que `select *`.

**Effort** : S.

---

### [MOYEN] A1-12 — `update_projet_by_token` a changé de sémantique en gardant la même signature

**Où** : `0022_edition_projet_artisan.sql:5-43` puis `0025_rpc_affectations.sql:180-213`

**Constat** : les deux versions ont **exactement la même signature 8-args**, donc `create or replace` a silencieusement écrasé la première. Mais elles n'interprètent pas le même token : `0022` cherchait dans `projets`, `0025` cherche dans `affectations`. Le `grant` a été émis deux fois (`0022:41`, `0025:213`).

**Impact** : tout appelant qui aurait transmis un token de projet a cessé de fonctionner au déploiement de `0025`, en renvoyant `{"ok": false}` — un échec **silencieux**, puisque le front ne distingue pas « token inconnu » de « erreur ». Aucun appelant actuel n'est concerné (`espace-artisan-page.tsx:858` passe bien un token d'affectation), mais le mécanisme reste dangereux : rien n'empêche que cela se reproduise.

**Correctif** : distinguer les erreurs dans les valeurs de retour (`error: 'token_inconnu'` vs `ok: false`), et adopter la convention de nommer les fonctions d'après le token attendu (`update_projet_by_affectation_token`).

**Effort** : S.

---

### [MOYEN] A1-13 — Les webhooks sortants ne sont pas authentifiés et transportent des tokens

**Où** : plus de 40 appels `net.http_post` dans `0009, 0011, 0027, 0029, 0031, 0032, 0033, 0042, 0045, 0054, 0056, 0057, 0058`

**Constat** : l'URL `https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events` est **codée en dur plus de 20 fois**. Aucun appel ne porte d'en-tête d'authentification : le seul `headers` utilisé est `'{"Content-Type":"application/json"}'`. Les charges utiles contiennent des noms de clients, des villes, des identifiants de projet, et **des tokens d'espace artisan** sous forme de liens cliquables (`0029:89`, `0032:129`…).

**Impact** : le canal est en HTTPS, mais ni l'émetteur ni le destinataire ne s'authentifient. Le volet « n'importe qui peut poster sur ce webhook » est traité dans `02-securite-app.md`. Ici, le point propre à la base est le **couplage** : changer d'URL n8n impose de réécrire 20 migrations, et une rotation d'urgence est impossible.

**Correctif** : centraliser l'URL et ajouter un secret partagé.

```sql
insert into public.app_settings (cle, valeur)
values ('n8n_webhook_url', 'https://…/webhook/crm-celexia-events'),
       ('n8n_secret', encode(gen_random_bytes(32), 'hex'))
on conflict (cle) do nothing;

create or replace function public.notifier_n8n(p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := (select valeur from public.app_settings where cle = 'n8n_webhook_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', (select valeur from public.app_settings where cle = 'n8n_secret')),
    body    := p_payload);
end; $$;
revoke execute on function public.notifier_n8n(jsonb) from public;
```

puis remplacer les 40 appels par `perform public.notifier_n8n(jsonb_build_object(...))`, et vérifier l'en-tête côté n8n. **Attention** : `app_settings` est lisible par tout utilisateur authentifié — pour un vrai secret, préférer Supabase Vault.

**Effort** : M.

---

### [FAIBLE] A1-14 — Redéfinitions massives de fonctions, sans possibilité de rollback

**Où** : ensemble des migrations

**Constat** : `add_suivi_by_token` est défini **10 fois** (`0018:44`, `0020:27`, `0021:27`, `0025:77`, `0026:2`, `0027:3`, `0031:10`, `0032:15`, `0057:24`, `0058:6`), `get_espace_artisan` 7 fois, `get_mission_by_token` 6 fois, `ensure_engagement_contrat` 5 fois, `traiter_relances` 5 fois, `inscrire_artisan` 4 fois. Les commentaires révèlent des corrections successives en production (« BUG 1 CORRIGÉ » en `0058:55`). Aucune migration de rollback n'existe.

**Impact** : personne ne peut dire de mémoire quel est le comportement courant d'une fonction sans lire les 10 versions dans l'ordre. C'est exactement le terrain sur lequel A1-02 est apparu — un `grant` oublié lors d'une redéfinition.

**Correctif** : pour les 6 fonctions les plus retouchées, écrire une migration `0061_consolidation_fonctions.sql` qui redéfinit chacune **une fois**, avec sa version courante, ses `grant`/`revoke` explicites et un commentaire `comment on function`. Puis, en règle de travail : toute redéfinition réémet ses `grant`.

**Effort** : M.

---

### [FAIBLE] A1-15 — Le lien du projet Supabase est versionné

**Où** : `supabase/.temp/linked-project.json`, `.gitignore`

**Constat** : le fichier est suivi par git et contient `{"ref":"oymnthijjbwkatrhqzvi", "organization_id":"ktbmcogswglnzihvehro"}`. `.gitignore` couvre `.env*` et `*.docx`, mais pas `supabase/.temp/`.

**Impact** : faible en soi — l'URL du projet est de toute façon dans le bundle front. Mais c'est un fichier d'état local de la CLI, qui n'a rien à faire dans l'historique, et sa présence indique que `.gitignore` n'a pas suivi l'ajout de la CLI.

**Correctif** :

```bash
printf 'supabase/.temp/\n' >> .gitignore
git rm -r --cached supabase/.temp
```

**Effort** : S.

---

## Ce qui est bien fait

Un audit qui ne relève que les défauts donne une image fausse. Les choix suivants sont corrects et méritent d'être préservés lors des corrections :

- **La RLS est activée sur les 14 tables**, sans exception. Aucune table n'a été oubliée en 60 migrations.
- **Aucune page publique ne fait de `.from()` direct.** Tout l'accès anonyme passe par des RPC `SECURITY DEFINER`, ce qui donne un point de contrôle unique et auditable. C'est le bon patron ; ce sont les fonctions qui sont trop permissives, pas l'architecture.
- **Le bucket `documents` est correctement conçu** : privé, policies `authenticated`, URLs signées à 1 h (`src/lib/storage.ts:99-110`). Il montre que le patron sûr est connu et déjà implémenté — les buckets `devis` et `projet-photos` n'ont qu'à s'y aligner.
- **L'entropie des tokens est suffisante** (`gen_random_uuid()`, 122 bits). Ni `md5(random())` ni séquence devinable. Le défaut porte sur le cycle de vie, pas sur la génération.
- **Toutes les fonctions `SECURITY DEFINER` figent leur `search_path`**, ce qui neutralise la classe d'attaques par détournement de schéma.
- **`get_espace_artisan` masque les PII client tant que le contrat n'est pas signé** (`0060:55-59`) — une vraie précaution, délibérée.
- **`update_projet_by_token` exclut volontairement le téléphone du client** (`0025:180`), pour empêcher un artisan de détourner le canal de contact. L'intention est juste ; elle mériterait d'être étendue à l'email.
- **Aucune clé de service n'a jamais été commitée**, sur l'intégralité de l'historique git.
