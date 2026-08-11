-- ============================================================
--  0074 — P0 : maintenir etape/issue à jour, et supprimer la régression.
--
--  0073 a posé le modèle et l'a rempli depuis l'historique. Sans cette
--  migration, il se désynchroniserait dès la première action de l'artisan.
--
--  Trois garanties apportées ici :
--   1. l'étape ne RECULE JAMAIS toute seule (c'est la cause racine du bug :
--      cliquer « En attente » après un RDV effaçait le RDV) ;
--   2. « en attente » et « à rappeler » deviennent des drapeaux datés, écrits
--      À CÔTÉ de l'étape et non plus à sa place ;
--   3. `statut` reste synchronisé pour tout le code existant.
--
--  add_suivi_by_token est RÉGÉNÉRÉE depuis la base puis patchée, afin de ne
--  pas perdre les couches accumulées (whitelist artisan, perdu_at, webhook
--  n8n, réassignation quand plus aucun artisan n'est actif).
-- ============================================================

-- ---------- 1. Avancer un dossier, sans jamais le faire reculer ----------
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

  -- Étape réelle : on ne garde que si elle AVANCE. Un clic sur une étape
  -- antérieure ne détruit plus l'avancement déjà acquis.
  if public.rang_etape(p_statut) > public.rang_etape(af.etape) then
    update public.affectations set etape = p_statut where id = af.id;
  end if;

  -- Repartir sur une étape active lève le drapeau d'attente et la perte.
  update public.affectations
     set en_attente_depuis = null,
         rappel_le = case when p_statut = 'rdv_pris' then null else rappel_le end,
         issue = case
           when p_statut in ('devis_signe','termine') then 'gagne'
           when issue = 'perdu' then 'en_cours'
           else issue end
   where id = af.id;
end;
$function$;

revoke execute on function public.appliquer_etape(uuid, text) from public, anon;
grant  execute on function public.appliquer_etape(uuid, text) to authenticated, service_role;

-- ---------- 2. Correction explicite d'étape (retour arrière assumé) ----------
-- L'étape ne recule jamais seule, mais l'artisan doit pouvoir corriger une
-- erreur de saisie. Action explicite, tracée, jamais un effet de bord.
create or replace function public.corriger_etape_by_token(p_token text, p_etape text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  if p_etape is not null and p_etape not in
     ('contacte','rdv_pris','devis_envoye','devis_signe','termine') then
    return json_build_object('ok', false, 'error', 'etape_invalide');
  end if;

  -- Garde-fou : on ne rétrograde pas un dossier dont le devis signé est déposé.
  if af.devis_signe_url is not null
     and public.rang_etape(p_etape) < public.rang_etape('devis_signe') then
    return json_build_object('ok', false, 'error', 'devis_signe_depose');
  end if;

  update public.affectations
     set etape = p_etape,
         issue = case when p_etape in ('devis_signe','termine') then 'gagne'
                      when issue = 'gagne' then 'en_cours' else issue end
   where id = af.id;

  insert into public.suivis (projet_id, affectation_id, auteur, type, message)
  values (af.projet_id, af.id, 'artisan', 'note',
          'Étape corrigée manuellement : ' || coalesce(p_etape, 'aucune'));

  return json_build_object('ok', true, 'etape', p_etape);
end;
$function$;

revoke execute on function public.corriger_etape_by_token(text, text) from public;
grant  execute on function public.corriger_etape_by_token(text, text) to anon, authenticated;

-- ---------- 3. Rappel daté ----------
-- Le bouton « À rappeler » n'acceptait aucune date : l'artisan écrivait
-- « rappeler 12h30 le 11/08 » en note libre, donc inexploitable.
create or replace function public.definir_rappel_by_token(p_token text, p_quand timestamptz)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if p_quand is not null and p_quand < now() - interval '1 day' then
    return json_build_object('ok', false, 'error', 'date_passee');
  end if;

  update public.affectations set rappel_le = p_quand where id = af.id;

  insert into public.suivis (projet_id, affectation_id, auteur, type, message)
  values (af.projet_id, af.id, 'artisan', 'note',
          case when p_quand is null then 'Rappel annulé'
               else 'Rappel programmé le ' ||
                    to_char(p_quand at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI') end);

  return json_build_object('ok', true);
end;
$function$;

revoke execute on function public.definir_rappel_by_token(text, timestamptz) from public;
grant  execute on function public.definir_rappel_by_token(text, timestamptz) to anon, authenticated;

-- ---------- 4. Brancher add_suivi_by_token sur le nouveau modèle ----------
-- Un trigger plutôt qu'une réécriture de la fonction : elle porte déjà
-- plusieurs couches (whitelist, perdu_at, webhook, réassignation) qu'une
-- réécriture risquerait de perdre. Le trigger se contente d'entretenir les
-- deux nouveaux axes à chaque changement de statut.
create or replace function public.trg_maj_etape_issue()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.statut is distinct from old.statut then
    perform public.appliquer_etape(new.id, new.statut);
  end if;

  -- Les faits priment toujours sur les déclarations : un devis déposé fait
  -- foi, même si l'artisan n'a jamais touché au stepper.
  if new.montant_devis_signe is distinct from old.montant_devis_signe
     or new.devis_signe_url is distinct from old.devis_signe_url then
    if new.montant_devis_signe is not null or new.devis_signe_url is not null then
      perform public.appliquer_etape(new.id, 'devis_signe');
    end if;
  elsif new.montant_devis is distinct from old.montant_devis
     or new.devis_url is distinct from old.devis_url then
    if new.montant_devis is not null or new.devis_url is not null then
      perform public.appliquer_etape(new.id, 'devis_envoye');
    end if;
  end if;

  if new.retire_at is not null and old.retire_at is null then
    update public.affectations set issue = 'perdu' where id = new.id;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_maj_etape_issue on public.affectations;
create trigger trg_maj_etape_issue
  after update on public.affectations
  for each row execute function public.trg_maj_etape_issue();

-- Nouvelle affectation : dossier neuf, aucune étape franchie.
create or replace function public.trg_init_etape_issue()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  new.etape := null;
  new.issue := 'en_cours';
  return new;
end;
$function$;

drop trigger if exists trg_init_etape_issue on public.affectations;
create trigger trg_init_etape_issue
  before insert on public.affectations
  for each row execute function public.trg_init_etape_issue();
