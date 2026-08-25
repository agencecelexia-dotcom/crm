-- Un artisan qui corrige son étape doit être suivi, même en arrière.
--
-- LE PROBLÈME
--
-- `sync_statut_projet` est monotone : elle ne fait avancer un projet, jamais
-- reculer. La règle protège d'un cas réel — le retrait d'un artisan ne doit pas
-- ramener un projet « devis envoyé » à « nouveau ».
--
-- Mais elle empêche aussi la correction d'une erreur de saisie. Constaté sur le
-- chantier `francisco carneiro` : l'artisan avait cliqué « devis signé » par
-- erreur, puis rectifié en « devis envoyé ». L'affectation portait bien
-- `devis_envoye`, le projet restait `devis_signe`, et 783,96 € de commission
-- étaient comptés sur une affaire jamais signée.
--
-- LA DISTINCTION
--
-- Reculer parce qu'un artisan SE RETIRE : interdit, le projet garde son
-- avancement. Reculer parce qu'un artisan CORRIGE son étape : autorisé, c'est
-- lui qui sait où en est son chantier.
--
-- La différence tient à `retire_at` : la synchronisation ne considère que les
-- affectations vivantes. Si la plus avancée d'entre elles recule, c'est une
-- correction — et le projet doit suivre, chiffres compris.

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
begin
  select statut into v_actuel
    from public.projets
   where id = v_projet_id
   for update;

  if not found or public.statut_projet_verrouille(v_actuel) then
    return coalesce(new, old);
  end if;

  -- Affectation la plus avancée, hors retraits.
  select af.statut into v_max
    from public.affectations af
   where af.projet_id = v_projet_id
     and af.retire_at is null
   order by public.rang_statut(af.statut) desc
   limit 1;

  if v_max is null then
    return coalesce(new, old);
  end if;

  -- Un artisan qui MODIFIE son étape en arrière corrige une erreur : le projet
  -- doit le suivre. On l'identifie au fait que l'affectation change de statut
  -- sans être retirée — à distinguer d'un retrait, où l'affectation disparaît
  -- du calcul et où le projet doit garder son avancement.
  if tg_op = 'UPDATE'
     and new.retire_at is null
     and new.statut is distinct from old.statut
     and public.rang_statut(new.statut) < public.rang_statut(old.statut) then
    v_recul := true;
  end if;

  if public.rang_statut(v_max) > public.rang_statut(v_actuel)
     or (v_recul and public.rang_statut(v_max) < public.rang_statut(v_actuel)) then

    update public.projets
       set statut = v_max,
           -- Sortir de « signé » efface ce qui n'a plus lieu d'être : le montant
           -- signé, la date, l'encaissement. `commission` étant une colonne
           -- calculée sur `montant_devis_signe`, elle retombe seule à zéro.
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

comment on function public.sync_statut_projet() is
  'Aligne le statut du projet sur son affectation la plus avancée. Avance '
  'toujours ; ne recule QUE si un artisan corrige lui-même son étape sans se '
  'retirer. Sortir de « signé » efface montant signé, date et encaissement — '
  'la commission, colonne calculée, retombe seule.';

-- ---------- L'affectation doit suivre le même mouvement ----------
--
-- `appliquer_etape` refusait tout recul : « un clic sur une étape antérieure ne
-- détruit plus l'avancement acquis ». La règle protège d'un clic accidentel,
-- mais interdit la correction volontaire — c'est le cas rencontré.
--
-- On la conserve à l'identique, en ajoutant le seul cas manquant : redescendre
-- SOUS la signature. Le reste du comportement (drapeaux d'attente, perte,
-- rappel) est intact.

create or replace function public.appliquer_etape(p_affectation_id uuid, p_statut text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare af public.affectations;
begin
  select * into af from public.affectations where id = p_affectation_id;
  if af.id is null then return; end if;

  -- Drapeaux secondaires : ils n'écrasent plus l'étape.
  if p_statut = 'en_attente' then
    update public.affectations
       set en_attente_depuis = coalesce(en_attente_depuis, now())
     where id = af.id;
    return;
  end if;

  if p_statut = 'perdu' then
    update public.affectations set issue = 'perdu' where id = af.id;
    return;
  end if;

  -- Étape réelle : on ne garde que si elle AVANCE...
  if public.rang_etape(p_statut) > public.rang_etape(af.etape) then
    update public.affectations set etape = p_statut where id = af.id;

  -- ...SAUF pour annuler une signature. Un artisan qui repasse sous
  -- « devis signé » corrige une erreur : l'affaire n'est pas signée, et son
  -- montant signé n'a plus lieu d'être.
  elsif public.rang_etape(af.etape) >= public.rang_etape('devis_signe')
    and public.rang_etape(p_statut) < public.rang_etape('devis_signe') then
    update public.affectations
       set etape = p_statut,
           montant_devis_signe = null,
           devis_signe_url = null
     where id = af.id;
  end if;

  -- Repartir sur une étape active lève le drapeau d'attente et la perte.
  update public.affectations
     set en_attente_depuis = null,
         rappel_le = case when p_statut = 'rdv_pris' then null else rappel_le end,
         issue = case
           when p_statut in ('devis_signe','termine') then 'gagne'
           when issue = 'perdu' then 'en_cours'
           -- Sortir de la signature remet l'affaire en jeu : la laisser
           -- « gagnée » fausserait tous les compteurs.
           when issue = 'gagne'
            and public.rang_etape(p_statut) < public.rang_etape('devis_signe')
             then 'en_cours'
           else issue end
   where id = af.id;
end;
$function$;

-- ---------- Rattrapage du cas constaté ----------
--
-- Ordre important : l'affectation d'abord, le projet ensuite. Le projet lit
-- l'affectation, l'inverse n'est pas vrai.
--
-- `etape` doit être corrigée en même temps que `statut` : elle était restée à
-- `devis_signe` alors que l'artisan avait rectifié en `devis_envoye`, ce qui
-- laissait l'affaire comptée comme gagnée.

update public.affectations af
   set etape = af.statut,
       issue = 'en_cours',
       montant_devis_signe = null,
       -- Le devis signé déposé n'a plus d'objet : le conserver ferait rebasculer
       -- le projet en « signé » au prochain passage du trigger 0077.
       devis_signe_url = null
  from public.projets p
 where p.id = af.projet_id
   and af.retire_at is null
   and p.deleted_at is null
   and public.rang_etape(af.etape) >= public.rang_etape('devis_signe')
   and public.rang_statut(af.statut) < public.rang_statut('devis_signe')
   -- Une commission encaissée relève d'une décision comptable, pas d'une
   -- correction automatique.
   and not coalesce(p.commission_encaissee, false);

update public.projets p
   set statut = af.statut,
       montant_devis_signe = null,
       date_signature = null,
       commission_encaissee = false
  from public.affectations af
 where af.projet_id = p.id
   and af.retire_at is null
   and p.deleted_at is null
   and p.statut = 'devis_signe'
   and public.rang_statut(af.statut) < public.rang_statut('devis_signe')
   and not coalesce(p.commission_encaissee, false)
   -- L'affectation retenue doit être la plus avancée du projet, sinon un
   -- artisan en retard ferait reculer un chantier réellement signé.
   and af.id = (
     select af2.id from public.affectations af2
      where af2.projet_id = p.id and af2.retire_at is null
      order by public.rang_statut(af2.statut) desc limit 1
   );
