# Automatisations anti-inaction (P0)

Objectif : ne plus perdre de leads par inaction. Le système relance les artisans,
escalade vers Thomas (email + alerte in-app « à appeler »), et signale les leads
non attribués — **uniquement entre 8 h et 20 h (Europe/Paris)**.

## Les 3 automatisations
1. **Contrat non signé** — artisan assigné qui n'a pas signé : 1ʳᵉ relance à +24 h,
   puis ~2/jour (toutes les 12 h). À +48 h : email à Thomas + **alerte « à appeler »**
   dans le CRM (cloche en haut). Les coordonnées client ne sont **jamais** exposées
   tant que l'artisan n'a pas signé (l'email ne contient que métier + ville).
2. **Inaction sur un chantier** — artisan signé dont le chantier est figé
   (assigné/contacté/RDV/en attente) : même cadence + escalade à +48 h.
3. **Leads non attribués** — projets « nouveau » sans artisan depuis +24 h : digest
   quotidien à l'agence, trié par budget décroissant.

Chaque relance est **idempotente** (jamais de doublon) et **consultable** :
- par projet : carte « Relances automatiques » sur la fiche projet ;
- globalement : page **Automatisations** (menu) → historique.

## Comment ça marche (technique)
- Moteur : fonction SQL `public.traiter_relances()` (migration `0029_automatisations.sql`).
- Planif : **pg_cron** `relances_tick` toutes les 30 min (le garde-fou horaire filtre).
- Emails : `pg_net` → webhook **n8n** `crm-celexia-events` → nœud « Format » (Code).
- Tables : `relances` (idempotence + timeline), `notifications` (alertes in-app).

## Ajuster les délais / horaires (sans code)
Page **Automatisations** (menu latéral) :
- Activer/désactiver chaque automatisation.
- **1ʳᵉ relance (h)**, **Intervalle (h)**, **Escalade Thomas (h)**.
- **Heure début / fin** des envois.

Ou directement dans la table `app_settings` (clés) :
`auto_contrat`, `auto_inaction`, `auto_orphelin` (`on`/`off`) ·
`relance_premier_h`, `relance_interval_h`, `relance_escalade_h`,
`heure_debut`, `heure_fin` (valeurs en heures).

## Ajuster les textes des emails (templates)
Tout est dans **`n8n/crm-celexia-events.code.js`** (versionné), branches :
`relance_contrat`, `relance_inaction`, `escalade`, `lead_orphelin`.
Modifier le fichier puis redéployer le nœud « Format » du workflow
`CRM Celexia — Notifications` (id `PkhPQia4Ci2wwsCn`) via l'API n8n
(`PUT /api/v1/workflows/{id}`, header `X-N8N-API-KEY`).

## Changer la fréquence du cron
```sql
select cron.unschedule('relances_tick');
select cron.schedule('relances_tick', '*/15 * * * *', $$ select public.traiter_relances(); $$);
```
