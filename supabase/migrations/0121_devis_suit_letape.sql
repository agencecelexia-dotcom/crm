-- Redescendre sous « devis envoyé » détache aussi le devis.
--
-- LE PROBLÈME
--
-- La migration 0118 efface le montant signé et le devis signé quand un artisan
-- redescend sous la signature. Elle ne touchait pas au DEVIS lui-même : après
-- un retour de « devis envoyé » à « RDV pris », le fichier et le montant
-- restaient attachés.
--
-- Constaté sur `Ibtissam Conus` : Batryx avait déposé un devis, puis corrigé
-- l'étape en « RDV pris ». L'étape était bien revenue, mais le devis restait
-- affiché comme déposé. Deux autres cas portaient des montants de 58 278 € et
-- 91 761 € sur des chantiers redescendus.
--
-- LA RÈGLE
--
-- Un devis n'existe qu'à partir de l'étape « devis envoyé ». En deçà, ni le
-- fichier ni le montant n'ont d'objet : les garder ferait remonter le chantier
-- au prochain passage des triggers, et fausse les montants affichés.
--
-- Le fichier n'est pas supprimé du stockage — seul le lien est détaché. Si
-- l'artisan reclique « devis envoyé », il redépose son document.

-- ---------- 1) Rattrapage ----------

update public.affectations af
   set devis_url = null,
       montant_devis = null
  from public.projets p
 where p.id = af.projet_id
   and p.deleted_at is null
   and af.retire_at is null
   and public.rang_statut(af.statut) < public.rang_statut('devis_envoye')
   and (af.devis_url is not null or af.montant_devis is not null)
   -- Une commission encaissée relève d'une décision comptable.
   and not coalesce(p.commission_encaissee, false);

-- Le projet porte les mêmes informations, en miroir de l'affectation gagnante.
update public.projets p
   set devis_url = null,
       montant_devis = null
 where p.deleted_at is null
   and public.rang_statut(p.statut) < public.rang_statut('devis_envoye')
   and (p.devis_url is not null or p.montant_devis is not null)
   and not coalesce(p.commission_encaissee, false);

-- ---------- 2) Le garde-fou existant est étendu ----------
--
-- `trg_coherence_issue` (0120) veillait déjà sur `issue`, l'étape et le montant
-- signé. On lui confie le devis : un seul endroit décide de ce qui est
-- cohérent, donc un seul à corriger le jour où la règle change.

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

  -- Sous « devis envoyé », le devis n'a plus d'objet. Le garder ferait remonter
  -- le chantier au prochain passage des triggers de synchronisation.
  if public.rang_statut(new.statut) < public.rang_statut('devis_envoye') then
    new.devis_url := null;
    new.montant_devis := null;
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

comment on function public.trg_coherence_issue() is
  'Garde-fou de cohérence sur une affectation : `issue = gagne` exige un statut '
  'au moins égal à `devis_signe` ; un devis exige `devis_envoye` ; l''étape ne '
  'dépasse jamais le statut. Corrige au vol plutôt que de rejeter, pour ne pas '
  'bloquer une écriture partielle.';
