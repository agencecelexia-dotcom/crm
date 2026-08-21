-- Notification e-mail immédiate quand un artisan rend un chantier.
--
-- Le modèle des prochains mois : la quasi-totalité des chantiers part chez
-- Batryx, et tout ce qu'il perd doit être repris et réattribué. La rapidité
-- de reprise fait la différence — un client qui attend trois jours a déjà
-- rappelé un concurrent.
--
-- Jusqu'ici le retrait créait deux notifications dans le CRM
-- (`artisan_retrait`, `a_reassigner`) mais n'envoyait aucun e-mail. Il fallait
-- avoir l'application ouverte pour l'apprendre.
--
-- Le champ `orphelin` distingue les deux cas : un chantier encore travaillé
-- par un autre artisan n'a pas la même urgence qu'un chantier que plus
-- personne ne suit.
--
-- La fonction est reprise depuis sa définition en production ; seul l'appel
-- webhook est ajouté. Le motif est déjà obligatoire depuis 0079 et le
-- formulaire l'impose — les 44 retraits sans motif datent d'avant le 11 août.

CREATE OR REPLACE FUNCTION public.retirer_chantier_by_token(p_token text, p_raison text, p_motif text, p_recontacter_le date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare af public.affectations; v_garde json; v_restants int;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if af.retire_at is not null then return json_build_object('ok', true, 'deja_retire', true); end if;

  if length(coalesce(btrim(p_raison), '')) < 5 then
    return json_build_object('ok', false, 'error', 'justification_requise');
  end if;
  if p_motif is null then
    return json_build_object('ok', false, 'error', 'motif_requis');
  end if;

  v_garde := public.peut_abandonner_affectation(af.id);
  if (v_garde->>'ok')::boolean is false then
    return json_build_object('ok', false, 'error', v_garde->>'raison');
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (af.projet_id, af.id, 'artisan', 'retrait', 'perdu', btrim(p_raison));

  update public.affectations
     set statut = 'perdu', retire_at = now(), issue = 'perdu',
         motif_perte = p_motif,
         motif_perte_detail = btrim(p_raison),
         origine_perte = public.origine_du_motif(p_motif),
         recontacter_le = p_recontacter_le
   where id = af.id;

  select count(*) into v_restants
    from public.affectations af2
   where af2.projet_id = af.projet_id and af2.issue <> 'perdu' and af2.retire_at is null;

  if v_restants = 0 then
    update public.projets
       set statut = 'nouveau', artisan_id = null,
           montant_devis_signe = null, montant_devis = null
     where id = af.projet_id and statut <> 'mort';

    insert into public.notifications (type, titre, message, projet_id)
    values ('a_reassigner',
      'À réassigner : ' || coalesce((select client_nom from public.projets where id = af.projet_id), 'chantier'),
      'Motif : ' || p_motif || ' — ' || btrim(p_raison), af.projet_id);
  end if;

  insert into public.notifications (type, titre, message, projet_id)
  values ('artisan_retrait',
    'Retrait artisan : ' || coalesce(
      (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id), 'artisan'),
    p_motif || ' — ' || btrim(p_raison), af.projet_id);

  -- Notification par e-mail : un chantier perdu par l'artisan principal doit
  -- être repris vite. La cloche dans le CRM ne suffit pas — il faut le savoir
  -- même quand personne n'a l'application ouverte.
  --
  -- `net.http_post` est asynchrone : si n8n est indisponible, le retrait est
  -- déjà enregistré et n'est pas annulé pour autant.
  perform net.http_post(
    url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
    body := jsonb_build_object(
      'event', 'chantier_perdu',
      'artisan', (select coalesce(a.societe, a.nom) from public.artisans a
                   where a.id = af.artisan_id),
      'client_nom',   (select client_nom   from public.projets where id = af.projet_id),
      'client_ville', (select client_ville from public.projets where id = af.projet_id),
      'metier',       (select metier       from public.projets where id = af.projet_id),
      'montant',      af.montant_devis,
      'motif',        p_motif,
      'raison',       btrim(p_raison),
      'recontacter_le', p_recontacter_le,
      -- Zéro artisan restant : le chantier est orphelin, c'est le cas urgent.
      'orphelin',     (v_restants = 0),
      'lien', 'https://crm-ci7k.vercel.app/projets/' || af.projet_id
    )
  );

  return json_build_object('ok', true, 'restants', v_restants);
end;
$function$

