-- ============================================================
--  Test de cohérence des métriques — à exécuter après toute migration
--  touchant `affectations`, le funnel ou les KPI.
--
--  Chaque règle doit renvoyer OK. Une seule violation signifie qu'un tableau
--  de bord affichera un chiffre faux — silencieusement.
--
--  Usage : coller dans le SQL Editor Supabase, ou
--          psql -f supabase/tests/coherence_metriques.sql
-- ============================================================

do $$
declare v json; k text; val text; echecs int := 0;
begin
  v := public.verifier_coherence_metriques();

  for k, val in select * from json_each_text(v) loop
    if val not in ('true', '0') then
      raise warning 'ECHEC  %  = %', rpad(k, 32), val;
      echecs := echecs + 1;
    else
      raise notice  'ok     %  = %', rpad(k, 32), val;
    end if;
  end loop;

  if echecs > 0 then
    raise exception '% règle(s) de cohérence violée(s) — les KPI sont faux', echecs;
  end if;
  raise notice 'Toutes les règles de cohérence passent.';
end $$;
