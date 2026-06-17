-- 0038 — Rehausse les estimations de CONSTRUCTION (neuf), trop basses.
-- Piscine creusée/coque neuve, extension, rénovation complète = gros budgets.

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
  if d ~ 'terrassement|enrochement|soutènement|nivellement|déblai' then return 12000; end if;
  if d ~ 'extension|surélévation|agrandissement' then return 45000; end if;
  if d ~ 'rénovation complète|rénovation totale|maison entière' then return 40000; end if;
  -- construction d'une piscine, quelle que soit la formulation
  if m = 'Piscine' and d ~ 'construi|construc|creus|enterrée|enterree|faire une piscine|nouvelle piscine|création|cr[ée]ation|coque' then
    return 35000;
  end if;

  case m
    when 'Piscine' then
      if d ~ 'volet|abri|couverture' then return 6000;
      elsif d ~ 'chauffage|pompe à chaleur|pac|réchauff' then return 4000;
      elsif d ~ 'margelle|carrelage|plage' then return 3000;
      elsif d ~ 'liner|étanchéité|membrane' then return 4000;
      elsif d ~ 'local technique|filtration|électrolyseur' then return 2000;
      elsif d ~ 'pompe|moteur|surpresseur' then return 1200;
      elsif d ~ 'buse|refoulement|skimmer|fuite|joint' then return 1500;
      elsif d ~ 'transat|mobilier|robot|entretien|nettoy' then return 800;
      else return 2000; end if;

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
      if d ~ 'réfection|refaire|toiture complète|toiture entière|charpente neuve' then return 15000;
      elsif d ~ 'charpente|poutre|structure' then return 5000;
      elsif d ~ 'isolation|combles' then return 3500;
      elsif d ~ 'velux|fenêtre de toit' then return 2500;
      elsif d ~ 'gouttière|zinguerie|chéneau' then return 1500;
      elsif d ~ 'démoussage|nettoyage|fuite' then return 1000;
      else return 6000; end if;

    when 'Maçonnerie' then
      if d ~ 'mur porteur|ouverture' then return 6000;
      elsif d ~ 'dalle|chape' then return 5000;
      elsif d ~ 'fondation|terrasse' then return 8000;
      elsif d ~ 'poutre|mezzanine|reprise' then return 3000;
      elsif d ~ 'enduit|façade|ravalement' then return 8000;
      else return 10000; end if;

    when 'Menuiserie' then
      if d ~ 'véranda' then return 18000;
      elsif d ~ 'escalier|parquet|sol' then return 4500;
      elsif d ~ 'fenêtre|baie' then return 5000;
      elsif d ~ 'dressing|placard|aménagement' then return 3000;
      elsif d ~ 'volet|store' then return 2500;
      elsif d ~ 'protection|sas|sur-mesure' then return 1800;
      elsif d ~ 'porte' then return 900;
      else return 2500; end if;

    when 'Isolation' then
      if d ~ 'extérieure|ite' then return 15000;
      elsif d ~ 'combles' then return 3500;
      else return 5000; end if;

    when 'CVC', 'Plomberie' then
      if d ~ 'pompe à chaleur|pac|climatisation|clim' then return 9000;
      elsif d ~ 'chaudière|plancher chauffant' then return 7000;
      elsif d ~ 'salle de bain|cuisine' then return 6000;
      elsif d ~ 'chauffe-eau|ballon|fuite|robinet' then return 1200;
      else return 3000; end if;

    when 'Électricité' then
      if d ~ 'rénovation|mise aux normes|tableau|installation complète' then return 5000;
      elsif d ~ 'borne|recharge|domotique' then return 1800;
      elsif d ~ 'lustre|luminaire|ventilateur|spot|éclairage|prise' then return 1000;
      else return 2000; end if;

    when 'Rénovation' then
      return 20000;

    else
      return 2500;
  end case;
end;
$$;
