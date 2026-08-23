-- Un chantier sorti d'un artisan n'est pas « nouveau ».
--
-- La migration 0111 a créé la colonne `origine`, qui distingue correctement les
-- deux pipes. Mais elle n'a rien changé à ce qui est AFFICHÉ : 61 chantiers
-- restaient marqués « nouveau » alors qu'ils sont des retours d'artisan. Ajouter
-- une colonne invisible ne corrige pas un libellé faux.
--
-- Ces chantiers prennent donc un statut à eux : `a_reattribuer`. Il dit ce
-- qu'ils sont — un dossier déjà passé chez un artisan, à replacer — et il les
-- sort définitivement du compteur des leads entrants.
--
-- `nouveau` retrouve son sens : un lead qui n'est jamais parti nulle part.

-- ---------- 0) Autoriser le nouveau statut ----------
--
-- `projets_statut_check` énumère les statuts admis : sans cet ajout, la mise à
-- jour ci-dessous échoue.

alter table public.projets drop constraint if exists projets_statut_check;

alter table public.projets add constraint projets_statut_check
  check (statut = any (array[
    'nouveau', 'a_reattribuer', 'a_rappeler', 'en_attente', 'artisan_assigne',
    'contacte', 'rdv_pris', 'devis_envoye', 'devis_signe', 'termine',
    'perdu', 'mort', 'artisan_demarche', 'demarchage'
  ]));

-- ---------- 1) Les chantiers sortis prennent leur vrai statut ----------

update public.projets
   set statut = 'a_reattribuer'
 where deleted_at is null
   and origine = 'reprise'
   -- Un dossier signé, terminé ou définitivement mort n'est pas à replacer.
   and statut not in ('devis_signe', 'termine', 'mort',
                      'artisan_demarche', 'demarchage');

-- ---------- 2) Le trigger maintient ce statut ----------
--
-- Sans cela, le prochain chantier rendu par un artisan repasserait en
-- « nouveau » et le problème reviendrait dès demain.

create or replace function public.trg_origine_chantier()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_projet uuid;
  v_origine text;
  v_statut text;
begin
  v_projet := coalesce(new.projet_id, old.projet_id);
  v_origine := public.calculer_origine(v_projet);

  select statut into v_statut from public.projets where id = v_projet;

  update public.projets
     set origine = v_origine,
         statut = case
           -- Sortie du dernier artisan : le chantier devient à replacer.
           when v_origine = 'reprise'
            and v_statut not in ('devis_signe', 'termine', 'mort',
                                 'artisan_demarche', 'demarchage')
             then 'a_reattribuer'
           -- Un artisan le reprend : il repart dans le pipe normal.
           when v_origine = 'chez_artisan' and v_statut = 'a_reattribuer'
             then 'artisan_assigne'
           else v_statut
         end
   where id = v_projet;

  return coalesce(new, old);
end
$function$;

-- ---------- 3) Le rang du nouveau statut ----------
--
-- `rang_statut()` ordonne le pipe et sert de garde-fou anti-régression : un
-- statut inconnu y vaut 0, ce qui autoriserait n'importe quel retour en
-- arrière. `a_reattribuer` se place au niveau de `nouveau` : le dossier
-- redémarre un cycle, mais sur un chantier déjà connu.

create or replace function public.rang_statut(p_statut text)
returns int
language sql
immutable
as $function$
  select case p_statut
    when 'demarchage'        then 0
    when 'artisan_demarche'  then 0
    when 'nouveau'           then 1
    when 'a_reattribuer'     then 1
    when 'a_rappeler'        then 2
    when 'artisan_assigne'   then 3
    when 'contacte'          then 4
    when 'rdv_pris'          then 5
    when 'devis_envoye'      then 6
    when 'devis_signe'       then 7
    when 'termine'           then 8
    when 'perdu'             then 9
    when 'mort'              then 9
    else 0
  end;
$function$;

comment on function public.rang_statut(text) is
  'Ordre du pipe. `a_reattribuer` partage le rang de `nouveau` : le chantier '
  'redémarre un cycle, mais sur un dossier déjà passé chez un artisan.';
