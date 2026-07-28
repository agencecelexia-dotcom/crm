-- ============================================================
--  SCRIPT PONCTUEL (à jouer UNE fois dans le SQL Editor Supabase)
--
--  Objet : retirer du pipe de Batryx les 24 prospects qu'il a demandé à
--  supprimer, SANS rien perdre côté agence.
--
--  Effet : ses affectations passent en « perdu » et sont masquées → elles
--  disparaissent de son espace immédiatement. Les projets, eux, restent
--  intacts côté agence (même statut, même historique) et porteront le
--  compteur « perdu par N artisan(s) ». Ses statistiques (perdus, taux de
--  conversion) continuent de les compter.
--
--  ⚠️ Exécuter d'abord la migration 0062, puis l'ÉTAPE 1, relire le résultat,
--     et seulement ensuite l'ÉTAPE 2.
-- ============================================================


-- ------------------------------------------------------------
--  ÉTAPE 1 — CONTRÔLE (ne modifie rien)
--
--  Lance ce bloc seul et relis la sortie :
--   • une ligne par prospect trouvé → vérifier que c'est bien la bonne personne
--   • `trouve = false` → le nom n'a pas été retrouvé (orthographe différente,
--     prospect déjà supprimé, ou jamais affecté à Batryx) : à traiter à la main
--   • plusieurs lignes pour un même terme → homonymes, à arbitrer avant l'étape 2
-- ------------------------------------------------------------

-- Normalisation : minuscules, sans accents, ponctuation → espaces.
create or replace function public.celexia_norm_txt(t text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(t, ''),
      'àâäáãåçèéêëìíîïñòóôöõùúûüýÿÀÂÄÁÃÅÇÈÉÊËÌÍÎÏÑÒÓÔÖÕÙÚÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')),
    '[^a-z0-9]+', ' ', 'g'))
$$;

with batryx as (
  select id from public.artisans
  where public.celexia_norm_txt(coalesce(societe, '') || ' ' || coalesce(nom, '')) like '%batryx%'
),
-- Les 24 entrées demandées par Batryx (nom recherché, téléphone éventuel).
termes (rang, terme, tel) as (values
  ( 1, 'paul brucelle',          '0607452418'),
  ( 2, 'gautier servane',        null),
  ( 3, 'duret lucile',           null),
  ( 4, 'de araujo thomas',       null),
  ( 5, 'christophe druhen',      null),
  ( 6, 'escribano damien',       null),
  ( 7, 'gachet vincent',         null),
  ( 8, 'yoan romero',            null),
  ( 9, 'florence sanitas',       null),
  (10, 'stokx william',          null),
  (11, 'bernadette croguennec',  null),
  (12, 'elodie vignaud',         null),
  (13, 'tony pezin',             null),
  (14, 'pourrat maude',          null),
  (15, 'maryline martineau',     null),
  (16, 'pascal viguier',         null),
  (17, 'belkacem bramei',        null),
  (18, 'manuel david',           null),
  (19, 'fontenille',             null),
  (20, 'kamel mazari',           null),
  (21, null,                     '0698953228'),
  (22, 'arbol',                  null),
  (23, 'olivier lebreton',       null),
  (24, 'arnaud reby',            null)
)
select
  t.rang,
  coalesce(t.terme, t.tel) as recherche,
  (m.affectation_id is not null) as trouve,
  m.client_nom, m.client_telephone, m.client_ville,
  m.statut_artisan, m.statut_projet,
  m.montant_devis, m.montant_devis_signe,
  m.affectation_id
from termes t
left join lateral (
  select
    af.id as affectation_id,
    p.client_nom, p.client_telephone, p.client_ville,
    af.statut as statut_artisan, p.statut as statut_projet,
    af.montant_devis, af.montant_devis_signe
  from public.affectations af
  join public.projets p on p.id = af.projet_id and p.deleted_at is null
  where af.artisan_id = (select id from batryx)
    and (
      -- tous les mots significatifs (3 lettres et +) présents dans le nom du client
      (t.terme is not null and (
         select bool_and(position(' ' || w || ' ' in ' ' || public.celexia_norm_txt(p.client_nom) || ' ') > 0)
         from unnest(string_to_array(t.terme, ' ')) w
         where length(w) >= 3
      ))
      -- ou correspondance sur le téléphone (chiffres uniquement)
      or (t.tel is not null
          and regexp_replace(coalesce(p.client_telephone, ''), '[^0-9]', '', 'g') = t.tel)
    )
) m on true
order by t.rang, m.client_nom;


-- ------------------------------------------------------------
--  ÉTAPE 2 — APPLICATION (à lancer seulement après relecture de l'étape 1)
--
--  Décommente le bloc ci-dessous puis exécute-le. Il renvoie la liste des
--  affectations effectivement masquées (pour archive).
-- ------------------------------------------------------------

/*
with batryx as (
  select id from public.artisans
  where public.celexia_norm_txt(coalesce(societe, '') || ' ' || coalesce(nom, '')) like '%batryx%'
),
termes (terme, tel) as (values
  ('paul brucelle',          '0607452418'),
  ('gautier servane',        null),
  ('duret lucile',           null),
  ('de araujo thomas',       null),
  ('christophe druhen',      null),
  ('escribano damien',       null),
  ('gachet vincent',         null),
  ('yoan romero',            null),
  ('florence sanitas',       null),
  ('stokx william',          null),
  ('bernadette croguennec',  null),
  ('elodie vignaud',         null),
  ('tony pezin',             null),
  ('pourrat maude',          null),
  ('maryline martineau',     null),
  ('pascal viguier',         null),
  ('belkacem bramei',        null),
  ('manuel david',           null),
  ('fontenille',             null),
  ('kamel mazari',           null),
  (null,                     '0698953228'),
  ('arbol',                  null),
  ('olivier lebreton',       null),
  ('arnaud reby',            null)
),
a_masquer as (
  select distinct af.id
  from public.affectations af
  join public.projets p on p.id = af.projet_id and p.deleted_at is null
  join termes t on (
    (t.terme is not null and (
       select bool_and(position(' ' || w || ' ' in ' ' || public.celexia_norm_txt(p.client_nom) || ' ') > 0)
       from unnest(string_to_array(t.terme, ' ')) w
       where length(w) >= 3
    ))
    or (t.tel is not null
        and regexp_replace(coalesce(p.client_telephone, ''), '[^0-9]', '', 'g') = t.tel)
  )
  where af.artisan_id = (select id from batryx)
)
update public.affectations af
   set statut    = 'perdu',
       perdu_at  = coalesce(af.perdu_at, now()),
       masque_at = now()
  from a_masquer m, public.projets p
 where af.id = m.id and p.id = af.projet_id
returning af.id, p.client_nom, p.client_ville, af.statut, af.masque_at;
*/


-- ------------------------------------------------------------
--  Nettoyage optionnel (la fonction ne sert qu'à ce script)
-- ------------------------------------------------------------
-- drop function if exists public.celexia_norm_txt(text);
