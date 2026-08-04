-- ============================================================
--  0065 — Chaîne de la commission : fiabiliser les entrées du calcul.
--
--  Rappel : projets.commission est une colonne GÉNÉRÉE
--    coalesce(montant_devis_signe,0) * coalesce(taux_commission,0.10)
--  Le calcul est juste. Ce sont ses deux entrées qui étaient mal alimentées
--  (findings A3-01 et A3-02 de l'audit).
--
--  ⚠️ Cette migration ne modifie AUCUNE donnée existante. Les constats
--  mesurés en production avant écriture ont montré que les correctifs
--  « évidents » de l'audit auraient cassé des cas légitimes :
--
--   1. Un montant de 27 000 € saisi sur une affectation en statut
--      'en_attente', SANS devis signé déposé. C'est un prévisionnel, pas une
--      vente. Le remonter aurait créé une commission fantôme de 2 700 €.
--      → le trigger ne remonte donc QUE si l'affectation est à 'devis_signe'.
--
--   2. L'artisan à taux 0 % est CELEXIA elle-même (chantier réalisé en
--      propre, commission à 100 % déjà encaissée). Propager systématiquement
--      artisans.taux_commission aurait remis cette commission à 0 €.
--      → on n'INITIALISE que si le projet est encore au taux par défaut et
--        n'a aucun montant : jamais d'écrasement d'un choix explicite.
--
--  Conclusion tirée des données : projets.taux_commission est utilisé
--  DÉLIBÉRÉMENT comme taux négocié par projet. Ce n'est pas un bug, c'est
--  une fonctionnalité. Le vrai manque est l'absence de valeur initiale
--  sensée — un artisan recruté à 15 % voyait ses chantiers créés à 10 %.
-- ============================================================

-- ---------- A3-02 : remonter le montant signé au projet ----------
-- L'artisan saisit son montant via set_montant_by_token, qui n'écrit que sur
-- `affectations`. Jusqu'ici, seul add_suivi_by_token(p_statut='devis_signe')
-- le recopiait sur `projets` — donc un artisan qui saisissait son montant
-- sans déclarer le statut laissait la commission à 0 €.
-- Ce trigger couvre les deux ordres de saisie (montant puis statut, ou
-- l'inverse), et ne se déclenche que sur une affaire réellement signée.
create or replace function public.sync_montant_affectation_projet()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.statut = 'devis_signe'
     and new.montant_devis_signe is not null
     and (new.montant_devis_signe is distinct from old.montant_devis_signe
          or new.statut is distinct from old.statut)
  then
    update public.projets p
       set montant_devis_signe = new.montant_devis_signe,
           artisan_id = coalesce(p.artisan_id, new.artisan_id)
     where p.id = new.projet_id
       -- Ne jamais écraser le montant d'un autre artisan déjà déclaré gagnant.
       and (p.montant_devis_signe is null or p.artisan_id = new.artisan_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sync_montant on public.affectations;
create trigger trg_sync_montant
  after update on public.affectations
  for each row execute function public.sync_montant_affectation_projet();

-- ---------- A3-01 : initialiser le taux du projet depuis l'artisan ----------
-- À la création d'une affectation, si le projet est encore au taux par défaut
-- (0.10) et n'a pas encore de montant signé, il hérite du taux de l'artisan.
-- Les conditions garantissent qu'on n'écrase JAMAIS :
--   - un taux saisi manuellement par l'agence (différent de 0.10) ;
--   - un dossier déjà facturé (montant_devis_signe renseigné).
create or replace function public.init_taux_commission_projet()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_taux numeric;
begin
  select taux_commission into v_taux from public.artisans where id = new.artisan_id;

  if v_taux is not null and v_taux <> 0.10 then
    update public.projets
       set taux_commission = v_taux
     where id = new.projet_id
       and taux_commission = 0.10           -- encore au défaut : jamais un choix explicite
       and montant_devis_signe is null;     -- jamais un dossier déjà facturé
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_init_taux on public.affectations;
create trigger trg_init_taux
  after insert on public.affectations
  for each row execute function public.init_taux_commission_projet();

-- ---------- A3-03 : borner le taux sur le chemin PUBLIC uniquement ----------
-- inscription-artisan-page.tsx borne ?taux= entre 5 et 30 % côté client
-- seulement : un appel direct à la RPC inscrire_artisan (clé publiable, donc
-- publique) permettait n'importe quelle valeur, y compris 0 ou négative.
--
-- On ne pose PAS de contrainte CHECK sur la colonne : elle rejetterait
-- CELEXIA (0 %) et les taux négociés hors bornes, tous légitimes. On borne
-- uniquement les lignes créées par l'auto-inscription publique
-- (source = 'auto:%'), en repliant sur le taux standard si la valeur est
-- hors bornes. Les saisies internes de l'agence restent libres.
create or replace function public.clamp_taux_inscription_publique()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(new.source, '') like 'auto:%'
     and (new.taux_commission is null
          or new.taux_commission < 0.05
          or new.taux_commission > 0.30)
  then
    new.taux_commission := 0.10;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_clamp_taux_inscription on public.artisans;
create trigger trg_clamp_taux_inscription
  before insert on public.artisans
  for each row execute function public.clamp_taux_inscription_publique();

-- ---------- A1-09 : borner les montants écrits par l'artisan ----------
-- set_montant_by_token acceptait n'importe quel numeric : négatif, nul,
-- démesuré. C'est la base de calcul de la commission.
create or replace function public.set_montant_by_token(
  p_token text, p_slot text, p_montant numeric
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare af public.affectations;
begin
  if p_montant is null or p_montant < 0 or p_montant > 10000000 then
    return json_build_object('ok', false, 'error', 'montant_invalide');
  end if;

  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  if p_slot = 'devis' then
    update public.affectations set montant_devis = p_montant where id = af.id;
  elsif p_slot = 'devis_signe' then
    update public.affectations set montant_devis_signe = p_montant where id = af.id;
  else
    return json_build_object('ok', false, 'error', 'slot_invalide');
  end if;

  return json_build_object('ok', true);
end;
$function$;

revoke execute on function public.set_montant_by_token(text, text, numeric) from public;
grant  execute on function public.set_montant_by_token(text, text, numeric) to anon, authenticated;

-- Contrainte de dernier recours sur les montants (aucune ligne existante ne
-- la viole : vérifié avant écriture).
alter table public.affectations drop constraint if exists affectations_montants_positifs;
alter table public.affectations add constraint affectations_montants_positifs check (
  (montant_devis is null or montant_devis >= 0) and
  (montant_devis_signe is null or montant_devis_signe >= 0));

alter table public.projets drop constraint if exists projets_montants_positifs;
alter table public.projets add constraint projets_montants_positifs check (
  (montant_devis is null or montant_devis >= 0) and
  (montant_devis_signe is null or montant_devis_signe >= 0));
