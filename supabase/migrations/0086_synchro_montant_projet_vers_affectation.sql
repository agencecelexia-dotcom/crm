-- ============================================================
--  0086 — Le montant redescend du projet vers l'affectation gagnante.
--
--  CONSTAT : le contrôle de cohérence signalait un dossier « gagné sans
--  montant » (CELEXIA / launay patrick). Le montant existait bien — 402 € —
--  mais sur `projets`, saisi côté agence, sans jamais redescendre sur
--  l'affectation. Les KPI de l'artisan lisent l'affectation : le CA de ce
--  chantier était donc invisible pour lui.
--
--  0077 avait câblé le sens affectation → projet. Il manquait le retour.
--  Sans lui, toute saisie agence reste invisible côté artisan.
--
--  Rien n'est inventé : on recopie une valeur déjà présente, et uniquement
--  vers l'artisan désigné gagnant sur le projet.
-- ============================================================

create or replace function public.trg_montant_projet_vers_affectation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.montant_devis_signe is null
     or new.montant_devis_signe is not distinct from old.montant_devis_signe then
    return new;
  end if;

  update public.affectations af
     set montant_devis_signe = new.montant_devis_signe
   where af.projet_id = new.id
     and af.artisan_id = new.artisan_id      -- uniquement le gagnant
     and af.retire_at is null
     and af.montant_devis_signe is null;     -- ne jamais écraser sa saisie

  return new;
end;
$function$;

drop trigger if exists trg_montant_projet_vers_affectation on public.projets;
create trigger trg_montant_projet_vers_affectation
  after update on public.projets
  for each row execute function public.trg_montant_projet_vers_affectation();

-- Rattrapage des lignes déjà dans ce cas : la valeur existe déjà côté projet,
-- on ne fait que la rendre visible côté artisan.
update public.affectations af
   set montant_devis_signe = p.montant_devis_signe
  from public.projets p
 where p.id = af.projet_id
   and p.artisan_id = af.artisan_id
   and p.deleted_at is null
   and p.montant_devis_signe is not null
   and af.montant_devis_signe is null
   and af.retire_at is null
   and af.issue = 'gagne';
