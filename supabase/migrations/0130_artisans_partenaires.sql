-- Distingue les partenaires des artisans classiques.
--
-- LE BESOIN
--
-- Les 99 artisans actifs étaient tous dans la même liste, alors que les volumes
-- n'ont rien de comparable : Batryx porte 190 affectations, le suivant 36, la
-- grande majorité entre 0 et 6.
--
-- Deux populations, deux usages :
--
--   * l'ARTISAN — statut général. Indépendant, souvent un seul corps de
--     métier, sollicité ponctuellement quand il faut quelqu'un sur un dossier ;
--   * le PARTENAIRE — statut particulier de l'artisan. Il absorbe des dizaines
--     de dossiers par mois.
--
-- C'est un classement MANUEL, décidé par l'agence. Rien ne le calcule.
--
-- LE CHOIX DE LA FORME
--
-- Un horodatage nullable plutôt qu'un booléen, sur le modèle d'`ecarte_at` :
-- il dit à la fois SI l'artisan est partenaire et DEPUIS QUAND.

-- ---------- 1) La colonne ----------

alter table public.artisans
  add column if not exists partenaire_at timestamptz;

comment on column public.artisans.partenaire_at is
  'Date de passage en partenaire. Null = artisan classique. Classement manuel, '
  'réservé aux fondateurs. Jamais exposé à l''artisan.';

-- Les partenaires sont une poignée parmi une centaine : un index partiel suffit.
create index if not exists idx_artisans_partenaires
  on public.artisans (partenaire_at)
  where partenaire_at is not null;

-- ---------- 2) Rattrapage : Batryx ----------
--
-- Par identifiant, pas par nom : plusieurs sociétés ont des fiches en double
-- (BTP RENOV, MIRAN CLOISON, SCHATZ…), et un `ilike` en attraperait deux.
--
-- Posé AVANT le garde-fou ci-dessous : la migration s'exécute sans JWT, et le
-- déclencheur la refuserait comme il refuse un commercial.

update public.artisans
   set partenaire_at = now()
 where id = 'f3a4c5c4-0373-40c7-b4e1-d08a8820efd5'
   and partenaire_at is null;

-- ---------- 3) Réservé aux fondateurs ----------
--
-- LE TROU À FERMER
--
-- `artisans_ecriture` (0112) autorise l'écriture à tout compte qui détient
-- `peut_creer_artisan`. Une policy RLS porte sur la LIGNE, pas sur la colonne :
-- un commercial à qui l'on a confié la création d'artisans pourrait donc
-- promouvoir n'importe qui en partenaire par un appel direct à l'API.
--
-- Masquer le bouton ne suffit pas — c'est le principe posé en 0112 : un droit
-- agit des deux côtés, l'écran masque ET la base refuse.
--
-- Le déclencheur ne bloque QUE le changement de cette colonne. Un commercial
-- qui corrige le téléphone d'un partenaire le peut toujours.

create or replace function public.trg_garde_partenaire()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    -- Une fiche naît artisan. Seul un fondateur peut la créer partenaire
    -- d'emblée ; pour tout autre, la valeur est ignorée plutôt que refusée —
    -- l'inscription publique ne doit pas échouer pour un champ qu'elle
    -- n'aurait jamais dû renseigner.
    if new.partenaire_at is not null
       and coalesce(auth.role(), '') <> 'service_role'
       and not public.est_fondateur() then
      new.partenaire_at := null;
    end if;
    return new;
  end if;

  if new.partenaire_at is distinct from old.partenaire_at
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.est_fondateur() then
    raise exception 'reserve_fondateur'
      using hint = 'Seul un fondateur peut classer un artisan en partenaire.';
  end if;

  return new;
end
$function$;

comment on function public.trg_garde_partenaire() is
  'Réserve aux fondateurs le classement en partenaire. Ne bloque que la '
  'colonne partenaire_at : le reste de la fiche reste modifiable selon la RLS.';

drop trigger if exists trg_garde_partenaire on public.artisans;
create trigger trg_garde_partenaire
  before insert or update on public.artisans
  for each row execute function public.trg_garde_partenaire();
