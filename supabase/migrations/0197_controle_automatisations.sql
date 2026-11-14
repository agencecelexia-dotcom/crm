-- Compléter les interrupteurs sans modifier aucun état existant.
-- Les gardes portent sur les notifications, jamais sur les écritures métier.
do $migration$
declare d text; ancien text; nouveau text;
begin
  select pg_get_functiondef('public.add_suivi_by_token(text,text,text,timestamptz)'::regprocedure) into d;
  if d not like '%''auto_notif_suivi''%' then
    ancien := E'    perform net.http_post(\n';
    nouveau := E'    if public.automatisation_active(case when p_statut = ''perdu'' then ''auto_notif_perdu'' else ''auto_notif_suivi'' end) then\n    perform net.http_post(\n';
    if position(ancien in d) = 0 then raise exception 'Garde suivi : point d’insertion absent'; end if;
    d := replace(d, ancien, nouveau);
    ancien := E'    );\n  end if;\n\n  if p_statut = ''devis_signe'' then';
    if position(ancien in d) = 0 then raise exception 'Garde suivi : fin absente'; end if;
    d := replace(d, ancien, E'    );\n    end if;\n  end if;\n\n  if p_statut = ''devis_signe'' then');
    execute d;
  end if;

  select pg_get_functiondef('public.retirer_chantier_by_token(text,text,text,date)'::regprocedure) into d;
  if d not like '%automatisation_active(''auto_notif_retrait'')%' then
    ancien := E'    insert into public.notifications (type, titre, message, projet_id)\n    values (''a_reassigner'',';
    if position(ancien in d) = 0 then raise exception 'Garde perte : point d’insertion absent'; end if;
    d := replace(d, ancien, E'    if public.automatisation_active(''auto_notif_perdu'') then\n' || ancien);
    ancien := E'      ''Motif : '' || p_motif || '' — '' || btrim(p_raison), af.projet_id);\n  end if;';
    if position(ancien in d) = 0 then raise exception 'Garde perte : fin absente'; end if;
    d := replace(d, ancien, E'      ''Motif : '' || p_motif || '' — '' || btrim(p_raison), af.projet_id);\n    end if;\n  end if;');
    ancien := E'  insert into public.notifications (type, titre, message, projet_id)\n  values (''artisan_retrait'',';
    if position(ancien in d) = 0 then raise exception 'Garde retrait : point d’insertion absent'; end if;
    d := replace(d, ancien, E'  if public.automatisation_active(''auto_notif_retrait'') then\n' || ancien);
    ancien := E'  return json_build_object(''ok'', true, ''restants'', v_restants);';
    if position(ancien in d) = 0 then raise exception 'Garde retrait : fin absente'; end if;
    d := replace(d, ancien, E'  end if;\n\n' || ancien);
    execute d;
  end if;
end
$migration$;

-- Journal réservé aux fondateurs. Aucun contenu de mail, jeton ou secret.
create table public.automatisations_journal (
  id bigint generated always as identity primary key,
  source text not null check (source in ('crm', 'n8n')),
  cle text not null,
  titre text not null,
  avant text,
  apres text not null,
  auteur uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.automatisations_journal enable row level security;
create policy automatisations_journal_lecture on public.automatisations_journal
  for select to authenticated using (public.est_fondateur());
grant select on public.automatisations_journal to authenticated;
grant all on public.automatisations_journal to service_role;
grant usage, select on sequence public.automatisations_journal_id_seq to service_role;

-- Conserver la version publiée avant pause, sans copier le workflow ni ses secrets.
-- Un verrou court empêche deux commandes CRM concurrentes pour le même workflow.
create table public.automatisations_n8n_etat (
  id text primary key,
  version_reprise text,
  verrou uuid,
  verrou_jusqua timestamptz
);
alter table public.automatisations_n8n_etat enable row level security;
revoke all on public.automatisations_n8n_etat from anon, authenticated;
grant all on public.automatisations_n8n_etat to service_role;

create function public.verrouiller_automatisation_n8n(p_id text, p_verrou uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.automatisations_n8n_etat(id, verrou, verrou_jusqua)
  values(p_id, p_verrou, now() + interval '2 minutes')
  on conflict(id) do update set verrou = excluded.verrou, verrou_jusqua = excluded.verrou_jusqua
  where automatisations_n8n_etat.verrou is null or automatisations_n8n_etat.verrou_jusqua < now();
  return found;
end $$;
revoke all on function public.verrouiller_automatisation_n8n(text, uuid) from public, anon, authenticated;
grant execute on function public.verrouiller_automatisation_n8n(text, uuid) to service_role;

-- Seules les clés présentées dans Automatisations sont acceptées. L'état attendu
-- évite qu'une page ancienne écrase silencieusement le choix d'un autre fondateur.
create function public.regler_automatisation(p_cle text, p_valeur text, p_attendue text)
returns void language plpgsql security definer set search_path = public as $$
declare v_avant text; v_defaut text; v_nombre int;
begin
  if not public.est_fondateur() then raise exception 'reserve_fondateur' using errcode = '42501'; end if;
  if p_cle = any(array['auto_contrat','auto_inaction','auto_post_rdv','auto_orphelin',
    'auto_taches','auto_rappels','auto_recontacts','auto_coherence','pont_crm_artisan',
    'auto_pre_metre','auto_materiaux','auto_notif_assignation','auto_notif_inscription',
    'auto_notif_contrat','auto_notif_devis','auto_notif_suivi','auto_notif_retrait',
    'auto_notif_perdu','auto_mail_invitation','relances_pause']) then
    if p_valeur is null or p_valeur not in ('on','off') then raise exception 'valeur_invalide'; end if;
    v_defaut := case when p_cle = 'relances_pause' then 'off' else 'on' end;
  elsif p_cle = any(array['relance_premier_h','relance_interval_h','relance_escalade_h',
    'post_rdv_premier_h','post_rdv_relance_h','heure_debut','heure_fin','creatives_plafond_mois']) then
    if p_valeur is null or p_valeur !~ '^\d{1,6}$' then raise exception 'valeur_invalide'; end if;
    v_nombre := p_valeur::int;
    if (p_cle in ('heure_debut','heure_fin') and v_nombre not between 0 and 23)
      or (p_cle like '%_h' and v_nombre not between 1 and 8760)
      or (p_cle = 'creatives_plafond_mois' and v_nombre not between 0 and 100000)
      then raise exception 'valeur_invalide'; end if;
    v_defaut := case p_cle when 'relance_interval_h' then '12' when 'relance_escalade_h' then '48'
      when 'heure_debut' then '8' when 'heure_fin' then '20' when 'creatives_plafond_mois' then '200' else '24' end;
  else raise exception 'reglage_inconnu'; end if;
  -- Sérialiser également les deux bornes de la plage horaire.
  perform pg_advisory_xact_lock(197, 1);
  select valeur into v_avant from public.app_settings where cle = p_cle for update;
  v_avant := coalesce(v_avant, v_defaut);
  if v_avant is distinct from p_attendue then raise exception 'reglage_modifie'; end if;
  if p_cle = 'heure_debut' and v_nombre >= public.cfg('heure_fin','20')::int
    or p_cle = 'heure_fin' and v_nombre <= public.cfg('heure_debut','8')::int then
    raise exception 'plage_horaire_invalide';
  end if;
  if v_avant = p_valeur then return; end if;
  insert into public.app_settings(cle, valeur, updated_at) values(p_cle, p_valeur, now())
  on conflict(cle) do update set valeur = excluded.valeur, updated_at = excluded.updated_at;
  insert into public.automatisations_journal(source,cle,titre,avant,apres,auteur)
  values('crm',p_cle,p_cle,v_avant,p_valeur,auth.uid());
end $$;
revoke all on function public.regler_automatisation(text,text,text) from public, anon;
grant execute on function public.regler_automatisation(text,text,text) to authenticated;
