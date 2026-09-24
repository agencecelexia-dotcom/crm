-- L'argent ne se déclare plus n'importe comment, et un projet suit ses artisans.
--
-- Quatre défauts prouvés par l'audit CRM en transaction annulée.
--
-- 1. UN COMMERCIAL POUVAIT SE CRÉER UNE RÉTROCESSION. La politique de
--    modification des projets ne restreint aucune colonne : un commercial sans
--    droit sur les commissions posait `montant_devis_signe = 1 000 000`,
--    `taux_commission = 0,5`, `commission_encaissee = true`, et
--    `generer_retrocession` lui versait sa part. Désormais, ces colonnes ne se
--    modifient À LA MAIN qu'avec le droit de voir les commissions. Les triggers
--    qui les recalculent (signature déclarée par un artisan, synchronisation)
--    passent toujours : on ne bloque que la modification directe, repérée par
--    `pg_trigger_depth() = 1`.
--
-- 2. UN ARTISAN QUI PERD GELAIT TOUT LE PROJET. « perdu » ayant le rang le plus
--    élevé, `sync_statut_projet` en faisait le statut du projet dès qu'un seul
--    artisan le déclarait — et « perdu » est verrouillé. Si un confrère signait
--    ensuite 20 000 €, le projet restait « perdu ». Le projet prend maintenant le
--    statut le plus avancé des artisans ENCORE EN COURSE ; il n'est perdu que si
--    tous le sont. Et une signature lève le verrou « perdu » : une affaire signée
--    n'est pas une affaire perdue.
--
-- 3. L'ANCIEN ARTISAN TOUCHAIT LE GAIN DU NOUVEAU. `projets.artisan_id` n'était
--    posé que s'il était vide : après une réattribution il désignait l'artisan
--    perdu, qui recevait le montant signé de son confrère et passait « gagné ».
--    Deux gagnants pour une signature. L'artisan du projet devient celui qui
--    signe dès que le titulaire n'est plus en course, et le montant signé n'est
--    jamais recopié sur une affectation perdue.
--
-- 4. LES ALERTES N'ATTEIGNAIENT PERSONNE, LES TÂCHES LIBRES ÉCHOUAIENT. Les
--    politiques exigent `projet_id in mes_projets()` : une ligne sans projet est
--    refusée même au fondateur. 34 alertes de cohérence et 2 alertes
--    d'assurance n'ont jamais été vues ; aucune tâche sans projet n'a pu être
--    créée depuis le 21 août.
--
-- Et : supprimer une affectation exige le même droit que la créer.

-- ---------- 1. La garde sur l'argent ----------

create or replace function public.trg_garde_argent_projet()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Seule la modification DIRECTE par un membre connecté est contrôlée : les
  -- recalculs déclenchés par d'autres triggers, et les fonctions appelées par
  -- les artisans (rôle anon), gardent la main.
  if pg_trigger_depth() > 1 or coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if public.est_fondateur() or public.a_le_droit('peut_voir_commissions') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.montant_devis_signe is not null or coalesce(new.commission_encaissee, false)
       or new.date_signature is not null then
      raise exception 'Seul un membre habilité aux commissions peut déclarer un montant signé.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.montant_devis_signe is distinct from old.montant_devis_signe
     or new.taux_commission is distinct from old.taux_commission
     or new.commission_encaissee is distinct from old.commission_encaissee
     or new.date_signature is distinct from old.date_signature then
    raise exception 'Seul un membre habilité aux commissions peut modifier le montant signé, le taux ou l''encaissement.'
      using errcode = '42501';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_garde_argent_projet on public.projets;
create trigger trg_garde_argent_projet
  before insert or update on public.projets
  for each row execute function public.trg_garde_argent_projet();

-- ---------- 2. Le statut du projet suit les artisans encore en course ----------

create or replace function public.sync_statut_projet()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_projet_id uuid := coalesce(new.projet_id, old.projet_id);
  v_max text;
  v_actuel text;
  v_recul boolean := false;
  v_en_course int;
  v_perdues int;
begin
  select statut into v_actuel
    from public.projets
   where id = v_projet_id
   for update;
  if not found then return coalesce(new, old); end if;

  -- Le plus avancé des artisans ENCORE EN COURSE (ni retirés, ni perdus).
  select af.statut into v_max
    from public.affectations af
   where af.projet_id = v_projet_id
     and af.retire_at is null
     and af.statut not in ('perdu', 'mort')
   order by public.rang_statut(af.statut) desc
   limit 1;

  select count(*) filter (where statut not in ('perdu', 'mort')),
         count(*) filter (where statut in ('perdu', 'mort'))
    into v_en_course, v_perdues
    from public.affectations
   where projet_id = v_projet_id and retire_at is null;

  -- Perdu seulement quand TOUS les artisans en lice l'ont perdu.
  if v_en_course = 0 then
    if v_perdues > 0 and not public.statut_projet_verrouille(v_actuel) then
      update public.projets set statut = 'perdu' where id = v_projet_id;
    end if;
    return coalesce(new, old);
  end if;

  -- Un projet verrouillé ne bouge plus — sauf « perdu » devant une signature :
  -- une affaire signée par un confrère n'est pas une affaire perdue.
  if public.statut_projet_verrouille(v_actuel)
     and not (v_actuel = 'perdu' and public.rang_statut(v_max) >= public.rang_statut('devis_signe')) then
    return coalesce(new, old);
  end if;

  -- Le projet redescend dans deux cas : l'artisan corrige son étape en arrière,
  -- ou il SORT de la course (perdu, retrait) — un signataire qui annule ne doit
  -- pas laisser le projet « signé », avec son montant et une commission due.
  if tg_op = 'UPDATE'
     and new.statut is distinct from old.statut
     and (
       (new.retire_at is null and new.statut not in ('perdu', 'mort')
        and public.rang_statut(new.statut) < public.rang_statut(old.statut))
       or (new.statut in ('perdu', 'mort') and old.statut not in ('perdu', 'mort'))
     ) then
    v_recul := true;
  end if;
  if tg_op = 'UPDATE' and new.retire_at is not null and old.retire_at is null then
    v_recul := true;
  end if;

  if v_actuel = 'perdu'
     or public.rang_statut(v_max) > public.rang_statut(v_actuel)
     or (v_recul and public.rang_statut(v_max) < public.rang_statut(v_actuel)) then
    update public.projets
       set statut = v_max,
           montant_devis_signe = case
             when public.rang_statut(v_max) < public.rang_statut('devis_signe')
               then null else montant_devis_signe end,
           date_signature = case
             when public.rang_statut(v_max) < public.rang_statut('devis_signe')
               then null else date_signature end,
           commission_encaissee = case
             when public.rang_statut(v_max) < public.rang_statut('devis_signe')
               then false else commission_encaissee end
     where id = v_projet_id;
  end if;

  return coalesce(new, old);
end;
$function$;

-- ---------- 3. Le gain va à celui qui signe ----------

-- Le titulaire enregistré sur le projet est-il encore en course ?
create or replace function public.titulaire_en_course(p_projet_id uuid, p_artisan_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_artisan_id is not null and exists (
    select 1 from public.affectations
     where projet_id = p_projet_id and artisan_id = p_artisan_id
       and retire_at is null and statut not in ('perdu', 'mort')
  );
$function$;

create or replace function public.trg_montant_projet_vers_affectation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.montant_devis_signe is null
     or new.montant_devis_signe is not distinct from old.montant_devis_signe then
    return new;
  end if;

  update public.affectations af
     set montant_devis_signe = new.montant_devis_signe
   where af.projet_id = new.id
     and af.artisan_id = new.artisan_id      -- uniquement le gagnant
     and af.retire_at is null
     and af.statut not in ('perdu', 'mort')  -- jamais sur un artisan qui a perdu
     and af.montant_devis_signe is null;     -- ne jamais écraser sa saisie

  return new;
end;
$function$;

create or replace function public.sync_montant_affectation_projet()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.statut = 'devis_signe'
     and new.montant_devis_signe is not null
     and (new.montant_devis_signe is distinct from old.montant_devis_signe
          or new.statut is distinct from old.statut)
  then
    update public.projets p
       set montant_devis_signe = new.montant_devis_signe,
           artisan_id = case
             when public.titulaire_en_course(p.id, p.artisan_id) then p.artisan_id
             else new.artisan_id end
     where p.id = new.projet_id
       -- Ne jamais écraser le montant d'un confrère ENCORE EN COURSE et déjà gagnant.
       and (p.montant_devis_signe is null
            or p.artisan_id = new.artisan_id
            or not public.titulaire_en_course(p.id, p.artisan_id));
  end if;
  return new;
end;
$function$;

create or replace function public.trg_chainer_commission()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_montant numeric;
begin
  if new.issue <> 'gagne' then return new; end if;

  v_montant := coalesce(new.montant_devis_signe, new.montant_devis);
  if v_montant is null then return new; end if;

  update public.projets p
     set montant_devis_signe = v_montant,
         -- Le titulaire devient celui qui signe, dès que l'ancien n'est plus en course.
         artisan_id = case
           when public.titulaire_en_course(p.id, p.artisan_id) then p.artisan_id
           else new.artisan_id end,
         taux_commission = case
           when p.taux_commission = 0.10 and p.montant_devis_signe is null
             then coalesce((select a.taux_commission from public.artisans a
                             where a.id = new.artisan_id), p.taux_commission)
           else p.taux_commission end
   where p.id = new.projet_id
     and (p.artisan_id is null
          or p.artisan_id = new.artisan_id
          or not public.titulaire_en_course(p.id, p.artisan_id))
     and (p.montant_devis_signe is null or p.montant_devis_signe <> v_montant);

  return new;
end;
$function$;

-- ---------- 4. Les lignes sans projet, et la suppression ----------

drop policy if exists notifications_par_projet on public.notifications;
create policy notifications_par_projet on public.notifications
  for all to authenticated
  using (projet_id in (select public.mes_projets()) or (projet_id is null and public.est_fondateur()))
  with check (projet_id in (select public.mes_projets()) or (projet_id is null and public.est_fondateur()));

drop policy if exists taches_par_projet on public.taches;
create policy taches_par_projet on public.taches
  for all to authenticated
  using (projet_id in (select public.mes_projets()) or (projet_id is null and public.est_fondateur()))
  with check (projet_id in (select public.mes_projets()) or (projet_id is null and public.est_fondateur()));

drop policy if exists affectations_suppression on public.affectations;
create policy affectations_suppression on public.affectations
  for delete
  using (public.a_le_droit('peut_attribuer') and projet_id in (select public.mes_projets()));
