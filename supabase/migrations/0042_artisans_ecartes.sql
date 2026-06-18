-- 0042 — Artisans « écartés / pas fiables ».
-- Au lieu de supprimer un artisan peu fiable, on l'écarte : il sort de la liste
-- active (plus assignable, plus relancé, hors carte/stats) mais reste conservé
-- dans une liste « Pas fiables » pour ne pas le recontacter / re-saisir.

alter table public.artisans add column if not exists ecarte_at timestamptz;
alter table public.artisans add column if not exists ecarte_motif text;
create index if not exists idx_artisans_ecarte on public.artisans (ecarte_at);

-- traiter_relances : ne relance plus les artisans écartés.
create or replace function public.traiter_relances()
returns void language plpgsql security definer set search_path to 'public'
as $function$
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
      where af.statut not in ('perdu','termine','devis_signe')
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
      where af.statut in ('artisan_assigne','contacte','rdv_pris','en_attente')
        and not (af.statut = 'rdv_pris' and af.date_rdv is not null)
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
$function$;

-- rafraichir_taches : pas de tâche (contrat/devis/RDV) pour un artisan écarté.
create or replace function public.rafraichir_taches()
returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  delete from public.taches where statut = 'fait' and done_at < now() - interval '24 hours';

  create temp table _act on commit drop as
    select 'assign:' || p.id as cle, 'Assigner un artisan' as titre,
           trim(both ' ·' from coalesce(p.client_nom,'') || ' · ' || coalesce(p.client_ville,'') || ' · ' || coalesce(p.metier,'')) as details,
           'assignation' as categorie,
           case when coalesce(p.estimation_interne,0) >= 10000 then 1 else 3 end as priorite,
           coalesce(p.estimation_interne,0) as valeur,
           p.id as projet_id, null::uuid as artisan_id, null::text as tel
    from public.projets p
    where p.statut = 'nouveau' and p.deleted_at is null
      and not exists (select 1 from public.affectations a where a.projet_id = p.id)
  union all
    select 'contrat:' || af.id, 'Faire signer le contrat',
           coalesce(ar.societe, ar.nom) || ' · ' || coalesce(p.client_nom,''),
           'contrat', 2, coalesce(p.estimation_interne,0), p.id, ar.id, ar.telephone
    from public.affectations af
    join public.artisans ar on ar.id = af.artisan_id
    join public.projets p on p.id = af.projet_id
    where af.statut not in ('perdu','termine','devis_signe') and p.deleted_at is null
      and ar.ecarte_at is null and ar.contrat_externe = false
      and not exists (select 1 from public.contrats c where c.artisan_id = ar.id and c.statut = 'signe')
  union all
    select 'devis:' || af.id, 'Relancer le devis envoyé',
           coalesce(ar.societe, ar.nom) || ' · ' || coalesce(p.client_nom,''),
           'devis', 2, coalesce(p.estimation_interne,0), p.id, ar.id, ar.telephone
    from public.affectations af
    join public.artisans ar on ar.id = af.artisan_id
    join public.projets p on p.id = af.projet_id
    where af.statut = 'devis_envoye' and p.deleted_at is null and ar.ecarte_at is null
      and af.updated_at < now() - interval '48 hours'
  union all
    select 'rdv:' || af.id, 'Débriefer le RDV',
           coalesce(ar.societe, ar.nom) || ' · ' || coalesce(p.client_nom,''),
           'rdv', 2, coalesce(p.estimation_interne,0), p.id, ar.id, ar.telephone
    from public.affectations af
    join public.artisans ar on ar.id = af.artisan_id
    join public.projets p on p.id = af.projet_id
    where af.statut = 'rdv_pris' and af.date_rdv is not null and af.date_rdv < now()
      and p.deleted_at is null and ar.ecarte_at is null
      and not exists (select 1 from public.suivis s where s.affectation_id = af.id and s.created_at > af.date_rdv)
  union all
    select 'commission:' || p.id, 'Encaisser la commission',
           coalesce(p.client_nom,'') || ' · ' || round(coalesce(p.commission,0))::text || ' €',
           'commission', 2, coalesce(p.commission,0), p.id, p.artisan_id,
           (select a2.telephone from public.artisans a2 where a2.id = p.artisan_id)
    from public.projets p
    where p.deleted_at is null and p.montant_devis_signe is not null and p.commission_encaissee = false;

  insert into public.taches (titre, details, priorite, valeur, type, categorie, projet_id, artisan_id, tel, cle_auto)
  select a.titre, a.details, a.priorite, a.valeur, 'auto', a.categorie, a.projet_id, a.artisan_id, a.tel, a.cle
  from _act a
  where not exists (select 1 from public.taches t where t.cle_auto = a.cle);

  update public.taches t set priorite = a.priorite, valeur = a.valeur
  from _act a where t.cle_auto = a.cle and (t.priorite <> a.priorite or coalesce(t.valeur,-1) <> a.valeur);

  delete from public.taches t
  where t.type = 'auto' and t.statut = 'a_faire'
    and not exists (select 1 from _act a where a.cle = t.cle_auto);
end;
$function$;

-- stats_artisans : exclut les artisans écartés du classement.
create or replace function public.stats_artisans()
returns json language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    json_agg(
      json_build_object(
        'id', id, 'nom', nom,
        'gagnes', gagnes, 'ca_signe', ca_signe, 'commission', commission,
        'en_cours', en_cours, 'perdus', perdus,
        'taux', case when (gagnes + perdus) > 0
                     then round(gagnes::numeric * 100 / (gagnes + perdus)) else null end,
        'delai_h', delai_h
      )
      order by ca_signe desc, gagnes desc
    ), '[]'::json
  )
  from (
    select
      a.id,
      coalesce(a.societe, nullif(trim(coalesce(a.prenom,'') || ' ' || coalesce(a.nom,'')), '')) as nom,
      g.gagnes, g.ca_signe, g.commission, c.en_cours, c.perdus, d.delai_h
    from public.artisans a
    left join lateral (
      select count(*) as gagnes, coalesce(sum(p.montant_devis_signe), 0) as ca_signe,
             coalesce(sum(p.commission), 0) as commission
      from public.projets p
      where p.artisan_id = a.id and p.deleted_at is null and p.statut in ('devis_signe', 'termine')
    ) g on true
    left join lateral (
      select count(*) filter (where af.statut in ('artisan_assigne','contacte','rdv_pris','en_attente','devis_envoye')) as en_cours,
             count(*) filter (where af.statut = 'perdu') as perdus
      from public.affectations af join public.projets p2 on p2.id = af.projet_id
      where af.artisan_id = a.id and p2.deleted_at is null
    ) c on true
    left join lateral (
      select round(avg(extract(epoch from (fs.first_at - af.created_at)) / 3600)::numeric, 1) as delai_h
      from public.affectations af
      join lateral (select min(s.created_at) as first_at from public.suivis s
                    where s.affectation_id = af.id and s.auteur = 'artisan') fs on true
      where af.artisan_id = a.id and fs.first_at is not null
    ) d on true
    where a.ecarte_at is null and (g.gagnes > 0 or c.en_cours > 0 or c.perdus > 0)
  ) t
$function$;
