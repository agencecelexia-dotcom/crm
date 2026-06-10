-- 0032 — Relance POST-RDV à l'artisan.
-- Quand l'artisan déclare « RDV pris » avec une date, on stocke cette date
-- (affectations.date_rdv). 24h APRÈS la date du RDV, s'il n'a ni changé de statut
-- ni ajouté de note (= rien fait depuis le rendez-vous), il reçoit un email
-- « Comment s'est passé le RDV ? pensez à déposer le devis ». Au plus 2 relances
-- (24h puis +24h). Garde-fou horaire 8h-20h (via traiter_relances).

-- 1) Date du RDV (structurée) sur l'affectation
alter table public.affectations add column if not exists date_rdv timestamptz;
comment on column public.affectations.date_rdv is
  'Date/heure du RDV déclaré par l''artisan (sert à la relance post-RDV).';

-- 2) add_suivi_by_token : accepte la date du RDV (conserve le correctif perdu de 0031)
drop function if exists public.add_suivi_by_token(text, text, text);
create or replace function public.add_suivi_by_token(
  p_token text, p_statut text default null, p_message text default null,
  p_date_rdv timestamptz default null
) returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false);
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (
    af.projet_id, af.id, 'artisan',
    case when coalesce(p_statut, '') <> '' then 'statut' else 'note' end,
    nullif(p_statut, ''), nullif(p_message, '')
  );

  if coalesce(p_statut, '') <> '' then
    update public.affectations
      set statut = p_statut,
          date_rdv = case when p_statut = 'rdv_pris' and p_date_rdv is not null
                          then p_date_rdv else date_rdv end
      where id = af.id;
    select * into af from public.affectations where id = af.id;

    perform net.http_post(
      url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
      body := jsonb_build_object(
        'event', 'changement_statut',
        'statut', p_statut,
        'artisan', (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id),
        'client_nom', (select p.client_nom from public.projets p where p.id = af.projet_id),
        'client_ville', (select p.client_ville from public.projets p where p.id = af.projet_id),
        'metier', (select p.metier from public.projets p where p.id = af.projet_id),
        'lien', 'https://crm-ci7k.vercel.app/projets/' || af.projet_id
      )
    );
  end if;

  if p_statut = 'devis_signe' then
    delete from public.affectations where projet_id = af.projet_id and id <> af.id;
    update public.projets
      set artisan_id = af.artisan_id, statut = 'devis_signe',
          montant_devis_signe = af.montant_devis_signe
      where id = af.projet_id;
  elsif p_statut in ('contacte', 'rdv_pris', 'en_attente', 'devis_envoye', 'termine', 'perdu') then
    update public.projets p set statut = coalesce(
      (
        select af2.statut from public.affectations af2
        where af2.projet_id = p.id and af2.statut <> 'perdu'
        order by case af2.statut
          when 'termine' then 5 when 'devis_signe' then 4 when 'devis_envoye' then 3
          when 'rdv_pris' then 2 when 'contacte' then 1 else 0 end desc
        limit 1
      ),
      'perdu'
    )
    where p.id = af.projet_id;
  end if;

  return json_build_object('ok', true);
end;
$function$;

-- 3) Réglages de la relance post-RDV
insert into public.app_settings (cle, valeur) values
  ('auto_post_rdv', 'on'), ('post_rdv_premier_h', '24'), ('post_rdv_relance_h', '24')
on conflict (cle) do nothing;

-- 4) Moteur : ajout du bloc POST-RDV + exclusion de ces RDV de la relance "inaction"
create or replace function public.traiter_relances()
returns void
language plpgsql
security definer
set search_path = public
as $func$
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

  -- 1) CONTRAT NON SIGNÉ
  if cfg('auto_contrat','on') = 'on' then
    for r in
      select af.id aff_id, af.projet_id, af.created_at, ar.email, ar.prenom, ar.nom, ar.token a_token,
             p.metier, p.client_ville
      from public.affectations af
      join public.artisans ar on ar.id = af.artisan_id
      join public.projets p on p.id = af.projet_id
      where af.statut not in ('perdu','termine','devis_signe')
        and ar.contrat_externe = false
        and ar.email is not null
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

  -- 2) INACTION (on EXCLUT les RDV pris avec une date : gérés par le bloc post-RDV)
  if cfg('auto_inaction','on') = 'on' then
    for r in
      select af.id aff_id, af.projet_id, af.updated_at, af.statut, ar.email, ar.prenom, ar.nom, ar.token a_token,
             p.client_nom, p.metier, p.client_ville
      from public.affectations af
      join public.artisans ar on ar.id = af.artisan_id
      join public.projets p on p.id = af.projet_id
      where af.statut in ('artisan_assigne','contacte','rdv_pris','en_attente')
        and not (af.statut = 'rdv_pris' and af.date_rdv is not null)
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
            'client_nom',r.client_nom,'statut',r.statut,
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

  -- 2bis) POST-RDV : 24h après le RDV, si l'artisan n'a rien fait depuis (ni statut, ni note)
  if cfg('auto_post_rdv','on') = 'on' then
    for r in
      select af.id aff_id, af.projet_id, af.date_rdv, ar.email, ar.prenom, ar.nom, ar.token a_token,
             p.client_nom, p.metier, p.client_ville
      from public.affectations af
      join public.artisans ar on ar.id = af.artisan_id
      join public.projets p on p.id = af.projet_id
      where af.statut = 'rdv_pris'
        and af.date_rdv is not null
        and ar.email is not null
        and v_now >= af.date_rdv + (v_postrdv_premier * interval '1 hour')
        and not exists (
          select 1 from public.suivis s where s.affectation_id = af.id and s.created_at > af.date_rdv
        )
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

  -- 3) LEAD ORPHELIN (digest quotidien à l'agence)
  if cfg('auto_orphelin','on') = 'on' then
    if not exists (select 1 from public.relances where type='orphelin'
                   and sent_at::date = (v_now at time zone 'Europe/Paris')::date) then
      if exists (select 1 from public.projets p where p.statut='nouveau'
                 and not exists (select 1 from public.affectations a where a.projet_id=p.id)
                 and extract(epoch from (v_now - p.created_at))/3600 >= 24) then
        perform net.http_post(url := WEBHOOK, body := jsonb_build_object(
          'event','lead_orphelin',
          'projets', (select jsonb_agg(jsonb_build_object(
              'client',p.client_nom,'ville',p.client_ville,'metier',p.metier,'budget',p.budget_estime
            ) order by p.budget_estime desc nulls last)
            from public.projets p where p.statut='nouveau'
              and not exists (select 1 from public.affectations a where a.projet_id=p.id)
              and extract(epoch from (v_now - p.created_at))/3600 >= 24)));
        insert into public.relances(type,cible) values('orphelin','agence');
      end if;
    end if;
  end if;
end;
$func$;
