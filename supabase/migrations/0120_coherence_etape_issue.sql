-- Une affectation ne peut pas être « gagnée » sous la signature.
--
-- LE PROBLÈME
--
-- La migration 0118 rattrapait les projets restés `devis_signe` après une
-- correction d'étape. Elle partait du PROJET, et manquait donc les cas où seule
-- l'affectation était désynchronisée.
--
-- Constaté sur deux chantiers en `rdv_pris` dont l'affectation portait
-- `etape = devis_signe`, `issue = gagne` et un montant signé fantôme (1 150 €
-- et 402 €). Conséquences visibles dans l'espace artisan : ils apparaissaient
-- sous « Chantiers terminés » — la bascule se fonde sur `issue` — et leur
-- commission était comptée.
--
-- LA RÈGLE
--
-- `issue = 'gagne'` signifie que l'affaire est signée. Elle ne peut donc pas
-- coexister avec un statut inférieur à `devis_signe`. Ce qui est corrigé ici,
-- et rendu impossible ensuite par une contrainte.

-- ---------- 1) Rattrapage ----------

update public.affectations af
   set etape = case
         when public.rang_etape(af.statut) > 0 then af.statut
         else af.etape
       end,
       issue = 'en_cours',
       -- Un montant signé sous la signature n'a pas d'existence : il gonflait
       -- le chiffre d'affaires et les commissions.
       montant_devis_signe = null,
       devis_signe_url = null
  from public.projets p
 where p.id = af.projet_id
   and p.deleted_at is null
   and af.retire_at is null
   and af.issue = 'gagne'
   and public.rang_statut(af.statut) < public.rang_statut('devis_signe')
   and not coalesce(p.commission_encaissee, false);

-- L'étape ne doit jamais dépasser le statut déclaré.
update public.affectations af
   set etape = af.statut
  from public.projets p
 where p.id = af.projet_id
   and p.deleted_at is null
   and af.retire_at is null
   and af.etape is not null
   and public.rang_etape(af.etape) > public.rang_etape(af.statut)
   and public.rang_etape(af.statut) > 0
   and not coalesce(p.commission_encaissee, false);

-- ---------- 2) Empêcher la réapparition ----------
--
-- Un trigger plutôt qu'une contrainte `check` : la cohérence dépend de deux
-- colonnes mises à jour séparément, et une contrainte rejetterait des écritures
-- intermédiaires légitimes. Ici on corrige au vol, sans jamais bloquer.

create or replace function public.trg_coherence_issue()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Une affaire ne peut être gagnée que si le statut atteint la signature.
  if new.issue = 'gagne'
     and public.rang_statut(new.statut) < public.rang_statut('devis_signe') then
    new.issue := 'en_cours';
    new.montant_devis_signe := null;
    new.devis_signe_url := null;
  end if;

  -- L'étape ne dépasse jamais le statut déclaré par l'artisan.
  if new.etape is not null
     and public.rang_etape(new.statut) > 0
     and public.rang_etape(new.etape) > public.rang_etape(new.statut) then
    new.etape := new.statut;
  end if;

  return new;
end
$function$;

drop trigger if exists trg_coherence_issue on public.affectations;

create trigger trg_coherence_issue
  before insert or update on public.affectations
  for each row
  execute function public.trg_coherence_issue();

comment on function public.trg_coherence_issue() is
  'Garde-fou : `issue = gagne` et un montant signé exigent un statut au moins '
  'égal à `devis_signe`, et l''étape ne dépasse jamais le statut. Corrige au '
  'vol plutôt que de rejeter, pour ne pas bloquer une écriture partielle.';
