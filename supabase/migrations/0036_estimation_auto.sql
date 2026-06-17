-- 0036 — Estimation interne AUTOMATIQUE à la création d'un projet.
-- Règles : métier + mots-clés de la description → ordre de grandeur (€ TTC).
-- Ne s'applique que si estimation_interne n'a pas été renseignée manuellement.

create or replace function public.estimer_projet(
  p_metier text, p_metiers text[], p_description text
) returns numeric
language plpgsql immutable as $$
declare
  d text := lower(coalesce(p_description, ''));
  m text := coalesce(
    nullif(p_metier, ''),
    case when array_length(p_metiers, 1) > 0 then p_metiers[1] else '' end
  );
begin
  -- Signaux forts indépendants du métier
  if d ~ 'terrassement|enrochement|soutènement|nivellement|déblai' then return 12000; end if;
  if d ~ 'extension|surélévation|agrandissement' then return 30000; end if;
  if d ~ 'rénovation complète|rénovation totale|maison entière' then return 25000; end if;

  case m
    when 'Piscine' then
      if d ~ 'coque|enterrée|construction|création|neuve' then return 25000;
      elsif d ~ 'volet|abri|couverture' then return 6000;
      elsif d ~ 'chauffage|pompe à chaleur|pac|réchauff' then return 4000;
      elsif d ~ 'margelle|carrelage|plage' then return 3000;
      elsif d ~ 'liner|étanchéité|membrane' then return 2500;
      elsif d ~ 'local technique|filtration|électrolyseur' then return 2000;
      elsif d ~ 'pompe|moteur|surpresseur' then return 1200;
      elsif d ~ 'buse|refoulement|skimmer|fuite|joint' then return 900;
      elsif d ~ 'transat|mobilier|robot|entretien|nettoy' then return 800;
      else return 1500; end if;

    when 'Clôture', 'Portail' then
      if d ~ 'portail|coulissant|battant|motoris' then return 3500;
      elsif d ~ 'mur|muret|béton' then return 6000;
      elsif d ~ 'portillon|garde-corps' then return 1500;
      else return 4000; end if;

    when 'Paysagisme', 'Terrasse' then
      if d ~ 'terrasse|composite|dalle|carrelage' then return 6000;
      elsif d ~ 'pergola|store|tonnelle' then return 2500;
      elsif d ~ 'pavage|allée|enrobé' then return 2500;
      elsif d ~ 'engazonnement|pelouse|gazon|plantation' then return 2000;
      elsif d ~ 'élagage|abattage|entretien|taille' then return 1200;
      else return 3000; end if;

    when 'Couverture', 'Toiture' then
      if d ~ 'réfection|refaire|toiture complète|toiture entière' then return 12000;
      elsif d ~ 'charpente|poutre|structure' then return 4000;
      elsif d ~ 'isolation|combles' then return 3500;
      elsif d ~ 'velux|fenêtre de toit' then return 2500;
      elsif d ~ 'gouttière|zinguerie|chéneau' then return 1500;
      elsif d ~ 'démoussage|nettoyage|fuite' then return 1000;
      else return 5000; end if;

    when 'Maçonnerie' then
      if d ~ 'mur porteur|ouverture' then return 6000;
      elsif d ~ 'dalle|chape' then return 5000;
      elsif d ~ 'fondation|terrasse' then return 8000;
      elsif d ~ 'poutre|mezzanine|reprise' then return 3000;
      elsif d ~ 'enduit|façade|ravalement' then return 6000;
      else return 8000; end if;

    when 'Menuiserie' then
      if d ~ 'véranda' then return 15000;
      elsif d ~ 'escalier|parquet|sol' then return 4500;
      elsif d ~ 'fenêtre|baie' then return 4000;
      elsif d ~ 'dressing|placard|aménagement' then return 3000;
      elsif d ~ 'volet|store' then return 2500;
      elsif d ~ 'protection|sas|sur-mesure' then return 1800;
      elsif d ~ 'porte' then return 900;
      else return 2500; end if;

    when 'Isolation' then
      if d ~ 'extérieure|ite' then return 12000;
      elsif d ~ 'combles' then return 3500;
      else return 4000; end if;

    when 'CVC', 'Plomberie' then
      if d ~ 'pompe à chaleur|pac|climatisation|clim' then return 8000;
      elsif d ~ 'chaudière|plancher chauffant' then return 6000;
      elsif d ~ 'salle de bain|cuisine' then return 5000;
      elsif d ~ 'chauffe-eau|ballon|fuite|robinet' then return 1200;
      else return 3000; end if;

    when 'Électricité' then
      if d ~ 'rénovation|mise aux normes|tableau|installation complète' then return 4000;
      elsif d ~ 'borne|recharge|domotique' then return 1500;
      elsif d ~ 'lustre|luminaire|ventilateur|spot|éclairage|prise' then return 1000;
      else return 1500; end if;

    when 'Rénovation' then
      if d ~ 'cuisine|salle de bain' then return 12000;
      else return 12000; end if;

    else
      return 2500; -- métier inconnu / non renseigné
  end case;
end;
$$;

-- Déclencheur : remplit estimation_interne si elle est vide à l'insertion.
create or replace function public.trg_estimation_auto() returns trigger
language plpgsql as $$
begin
  if new.estimation_interne is null then
    new.estimation_interne := public.estimer_projet(new.metier, new.metiers, new.description);
  end if;
  return new;
end;
$$;

drop trigger if exists estimation_auto on public.projets;
create trigger estimation_auto
  before insert on public.projets
  for each row execute function public.trg_estimation_auto();
