-- Fixtures fictives et transaction annulée. Aucun workflow, mail ou réseau.
begin;
do $$
declare
  a uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  cle uuid := gen_random_uuid();
  autre_cle uuid := gen_random_uuid();
  prise timestamptz;
begin
  insert into public.artisans(id, nom, contrat_externe)
    values(a, 'Audit rejeu fictif', true);
  insert into public.devis(id, artisan_id, numero, envoi_etat, envoi_cle)
    values(d, a, 'AUDIT-REJEU-' || d, 'en_cours', cle);

  assert not public.prendre_envoi_devis(null), 'clé absente acceptée';
  assert not public.prendre_envoi_devis(autre_cle), 'clé inconnue acceptée';
  assert (select envoi_pris_at is null from public.devis where id=d), 'clé inconnue a consommé la tentative';
  assert public.prendre_envoi_devis(cle), 'première prise refusée';
  select envoi_pris_at into prise from public.devis where id=d;
  assert prise is not null, 'prise non persistée';
  assert not public.prendre_envoi_devis(cle), 'rejeu accepté : second email possible';
  assert (select envoi_pris_at = prise from public.devis where id=d), 'rejeu a modifié la preuve initiale';

  -- Une réservation devenue incertaine ne permet pas de reprendre l'envoi,
  -- même si le workflow n'avait pas encore réussi à consommer la clé.
  update public.devis set envoi_pris_at=null, envoi_etat='incertain' where id=d;
  assert not public.prendre_envoi_devis(cle), 'tentative incertaine relancée';
  update public.devis set envoi_etat='echec' where id=d;
  assert not public.prendre_envoi_devis(cle), 'tentative terminée relancée';
  update public.devis set envoi_etat='en_cours', statut='envoye' where id=d;
  assert not public.prendre_envoi_devis(cle), 'devis déjà envoyé relancé';

  -- Une nouvelle clé rend immédiatement l'ancienne inutilisable.
  update public.devis set envoi_cle=autre_cle, statut='brouillon', envoi_etat='en_cours', envoi_pris_at=null where id=d;
  assert not public.prendre_envoi_devis(cle), 'ancienne clé encore utilisable';
  assert public.prendre_envoi_devis(autre_cle), 'nouvelle réservation non consommable';
  assert not public.prendre_envoi_devis(autre_cle), 'nouvelle réservation consommable deux fois';

  assert not has_function_privilege('anon', 'public.prendre_envoi_devis(uuid)', 'execute'), 'prise ouverte à anon';
  assert not has_function_privilege('authenticated', 'public.prendre_envoi_devis(uuid)', 'execute'), 'prise ouverte aux comptes utilisateurs';
  assert has_function_privilege('service_role', 'public.prendre_envoi_devis(uuid)', 'execute'), 'prise inaccessible au serveur';
  raise notice 'Audit rejeu : prise unique persistée, clés et états refusés, droits serveur vérifiés';
end $$;
rollback;
