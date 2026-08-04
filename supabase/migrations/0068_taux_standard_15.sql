-- ============================================================
--  0068 — Le taux standard proposé aux NOUVEAUX artisans passe à 15 %.
--
--  ⚠️ Strictement prospectif. Cette migration ne met à jour AUCUNE ligne
--  existante, volontairement :
--    - 56 artisans ont un contrat d'engagement SIGNÉ dont le texte stipule
--      « commission égale à 10 % » ;
--    - ce texte est figé dans contrats.contenu au moment de la signature et
--      ne peut pas être modifié rétroactivement sans réédition et nouvelle
--      signature ;
--    - relever leur taux en base créerait un écart entre ce qui est facturé
--      et ce qui est contractuellement dû.
--  Les artisans déjà en base gardent donc leur taux. Le passage à 15 % pour
--  eux relève de la négociation commerciale, pas d'un UPDATE SQL.
--
--  Le taux du projet continue d'être initialisé depuis celui de l'artisan à
--  la création de l'affectation (trigger trg_init_taux, migration 0065), qui
--  ne se déclenche que si le projet est encore au défaut et non facturé.
--  Aucune modification n'y est nécessaire : un artisan à 0.15 propage, un
--  artisan legacy à 0.10 laisse le projet à 0.10.
--
--  Le défaut de projets.taux_commission reste 0.10 : c'est la valeur repère
--  qui permet au trigger de distinguer « jamais touché » d'un taux négocié.
-- ============================================================

alter table public.artisans
  alter column taux_commission set default 0.15;

comment on column public.artisans.taux_commission is
  'Taux de commission dû à Celexia par cet artisan (fraction : 0.15 = 15 %). '
  'Alimente le texte du contrat d''engagement (ensure_engagement_contrat) et '
  'initialise le taux des projets qui lui sont affectés. Défaut 15 % depuis '
  'le 2026-08-04 ; les artisans antérieurs restent à leur taux signé.';

-- Repli du garde-fou d'auto-inscription publique aligné sur le nouveau standard.
-- (Rappel : ce trigger ne borne QUE les lignes créées via /rejoindre —
--  source = 'auto:%'. Les saisies internes de l'agence restent libres, ce qui
--  laisse passer les cas légitimes comme CELEXIA à 0 %.)
create or replace function public.clamp_taux_inscription_publique()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(new.source, '') like 'auto:%'
     and (new.taux_commission is null
          or new.taux_commission < 0.05
          or new.taux_commission > 0.30)
  then
    new.taux_commission := 0.15;
  end if;
  return new;
end;
$function$;
