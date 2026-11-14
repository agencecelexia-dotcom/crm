-- Scénarios fictifs sans réseau. Les fonctions HTTP sont remplacées dans la transaction.
begin;
create temp table audit_autom_http(event text, statut text);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
returns bigint language plpgsql as $$ begin insert into audit_autom_http values(body->>'event',body->>'statut'); return 1; end $$;

do $audit$
declare a uuid; p uuid; af uuid; r json; avant_pause text; fondateur uuid := '19700000-0000-4000-8000-000000000001';
begin
  select valeur into avant_pause from public.app_settings where cle='relances_pause';
  insert into auth.users(id,email) values(fondateur,'fictif-automatisation@example.test');
  insert into public.membres(user_id,nom,email,role,actif) values(fondateur,'Fictif','fictif-automatisation@example.test','fondateur',true);
  perform set_config('request.jwt.claim.sub',fondateur::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform public.regler_automatisation('auto_notif_suivi','off','on');
  if public.automatisation_active('auto_notif_suivi') then raise exception 'Interrupteur non enregistré'; end if;
  if (select count(*) from public.automatisations_journal where cle='auto_notif_suivi' and auteur=fondateur) <> 1 then raise exception 'Journal incomplet'; end if;
  begin
    perform public.regler_automatisation('auto_notif_suivi','on','on');
    raise exception 'État périmé accepté';
  exception when others then if sqlerrm <> 'reglage_modifie' then raise; end if; end;
  begin
    perform public.regler_automatisation('heure_fin','0',public.cfg('heure_fin','20'));
    raise exception 'Plage invalide acceptée';
  exception when others then if sqlerrm <> 'plage_horaire_invalide' then raise; end if; end;
  begin
    perform public.regler_automatisation('relance_premier_h','-1','24');
    raise exception 'Nombre négatif accepté';
  exception when others then if sqlerrm <> 'valeur_invalide' then raise; end if; end;
  begin
    perform public.regler_automatisation('cle_privee','off','on');
    raise exception 'Clé arbitraire acceptée';
  exception when others then if sqlerrm <> 'reglage_inconnu' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.regler_automatisation('auto_notif_suivi','on','off');
    raise exception 'Anonyme accepté';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.verrouiller_automatisation_n8n(text,uuid)','EXECUTE') then raise exception 'Verrou privé exposé'; end if;
  if has_table_privilege('authenticated','public.automatisations_n8n_etat','SELECT') then raise exception 'État serveur exposé'; end if;
  if not public.verrouiller_automatisation_n8n('fictif',gen_random_uuid()) then raise exception 'Verrou indisponible'; end if;
  if public.verrouiller_automatisation_n8n('fictif',gen_random_uuid()) then raise exception 'Double verrou accepté'; end if;

  perform set_config('request.jwt.claim.role','anon',true);
  insert into public.artisans(nom,contrat_externe,token) values('Fictif Automatisation',true,'fictif-auto-artisan') returning id into a;
  insert into public.projets(client_nom,metier,statut) values('Fictif Automatisation','Couverture','nouveau') returning id into p;
  insert into public.affectations(projet_id,artisan_id,token) values(p,a,'fictif-auto-affectation') returning id into af;
  truncate audit_autom_http;
  r := public.add_suivi_by_token('fictif-auto-affectation','contacte',null,null);
  if not (r->>'ok')::boolean or (select statut from public.affectations where id=af) <> 'contacte' then raise exception 'Notification coupée bloque le métier'; end if;
  if exists(select 1 from audit_autom_http where event='changement_statut') then raise exception 'Email suivi parti malgré arrêt'; end if;
  update public.app_settings set valeur='on' where cle='auto_notif_suivi';
  perform public.add_suivi_by_token('fictif-auto-affectation','rdv_pris',null,now()+interval '1 day');
  if not exists(select 1 from audit_autom_http where event='changement_statut') then raise exception 'Email suivi absent après reprise'; end if;
  update public.app_settings set valeur='off' where cle in ('auto_notif_retrait','auto_notif_perdu');
  delete from public.notifications where projet_id=p;
  truncate audit_autom_http;
  r := public.retirer_chantier_by_token('fictif-auto-affectation','Hors de ma zone fictive','hors_zone',null);
  if not (r->>'ok')::boolean or (select retire_at from public.affectations where id=af) is null then raise exception 'Retrait bloqué par arrêt des notifications'; end if;
  if exists(select 1 from public.notifications where projet_id=p and type in ('a_reassigner','artisan_retrait')) then raise exception 'Notification retrait/perte créée malgré arrêt'; end if;
  if exists(select 1 from audit_autom_http where event='chantier_perdu') then raise exception 'Email retrait parti malgré arrêt'; end if;
  perform public.restaurer_chantier_by_token('fictif-auto-affectation');
  update public.app_settings set valeur='on' where cle in ('auto_notif_retrait','auto_notif_perdu');
  perform public.retirer_chantier_by_token('fictif-auto-affectation','Hors de ma zone fictive','hors_zone',null);
  if not exists(select 1 from public.notifications where projet_id=p and type='artisan_retrait') then raise exception 'Notification retrait absente après reprise'; end if;
  if not exists(select 1 from audit_autom_http where event='chantier_perdu') then raise exception 'Email retrait absent après reprise'; end if;
  if (select valeur from public.app_settings where cle='relances_pause') is distinct from avant_pause then raise exception 'Pause des relances modifiée'; end if;
end
$audit$;
rollback;
