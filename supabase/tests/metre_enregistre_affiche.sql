-- ============================================================
--  Enregistré = affiché — à exécuter après toute migration qui touche
--  aire_polygone, longueur_ligne ou enregistrer_metre_by_token.
--
--  L'écran calcule une surface ; la base la recalcule à l'enregistrement.
--  Les valeurs attendues sont celles de l'écran pour les contours des jeux
--  d'essai LiDAR (tests/fixtures/metre-reference-sql.json, vérifiées côté
--  écran par tests/unit/metre-enregistre-affiche.test.ts).
--
--  Usage : psql -f supabase/tests/metre_enregistre_affiche.sql
-- ============================================================

do $$
declare r record; echecs int := 0; a numeric; p numeric;
begin
  for r in select * from (values
    ('abri-trop-petit', '[[7.33519597,48.65940675],[7.33526359,48.6594187],[7.33526063,48.65936656],[7.33519172,48.65935556],[7.33519448,48.65938879]]'::jsonb, 28.53, 21.88),
    ('accolee', '[[7.04786027,48.97330573],[7.04794348,48.97323269],[7.04809833,48.9733067],[7.04801792,48.97338054]]'::jsonb, 142.86, 48.47),
    ('croupe', '[[6.70870355,43.39078488],[6.70864277,43.39091485],[6.70855819,43.39094387],[6.70850914,43.3908726],[6.7085514,43.39085764],[6.70855575,43.39084848],[6.7085219,43.39084064],[6.70855,43.39077843],[6.70862139,43.390794],[6.70863567,43.39076649]]'::jsonb, 184.2, 61.92),
    ('deux-pans-raides', '[[-4.23026611,48.40835513],[-4.23024001,48.40823476],[-4.23010986,48.40824543],[-4.23013192,48.40836604]]'::jsonb, 133.14, 46.74),
    ('deux-pans-simple', '[[4.8703553,45.81760704],[4.87041973,45.81764561],[4.87052124,45.81756196],[4.8704581,45.81752337]]'::jsonb, 80.12, 37.56),
    ('mono-pente', '[[4.38169085,43.8587659],[4.38184738,43.85875762],[4.38189955,43.85875426],[4.38189732,43.85871379],[4.38184261,43.85871448],[4.38168972,43.85871912]]'::jsonb, 82.35, 43.19),
    ('dissymetrique', '[[6.06968463,45.94854294],[6.06973097,45.94853988],[6.06973286,45.94855064],[6.06978813,45.94854553],[6.06979834,45.94861285],[6.06978802,45.94861313],[6.06979216,45.94864095],[6.0697034,45.94864786],[6.06970714,45.94866849],[6.06964537,45.94867287],[6.06963725,45.94861992],[6.06969639,45.94861471]]'::jsonb, 113.01, 53.19),
    ('photogrammetrie', '[[-3.63183309,47.81385919],[-3.63188723,47.8138525],[-3.63190193,47.81389502],[-3.63207877,47.81387235],[-3.63205303,47.81378439],[-3.63189472,47.81380511],[-3.63186464,47.81371469],[-3.63180396,47.81372265],[-3.63181769,47.81378961]]'::jsonb, 207.4, 74.76),
    ('sans-pan-dominant', '[[7.76895479,48.5306502],[7.76897548,48.53065388],[7.76911702,48.53067343],[7.76913407,48.53062228],[7.76904329,48.5306088],[7.7690346,48.53063258],[7.76896189,48.53062378]]'::jsonb, 57.45, 36.09)
  ) as t(maison, contour, aire, perimetre) loop
    a := public.aire_polygone(r.contour);
    p := public.longueur_ligne(r.contour, true);
    if abs(a - r.aire) / r.aire > 0.0005 or abs(p - r.perimetre) / r.perimetre > 0.0005 then
      raise warning 'ECHEC  %  aire % (attendu %), périmètre % (attendu %)', rpad(r.maison, 20), a, r.aire, p, r.perimetre;
      echecs := echecs + 1;
    else
      raise notice  'ok     %  aire %, périmètre %', rpad(r.maison, 20), a, p;
    end if;
  end loop;
  if echecs > 0 then
    raise exception '% contour(s) : la base ne retrouve plus le chiffre de l''écran', echecs;
  end if;
  raise notice 'Enregistré = affiché : les % contours concordent.', 9;
end $$;
