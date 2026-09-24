-- Un avenant ne fait plus reculer un chantier signé.
--
-- Trouvé par l'audit du devis : envoyer_devis_by_token passait l'affectation en
-- « devis envoyé » et remplaçait son montant, SANS CONDITION. Un artisan qui
-- envoyait un avenant (les CGV, art. 2, le prévoient) depuis un chantier signé
-- ou terminé le faisait redescendre à « devis envoyé », montant de l'avenant à
-- la place du montant signé. Désormais, après la signature, le devis envoyé est
-- consigné comme complémentaire sans rien changer au chantier. Le recalcul
-- manuel du statut du projet disparaît : le trigger de 0160 s'en charge.

CREATE OR REPLACE FUNCTION public.envoyer_devis_by_token(p_token text, p_devis_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.artisans; d public.devis;
begin
  a := public._devis_artisan(p_token);
  if a.id is null then return json_build_object('ok', false); end if;
  select * into d from public.devis where id = p_devis_id and artisan_id = a.id;
  if d.id is null then return json_build_object('ok', false); end if;

  update public.devis set statut = 'envoye', sent_at = now() where id = d.id;

  -- Répercussion CRM si le devis vient d'un projet (affectation).
  if d.affectation_id is not null then
    if exists (select 1 from public.affectations
                where id = d.affectation_id and retire_at is null
                  and public.rang_statut(statut) < public.rang_statut('devis_signe')) then
      -- Avant la signature : ce devis EST le devis du chantier.
      update public.affectations
        set devis_url = coalesce(d.pdf_url, devis_url), montant_devis = d.total, statut = 'devis_envoye'
        where id = d.affectation_id;
      insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
        values (d.projet_id, d.affectation_id, 'artisan', 'statut', 'devis_envoye',
                'Devis ' || d.numero || ' envoyé (' || round(d.total)::text || ' €)');
    else
      -- Chantier déjà signé, terminé ou retiré : c'est un AVENANT. Il ne fait
      -- ni reculer le chantier ni changer son montant — il se consigne.
      insert into public.suivis (projet_id, affectation_id, auteur, type, message)
        values (d.projet_id, d.affectation_id, 'artisan', 'note',
                'Devis complémentaire ' || d.numero || ' envoyé (' || round(d.total)::text || ' €)');
    end if;
    -- Le statut du projet suit ses affectations par trigger (sync_statut_projet,
    -- 0160) : plus de recalcul à la main, qui ignorait les retraits.
  end if;

  return json_build_object('ok', true, 'client_email', d.client_email,
                           'numero', d.numero, 'total', d.total, 'pdf_url', d.pdf_url);
end;
$function$

;
