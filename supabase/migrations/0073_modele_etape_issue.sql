-- ============================================================
--  0073 — P0 : une seule source de vérité sur l'avancement.
--
--  PROBLÈME (audit produit)
--  Un chantier avait trois façons non synchronisées de dire où il en est :
--  le stepper, les pastilles « En attente / Perdu », et les boutons d'appel.
--  Tous écrivaient dans le MÊME champ `statut`, donc la dernière action
--  écrasait les précédentes. Mesuré en production avant écriture :
--  45 des 66 affectations « en_attente » avaient en réalité une étape plus
--  avancée dans l'historique (26 RDV pris, 19 devis envoyés).
--
--  MODÈLE CIBLE — deux axes indépendants, au lieu d'un champ fourre-tout :
--   • `etape`  : jusqu'où le dossier est allé dans le funnel. MONOTONE, ne
--                recule jamais tout seul. Dérivée de l'historique `suivis`.
--   • `issue`  : en_cours / gagne / perdu. Orthogonale à l'étape — un
--                chantier « termine » reste « gagne », il ne sort plus du CA.
--   • `en_attente_depuis` / `rappel_le` : drapeaux SECONDAIRES, qui
--                s'affichent EN PLUS de l'étape et ne l'écrasent plus.
--
--  ⚠️ AUCUNE DONNÉE N'EST PERDUE
--  `statut` est CONSERVÉ tel quel et reste synchronisé : tout le code
--  existant continue de fonctionner à l'identique pendant la transition, et
--  un retour arrière est possible en supprimant simplement les colonnes.
--  Les nouvelles colonnes sont REMPLIES À PARTIR DE L'HISTORIQUE, jamais
--  inventées : une affectation sans événement garde une étape nulle.
-- ============================================================

-- ---------- 1. Les deux axes ----------
alter table public.affectations
  add column if not exists etape text,
  add column if not exists issue text not null default 'en_cours',
  add column if not exists en_attente_depuis timestamptz,
  add column if not exists rappel_le timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'affectations_etape_check') then
    alter table public.affectations add constraint affectations_etape_check
      check (etape is null or etape in
        ('contacte','rdv_pris','devis_envoye','devis_signe','termine'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'affectations_issue_check') then
    alter table public.affectations add constraint affectations_issue_check
      check (issue in ('en_cours','gagne','perdu'));
  end if;
end $$;

comment on column public.affectations.etape is
  'Étape la plus avancée atteinte dans le funnel. Monotone : ne recule jamais '
  'automatiquement. Dérivée de l''historique `suivis`, jamais saisie à la main.';
comment on column public.affectations.issue is
  'Issue commerciale, orthogonale à l''étape : en_cours / gagne / perdu. '
  'Un chantier terminé reste « gagne » et continue de compter dans le CA.';
comment on column public.affectations.en_attente_depuis is
  'Drapeau secondaire : le dossier est en attente d''un retour client. '
  'S''affiche EN PLUS de l''étape, ne l''écrase plus.';
comment on column public.affectations.rappel_le is
  'Rappel daté. Remplace le bouton « À rappeler » qui ne demandait aucune date, '
  'obligeant l''artisan à écrire la date en note libre.';

-- ---------- 2. Rang du funnel, réutilisé partout ----------
create or replace function public.rang_etape(p_etape text)
returns int language sql immutable as $$
  select case p_etape
    when 'contacte'     then 1
    when 'rdv_pris'     then 2
    when 'devis_envoye' then 3
    when 'devis_signe'  then 4
    when 'termine'      then 5
    else 0 end;
$$;

-- ---------- 3. Reconstruction depuis l'historique ----------
-- L'étape réelle est le statut le PLUS AVANCÉ jamais déclaré dans `suivis`.
-- On complète avec les faits matériels : un devis déposé prouve l'étape
-- « devis envoyé » même si l'artisan n'a jamais cliqué le stepper.
create or replace function public.derive_etape_affectation(p_affectation_id uuid)
returns text language sql stable set search_path to 'public' as $$
  with af as (select * from public.affectations where id = p_affectation_id),
  depuis_historique as (
    select s.statut_artisan as e
    from public.suivis s, af
    where s.affectation_id = af.id
      and s.statut_artisan in ('contacte','rdv_pris','devis_envoye','devis_signe','termine')
    order by public.rang_etape(s.statut_artisan) desc
    limit 1
  ),
  depuis_faits as (
    select case
      when (select montant_devis_signe is not null or devis_signe_url is not null from af)
        then 'devis_signe'
      when (select montant_devis is not null or devis_url is not null from af)
        then 'devis_envoye'
      else null end as e
  )
  select case
    when public.rang_etape((select e from depuis_faits))
       > public.rang_etape((select e from depuis_historique))
    then (select e from depuis_faits)
    else (select e from depuis_historique)
  end;
$$;

-- ---------- 4. Remplissage initial, à partir des faits uniquement ----------
update public.affectations af
   set etape = public.derive_etape_affectation(af.id)
 where af.etape is null;

-- Issue : dérivée de l'état courant, sans jamais perdre un dossier gagné.
update public.affectations af
   set issue = case
     when af.statut = 'perdu' or af.retire_at is not null then 'perdu'
     when af.statut in ('devis_signe','termine')
       or af.montant_devis_signe is not null              then 'gagne'
     else 'en_cours' end
 where af.issue = 'en_cours';

-- Drapeau « en attente » : préservé comme information secondaire au lieu
-- d'être jeté. C'est précisément la donnée que l'ancien modèle écrasait.
update public.affectations af
   set en_attente_depuis = coalesce(af.updated_at, now())
 where af.statut = 'en_attente' and af.en_attente_depuis is null;

create index if not exists idx_affectations_etape on public.affectations (artisan_id, etape);
create index if not exists idx_affectations_issue on public.affectations (artisan_id, issue);
create index if not exists idx_affectations_rappel on public.affectations (rappel_le)
  where rappel_le is not null;
