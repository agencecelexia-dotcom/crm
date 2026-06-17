-- 0037 — L'estimation auto ne se déclenche QUE si le projet a une description.
-- Sans description, estimation_interne reste vide (à renseigner à la main).

create or replace function public.trg_estimation_auto() returns trigger
language plpgsql as $$
begin
  if new.estimation_interne is null and coalesce(trim(new.description), '') <> '' then
    new.estimation_interne := public.estimer_projet(new.metier, new.metiers, new.description);
  end if;
  return new;
end;
$$;
