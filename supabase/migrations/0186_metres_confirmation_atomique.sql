-- Même garde pour les corrections unitaires et les confirmations groupées.
create or replace function public.corriger_metrage_by_token(
  p_token text, p_affectation_token text, p_cle text, p_unite text, p_valeur numeric, p_note text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_artisan uuid;
  af public.affectations;
  v_unite text;
  v_erreur text;
begin
  v_erreur := public.acces_suivi_par_jeton(p_affectation_token);
  if v_erreur is not null then
    return json_build_object('ok', false, 'error', v_erreur);
  end if;
  select id into v_artisan from public.artisans where token = p_token and ecarte_at is null;
  if v_artisan is null then
    return json_build_object('ok', false, 'error', 'token_invalide');
  end if;
  select * into af from public.affectations where token = p_affectation_token;
  if af.id is null or af.artisan_id <> v_artisan then
    return json_build_object('ok', false, 'error', 'chantier_introuvable');
  end if;
  if p_cle is null or p_cle !~ '^[a-z_]{2,40}$'
     or p_unite is null or p_unite not in ('m2', 'ml', 'm', 'pct', 'u', 'oui_non') then
    return json_build_object('ok', false, 'error', 'quantite_invalide');
  end if;
  if p_valeur is null or p_valeur < 0 or p_valeur > 100000 then
    return json_build_object('ok', false, 'error', 'valeur_invalide');
  end if;
  select unite into v_unite from public.metrage_chantier where projet_id = af.projet_id and cle = p_cle;
  if v_unite is not null and v_unite <> p_unite then
    return json_build_object('ok', false, 'error', 'quantite_invalide');
  end if;

  insert into public.metrage_chantier (projet_id, cle, unite, statut, valeur_retenue, retenue_par, retenue_le, note)
  values (af.projet_id, p_cle, p_unite, 'confirme', p_valeur, 'artisan', now(),
          coalesce(nullif(left(trim(p_note), 500), ''), 'Mesuré sur place'))
  on conflict (projet_id, cle) do update
     set statut = 'confirme', valeur_retenue = excluded.valeur_retenue, retenue_par = 'artisan',
         retenue_le = now(), note = excluded.note;
  return json_build_object('ok', true);
end
$function$;


-- Une visite confirme un ensemble cohérent (brut, ouvertures, net, hauteur).
-- Toute erreur annule le lot entier, y compris les premiers upserts réussis.
create or replace function public.corriger_metrages_by_token(
  p_token text,
  p_affectation_token text,
  p_corrections jsonb,
  p_note text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_correction jsonb;
  v_resultat json;
  v_erreur text;
begin
  if p_corrections is null or jsonb_typeof(p_corrections) <> 'array' then
    return json_build_object('ok', false, 'error', 'quantite_invalide');
  end if;
  if jsonb_array_length(p_corrections) < 1 or jsonb_array_length(p_corrections) > 50 then
    return json_build_object('ok', false, 'error', 'quantite_invalide');
  end if;
  -- Le sous-bloc avec EXCEPTION crée un point de sauvegarde : lever l'erreur
  -- revient avant TOUS les appels de ce lot, puis fournit le refus métier.
  begin
    for v_correction in select value from jsonb_array_elements(p_corrections) loop
      if jsonb_typeof(v_correction) <> 'object'
         or jsonb_typeof(v_correction->'valeur') is distinct from 'number' then
        v_erreur := 'valeur_invalide';
        raise exception using errcode = 'P0001', message = v_erreur;
      end if;
      v_resultat := public.corriger_metrage_by_token(
        p_token, p_affectation_token,
        v_correction->>'cle', v_correction->>'unite',
        (v_correction->>'valeur')::numeric, p_note
      );
      if coalesce((v_resultat->>'ok')::boolean, false) is not true then
        v_erreur := coalesce(v_resultat->>'error', 'quantite_invalide');
        raise exception using errcode = 'P0001', message = v_erreur;
      end if;
    end loop;
  exception when raise_exception then
    return json_build_object('ok', false, 'error', coalesce(v_erreur, 'quantite_invalide'));
  end;
  return json_build_object('ok', true, 'nombre', jsonb_array_length(p_corrections));
end
$function$;

revoke execute on function public.corriger_metrages_by_token(text, text, jsonb, text) from public;
grant execute on function public.corriger_metrages_by_token(text, text, jsonb, text) to anon, authenticated;
