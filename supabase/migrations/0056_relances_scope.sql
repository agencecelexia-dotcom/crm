-- 0056 — Relances artisan limitees aux statuts 'a signer' (artisan_assigne) et 'en attente'.
-- Plus de relance des qu'il y a contacte/rdv_pris/devis. Payload inaction enrichi (ville+metier).
-- Reglages associes : auto_post_rdv=off, relance_premier_h=24, relance_interval_h=48, relance_escalade_h=240.

CREATE OR REPLACE FUNCTION public.traiter_relances()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  WEBHOOK constant text := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events';
  v_now timestamptz := now();
  v_h int := extract(hour from (v_now at time zone 'Europe/Paris'));
  v_premier numeric := cfg('relance_premier_h','24')::numeric;
  v_interval numeric := cfg('relance_interval_h','12')::numeric;
  v_escalade numeric := cfg('relance_escalade_h','48')::numeric;
  v_postrdv_premier numeric := cfg('post_rdv_premier_h','24')::numeric;
  v_postrdv_relance numeric := cfg('post_rdv_relance_h','24')::numeric;
  r record; age numeric; last_r timestamptz; v_cnt int;
begin
  if v_h < cfg('heure_debut','8')::int or v_h >= cfg('heure_fin','20')::int then return; end if;

  if cfg('auto_contrat','on') = 'on' then
    for r in
      select af.id aff_id, af.projet_id, af.created_at, ar.email, ar.prenom, ar.nom, ar.token a_token,
             p.metier, p.client_ville
      from public.affectations af
      join public.artisans ar on ar.id = af.artisan_id
      join public.projets p on p.id = af.projet_id
      where af.statut in ('artisan_assigne','en_attente')
        and p.deleted_at is null and ar.ecarte_at is null
        and ar.contrat_externe = false and ar.email is not null
        and not exists (select 1 from public.contrats c where c.artisan_id = ar.id and c.statut = 'signe')
    loop
      age := extract(epoch from (v_now - r.created_at)) / 3600;
      if age >= v_premier and age < v_escalade then
        select max(sent_at) into last_r from public.relances
          where type='contrat' and affectation_id=r.aff_id and cible='artisan';
        if last_r is null or extract(epoch from (v_now - last_r))/3600 >= v_interval then
          perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
            'event','relance_contrat','email',r.email,'artisan_prenom',r.prenom,'artisan_nom',r.nom,
            'metier',r.metier,'client_ville',r.client_ville,
            'lien','https://crm-ci7k.vercel.app/artisan/'||r.a_token));
          insert into public.relances(type,projet_id,affectation_id,cible) values('contrat',r.projet_id,r.aff_id,'artisan');
        end if;
      elsif age >= v_escalade then
        if not exists (select 1 from public.relances where type='contrat_escalade' and affectation_id=r.aff_id) then
          perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
            'event','escalade','sujet','contrat',
            'artisan',trim(coalesce(r.prenom,'')||' '||r.nom),'metier',r.metier,'client_ville',r.client_ville,
            'lien','https://crm-ci7k.vercel.app/projets/'||r.projet_id));
          insert into public.relances(type,projet_id,affectation_id,cible) values('contrat_escalade',r.projet_id,r.aff_id,'agence');
          insert into public.notifications(type,titre,message,projet_id) values(
            'a_appeler','À appeler : '||trim(coalesce(r.prenom,'')||' '||r.nom),
            'Contrat non signé depuis '||round(age)||'h — chantier '||coalesce(r.metier,'')||' à '||coalesce(r.client_ville,'?'),
            r.projet_id);
        end if;
      end if;
    end loop;
  end if;

  if cfg('auto_inaction','on') = 'on' then
    for r in
      select af.id aff_id, af.projet_id, af.updated_at, af.statut, ar.email, ar.prenom, ar.nom, ar.token a_token,
             p.client_nom, p.metier, p.client_ville
      from public.affectations af
      join public.artisans ar on ar.id = af.artisan_id
      join public.projets p on p.id = af.projet_id
      where af.statut in ('artisan_assigne','en_attente')
        and true
        and p.deleted_at is null and ar.ecarte_at is null
        and ar.email is not null
        and (ar.contrat_externe = true or exists (select 1 from public.contrats c where c.artisan_id = ar.id and c.statut = 'signe'))
    loop
      age := extract(epoch from (v_now - r.updated_at)) / 3600;
      if age >= v_premier and age < v_escalade then
        select max(sent_at) into last_r from public.relances
          where type='inaction' and affectation_id=r.aff_id and cible='artisan';
        if last_r is null or extract(epoch from (v_now - last_r))/3600 >= v_interval then
          perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
            'event','relance_inaction','email',r.email,'artisan_prenom',r.prenom,'artisan_nom',r.nom,
            'client_nom',r.client_nom,'statut',r.statut,'metier',r.metier,'client_ville',r.client_ville,
            'lien','https://crm-ci7k.vercel.app/artisan/'||r.a_token));
          insert into public.relances(type,projet_id,affectation_id,cible) values('inaction',r.projet_id,r.aff_id,'artisan');
        end if;
      elsif age >= v_escalade then
        if not exists (select 1 from public.relances where type='inaction_escalade' and affectation_id=r.aff_id
                       and sent_at > v_now - interval '24 hours') then
          perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
            'event','escalade','sujet','inaction',
            'artisan',trim(coalesce(r.prenom,'')||' '||r.nom),'client_nom',r.client_nom,'statut',r.statut,
            'lien','https://crm-ci7k.vercel.app/projets/'||r.projet_id));
          insert into public.relances(type,projet_id,affectation_id,cible) values('inaction_escalade',r.projet_id,r.aff_id,'agence');
          insert into public.notifications(type,titre,message,projet_id) values(
            'a_appeler','À relancer : '||trim(coalesce(r.prenom,'')||' '||r.nom),
            'Aucune action depuis '||round(age)||'h sur '||coalesce(r.client_nom,'le chantier')||' ('||coalesce(r.statut,'')||')',
            r.projet_id);
        end if;
      end if;
    end loop;
  end if;

  if cfg('auto_post_rdv','on') = 'on' then
    for r in
      select af.id aff_id, af.projet_id, af.date_rdv, ar.email, ar.prenom, ar.nom, ar.token a_token,
             p.client_nom, p.metier, p.client_ville
      from public.affectations af
      join public.artisans ar on ar.id = af.artisan_id
      join public.projets p on p.id = af.projet_id
      where af.statut = 'rdv_pris' and af.date_rdv is not null
        and p.deleted_at is null and ar.ecarte_at is null and ar.email is not null
        and v_now >= af.date_rdv + (v_postrdv_premier * interval '1 hour')
        and not exists (select 1 from public.suivis s where s.affectation_id = af.id and s.created_at > af.date_rdv)
    loop
      select count(*), max(sent_at) into v_cnt, last_r from public.relances
        where type='post_rdv' and affectation_id=r.aff_id and cible='artisan';
      if v_cnt < 2 and (last_r is null or extract(epoch from (v_now - last_r))/3600 >= v_postrdv_relance) then
        perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
          'event','relance_post_rdv','email',r.email,'artisan_prenom',r.prenom,'artisan_nom',r.nom,
          'client_nom',r.client_nom,'metier',r.metier,'client_ville',r.client_ville,
          'rappel', v_cnt + 1,
          'lien','https://crm-ci7k.vercel.app/artisan/'||r.a_token));
        insert into public.relances(type,projet_id,affectation_id,cible) values('post_rdv',r.projet_id,r.aff_id,'artisan');
      end if;
    end loop;
  end if;

  if cfg('auto_orphelin','on') = 'on' then
    if not exists (select 1 from public.relances where type='orphelin'
                   and sent_at::date = (v_now at time zone 'Europe/Paris')::date) then
      if exists (select 1 from public.projets p where p.statut='nouveau' and p.deleted_at is null
                 and not exists (select 1 from public.affectations a where a.projet_id=p.id)
                 and extract(epoch from (v_now - p.created_at))/3600 >= 24) then
        perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
          'event','lead_orphelin',
          'projets', (select jsonb_agg(jsonb_build_object(
              'client',p.client_nom,'ville',p.client_ville,'metier',p.metier,'budget',p.budget_estime
            ) order by p.budget_estime desc nulls last)
            from public.projets p where p.statut='nouveau' and p.deleted_at is null
              and not exists (select 1 from public.affectations a where a.projet_id=p.id)
              and extract(epoch from (v_now - p.created_at))/3600 >= 24)));
        insert into public.relances(type,cible) values('orphelin','agence');
      end if;
    end if;
  end if;
end;
$function$
;
