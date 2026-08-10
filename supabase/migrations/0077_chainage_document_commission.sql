-- ============================================================
--  0077 — P0-3/P0-4 : chaîner document → montant → étape → commission,
--         et poser les garde-fous sur les actions destructives.
--
--  CONSTAT (audit §7) : les quatre objets étaient indépendants. Déposer un
--  devis signé ne faisait rien avancer ; le montant, l'étape et la commission
--  se remplissaient séparément, à la main. C'est la cause mécanique des écarts
--  entre « Vendu », « Devis envoyés » et « Commission » dans la même page.
--
--  0074 a déjà branché document/montant → étape via trg_maj_etape_issue.
--  Ici on ferme la chaîne jusqu'à la commission, côté PROJET.
--
--  CONSTAT (audit §3) : « sur un chantier signé à 29 678 € avec acompte
--  encaissé, la pastille Perdu reste cliquable, sans confirmation. Un clic
--  détruit du CA et une commission. » → refus côté BASE, pas seulement en UI.
-- ============================================================

-- ---------- 1. Le montant signé de l'artisan gagnant alimente le projet ----------
-- Sans cela, `projets.montant_devis_signe` (assiette de la commission générée)
-- restait vide alors que l'affectation portait le montant : commission à 0 €
-- sur une affaire signée.
create or replace function public.trg_chainer_commission()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_montant numeric;
begin
  -- Ne remonter que depuis un dossier réellement gagné.
  if new.issue <> 'gagne' then return new; end if;

  v_montant := coalesce(new.montant_devis_signe, new.montant_devis);
  if v_montant is null then return new; end if;

  update public.projets p
     set montant_devis_signe = v_montant,
         artisan_id = coalesce(p.artisan_id, new.artisan_id),
         -- Le taux suit l'artisan gagnant s'il n'a jamais été arbitré.
         taux_commission = case
           when p.taux_commission = 0.10 and p.montant_devis_signe is null
             then coalesce((select a.taux_commission from public.artisans a
                             where a.id = new.artisan_id), p.taux_commission)
           else p.taux_commission end
   where p.id = new.projet_id
     -- Jamais écraser le montant d'un confrère déjà déclaré gagnant.
     and (p.artisan_id is null or p.artisan_id = new.artisan_id)
     and (p.montant_devis_signe is null or p.montant_devis_signe <> v_montant);

  return new;
end;
$function$;

drop trigger if exists trg_chainer_commission on public.affectations;
create trigger trg_chainer_commission
  after update on public.affectations
  for each row execute function public.trg_chainer_commission();

-- ---------- 2. Garde-fou : ne pas détruire une affaire signée ----------
-- L'artisan ne peut plus déclarer « perdu » ni se retirer d'un chantier dont
-- le devis signé est déposé ou dont la commission est déjà encaissée. Le refus
-- est en BASE : masquer le bouton ne suffit pas, l'API reste appelable.
create or replace function public.peut_abandonner_affectation(p_affectation_id uuid)
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when af.devis_signe_url is not null
      then json_build_object('ok', false, 'raison', 'devis_signe_depose')
    when p.commission_encaissee and p.artisan_id = af.artisan_id
      then json_build_object('ok', false, 'raison', 'commission_encaissee')
    when af.issue = 'gagne' and coalesce(af.montant_devis_signe, 0) > 0
      then json_build_object('ok', false, 'raison', 'affaire_signee',
                             'montant', af.montant_devis_signe)
    else json_build_object('ok', true)
  end
  from public.affectations af
  join public.projets p on p.id = af.projet_id
  where af.id = p_affectation_id;
$function$;

revoke execute on function public.peut_abandonner_affectation(uuid) from public;
grant  execute on function public.peut_abandonner_affectation(uuid) to anon, authenticated;

-- Blocage effectif, quel que soit le chemin d'appel.
create or replace function public.trg_garde_fou_abandon()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare v json;
begin
  -- On ne contrôle que les transitions vers un abandon.
  if not ((new.issue = 'perdu' and old.issue <> 'perdu')
          or (new.retire_at is not null and old.retire_at is null)) then
    return new;
  end if;

  v := public.peut_abandonner_affectation(old.id);
  if (v->>'ok')::boolean is false then
    raise exception 'abandon_refuse:%', v->>'raison'
      using hint = 'Ce chantier est signé ou sa commission est encaissée. '
                   'Passez par Celexia pour l''annuler.';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_garde_fou_abandon on public.affectations;
create trigger trg_garde_fou_abandon
  before update on public.affectations
  for each row execute function public.trg_garde_fou_abandon();

-- ---------- 3. Rendre le refus lisible côté artisan ----------
-- retirer_chantier_by_token levait une exception SQL brute. On renvoie un
-- message exploitable par l'interface plutôt qu'une erreur Postgres.
create or replace function public.retirer_chantier_by_token(p_token text, p_raison text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare af public.affectations; v_garde json; v_restants int;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if af.retire_at is not null then return json_build_object('ok', true, 'deja_retire', true); end if;

  if length(coalesce(btrim(p_raison), '')) < 5 then
    return json_build_object('ok', false, 'error', 'justification_requise');
  end if;

  -- Garde-fou métier, avant toute écriture.
  v_garde := public.peut_abandonner_affectation(af.id);
  if (v_garde->>'ok')::boolean is false then
    return json_build_object('ok', false, 'error', v_garde->>'raison');
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (af.projet_id, af.id, 'artisan', 'retrait', 'perdu', btrim(p_raison));

  update public.affectations
     set statut = 'perdu', retire_at = now(), issue = 'perdu'
   where id = af.id;

  select count(*) into v_restants
    from public.affectations af2
   where af2.projet_id = af.projet_id and af2.issue <> 'perdu' and af2.retire_at is null;

  if v_restants = 0 then
    update public.projets
       set statut = 'nouveau', artisan_id = null,
           montant_devis_signe = null, montant_devis = null
     where id = af.projet_id and statut <> 'mort';

    insert into public.notifications (type, titre, message, projet_id)
    values ('a_reassigner',
      'À réassigner : ' || coalesce((select client_nom from public.projets where id = af.projet_id), 'chantier'),
      'L''artisan s''est retiré. Raison : ' || btrim(p_raison), af.projet_id);
  end if;

  insert into public.notifications (type, titre, message, projet_id)
  values ('artisan_retrait',
    'Retrait artisan : ' || coalesce(
      (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id), 'artisan'),
    btrim(p_raison), af.projet_id);

  return json_build_object('ok', true, 'restants', v_restants);
end;
$function$;

revoke execute on function public.retirer_chantier_by_token(text, text) from public;
grant  execute on function public.retirer_chantier_by_token(text, text) to anon, authenticated;
