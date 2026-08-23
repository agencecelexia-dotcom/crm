# 01 — L'argent

**Date** : 21 août 2026 · **Méthode** : lecture du code + vérification en production (requêtes
`select` uniquement) · **Aucune donnée modifiée.**

Chaque chiffre de ce document est reproductible : la requête qui le produit est donnée.

---

## La position financière, aujourd'hui

| | Montant |
|---|---:|
| CA signé cumulé | **179 861,75 €** |
| Commission acquise | **26 605,96 €** |
| dont **encaissée** | 5 273,70 € |
| dont **à encaisser** | **21 332,26 €** |
| Pipe chiffré non signé | 165 970,00 € |

**80 % de la commission acquise n'est pas encaissée.** Douze dossiers portent ces 21 332 €.

---

## A1 — 🔴 CRITIQUE — 91 000 € comptés comme gagnés alors qu'aucun artisan n'a gagné

### Le fait

Le projet **`baurand thomas`** porte `montant_devis_signe = 91 000 €` et
`commission = 13 650 €`. Son statut projet est `devis_signe`.

Mais aucune de ses deux affectations n'est gagnée :

| Artisan | statut | étape | issue |
|---|---|---|---|
| ZACHARI METBACH | `perdu` | — | **perdu** |
| BATRYX CONSTRUCTIONS | `devis_envoye` | `devis_envoye` | **en_cours** |

Personne n'a signé. Le montant a été saisi au niveau du projet et n'est jamais redescendu sur
une affectation.

### Ce que ça coûte

Ce dossier représente **51 % du CA signé affiché** et **64 % de la commission à encaisser**.
Deux chiffres du même tableau de bord se contredisent :

```
  conversion_gagnes  : 17     ← compté via projets.statut
  devis_signes       : 14     ← compté via affectations
```

Écart total mesuré entre les deux méthodes de comptage : **92 750 €**
(le second dossier est `M. Joly`, 1 750 €).

### Reproduction

```sql
select p.client_nom, p.statut, p.montant_devis_signe,
       string_agg(distinct af.issue, ',') as issues
from projets p
left join affectations af on af.projet_id = p.id and af.retire_at is null
where p.deleted_at is null and p.statut in ('devis_signe','termine')
group by p.id, p.client_nom, p.statut, p.montant_devis_signe
having coalesce(string_agg(distinct af.issue, ','), 'x') not like '%gagne%';
```

### Correctif proposé

Deux décisions, dans cet ordre :

1. **Métier** : qui a réellement signé ce chantier ? Si c'est Batryx, son affectation doit passer
   en `devis_signe` et porter le montant. Si personne, le projet ne doit pas être `devis_signe`.
2. **Technique** : ajouter le contrôle `projet gagné sans affectation gagnée` (voir A4) pour que
   le cas ne puisse plus s'installer silencieusement.

---

## A2 — 🔴 CRITIQUE — Le taux du projet peut diverger du taux contractuel, sans alerte

### Le fait

**8 projets ont un taux différent de celui inscrit sur la fiche de leur artisan.**

| Artisan | Fiche | Projet | Projets | Commission en jeu |
|---|---:|---:|---:|---:|
| ZACHARI METBACH | 10 % | **15 %** | 2 | **13 650 €** |
| CELEXIA | 0 % | **100 %** | 1 | 402 € *(encaissé — facturation directe, légitime)* |
| Hd bâtiment | 10 % | 15 % | 1 | 0 € |
| SAS GROUPES JUCAS | 10 % | 15 % | 1 | 0 € |
| JALIS SOUIBER | 10 % | 15 % | 1 | 0 € |
| OLIVIER ROUSSEAU | 10 % | 15 % | 1 | 0 € |
| ED Espaces Verts | 10 % | **6 %** | 1 | 0 € |

Sur Metbach, l'écart se chiffre : **91 000 € × 5 % = 4 550 €** de différence selon le taux retenu.
Ses 33 autres projets sont à 10 %, ces 2-là à 15 % — la règle n'est pas la même selon les dossiers.

### Comment c'est arrivé

Le trigger `init_taux_commission_projet` (`0065:71`) **ne peut pas** produire ce résultat : il ne
s'active que si la fiche artisan diffère de `0.10`, or elle vaut exactement `0.10`.

Chronologie relevée : fiche Metbach modifiée pour la dernière fois le **28 juin**, projet
`baurand thomas` modifié le **25 juillet**. Le taux a donc été saisi à la main sur le projet, un
mois après, sans que rien ne le signale.

### La cause racine

Le taux est modifiable à **deux endroits indépendants**, sans lien ni contrôle entre eux :

- `src/features/projets/components/montants-card.tsx:50-53` — sur le projet
- `src/features/artisans/components/artisan-form.tsx:225` — sur la fiche artisan

Et la saisie n'est bornée que par le bas :

```ts
// montants-card.tsx:50-53
taux_commission: (() => {
  const t = parseFloat(taux.replace(',', '.'))
  return Number.isFinite(t) && t >= 0 ? t / 100 : 0.1   // ← 500 % passerait
})(),
```

**Aucune contrainte `CHECK` sur `projets.taux_commission` en base** (vérifié sur `pg_constraint`).
La production contient déjà un taux à **100 %** et un à **6 %**.

### Correctif proposé

1. Contrainte en base : `check (taux_commission >= 0 and taux_commission <= 0.30)` — un taux hors
   de cette plage relève de l'erreur de saisie, pas du cas métier.
2. Alerte visuelle dans `montants-card.tsx` quand le taux saisi diffère de celui de la fiche —
   ne pas bloquer (le cas CELEXIA est légitime), mais faire voir.
3. Trancher le cas Metbach : 15 % ou 10 % ? C'est une décision commerciale, pas technique.

---

## A3 — 🟠 ÉLEVÉ — 12 dossiers signés sans date de signature

`date_signature` est nulle sur **12 des 12 dossiers** dont la commission est due — dont
`Lionel Béni` (2 683 €), `Laurie Dilly` (1 225 €), `Cédric Siari` (1 174 €).

Conséquence directe : **impossible de savoir depuis quand une commission est due**, donc
impossible de prioriser les relances ou de calculer un délai moyen d'encaissement.

Seuls 4 dossiers ont une date, dont `baurand thomas` (27 jours) et `rachida salhi` (67 jours).

**Correctif** : rendre la date obligatoire quand `montant_devis_signe` est renseigné, ou la poser
automatiquement à la date du passage en `devis_signe`.

---

## A4 — 🔴 CRITIQUE — Les garde-fous ne contrôlent que la moitié du modèle

`verifier_coherence_metriques()` (`0088:13`) affiche **9 règles vertes**. Elles le sont.

Mais **les 9 règles ne portent que sur `affectations`** — vérifié : la fonction ne contient aucun
`from public.projets`. Tout ce qui est posé au niveau projet échappe au contrôle.

Cinq contrôles absents, et ce qu'ils trouvent en production **aujourd'hui** :

| Contrôle manquant | Anomalies |
|---|---:|
| Projet gagné sans affectation gagnée | **2** |
| Commission posée sans affectation gagnée | **3** |
| Taux projet ≠ taux fiche artisan | **8** |
| Taux hors bornes (0–30 %) | **1** |
| Signé sans date de signature | **12** |

**26 anomalies** invisibles pour un système qui se déclare cohérent.

### Aggravant

`verifier_coherence_metriques()` **n'est branchée sur aucun cron**. Le garde-fou existe mais ne
tourne jamais tout seul — il faut penser à l'appeler.

### Correctif proposé

Ajouter les 5 contrôles, puis planifier la fonction (quotidienne suffit) avec une notification
en cas d'anomalie. Le coût est faible : la fonction existe, il s'agit d'y ajouter des `select`.

---

## A5 — 🟡 MOYEN — Le module devis est réservé à un seul artisan, en dur

`_devis_artisan` (`0041:37`) filtre sur un UUID écrit dans le code :

```sql
where id = '98a39398-2b7f-4a44-b9bc-aa6f893e9d32'::uuid
```

Cinq RPC (`creer_devis_by_token`, `set_devis_pdf_by_token`, `envoyer_devis_by_token`,
`list_devis_by_token`) et une table `devis` entière ne servent qu'à un partenaire.

Les 92 autres artisans ne peuvent pas générer de devis depuis leur espace. Ce n'est pas un bug —
c'était sans doute voulu au départ — mais c'est un plafond de croissance codé en dur.

---

## Synthèse chiffrée

| # | Finding | Sévérité | En jeu |
|---|---|---|---:|
| A1 | 91 000 € gagnés sans artisan gagnant | 🔴 | **92 750 €** d'écart d'affichage |
| A2 | Taux divergent du contrat, sans borne | 🔴 | **4 550 €** sur Metbach |
| A4 | Garde-fous aveugles au niveau projet | 🔴 | **26 anomalies** non détectées |
| A3 | 12 signés sans date | 🟠 | relances impossibles |
| A5 | Devis réservé à 1 artisan sur 93 | 🟡 | plafond de croissance |

**Le plus urgent** : A1 et A2 concernent le même dossier (`baurand thomas`, Metbach) et
représentent à eux deux la majorité de ta commission à encaisser. Une décision métier les règle
tous les deux.
