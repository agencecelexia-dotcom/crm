-- Suivi des tentatives d'appel sur les chantiers à réattribuer.
--
-- LE PROBLÈME
--
-- 499 appels sont déjà enregistrés, mais leur RÉSULTAT n'existe que dans le
-- texte du message (« 📞 Appel — pas de réponse »). Compter les tentatives
-- infructueuses obligerait à analyser une chaîne de caractères — fragile, et
-- impossible à filtrer ou trier efficacement.
--
-- Le résultat devient donc une colonne à part entière. Les 499 lignes
-- existantes sont récupérées : leurs trois formats sont constants et connus.
--
-- CE QUE ÇA PERMET
--
-- Savoir, en face de chaque chantier, combien de fois on a essayé de joindre le
-- client et ce que ça a donné. Un chantier appelé cinq fois sans réponse n'est
-- pas un chantier « à réattribuer » — c'est un chantier mort qui encombre la
-- pile.

-- ---------- 1) Le résultat devient une colonne ----------

alter table public.suivis
  add column if not exists resultat_appel text;

comment on column public.suivis.resultat_appel is
  'Résultat d''une tentative d''appel : pas_de_reponse · repondu · rappeler · '
  'faux_numero. Nul pour tout suivi qui n''est pas un appel.';

-- Récupération de l'existant. Les trois formats sont constants depuis 0057.
update public.suivis
   set resultat_appel = case
         when message like '%pas de réponse%'         then 'pas_de_reponse'
         when message like '%client joint%'           then 'repondu'
         when message like '%à rappeler plus tard%'   then 'rappeler'
         when message like '%injoignable%'            then 'faux_numero'
         else 'pas_de_reponse'
       end
 where type = 'appel'
   and resultat_appel is null;

create index if not exists idx_suivis_appels
  on public.suivis (projet_id, created_at)
  where type = 'appel';

-- ---------- 2) L'artisan renseigne aussi la colonne ----------
--
-- Même corps qu'en 0057, avec l'écriture du résultat en plus : sans cela, les
-- appels enregistrés depuis l'espace artisan ne seraient pas comptés.

create or replace function public.log_appel_by_token(
  p_token text, p_resultat text default 'pas_de_reponse', p_message text default null
) returns json
language plpgsql security definer set search_path to 'public'
as $function$
declare af public.affectations; v_txt text;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  v_txt := case p_resultat
    when 'pas_de_reponse' then '📞 Appel — pas de réponse'
    when 'repondu'        then '📞 Appel — client joint'
    when 'rappeler'       then '📞 Appel — à rappeler plus tard'
    when 'faux_numero'    then '📞 Appel — numéro injoignable / invalide'
    else '📞 Appel' end;
  if coalesce(btrim(p_message), '') <> '' then
    v_txt := v_txt || ' — ' || btrim(p_message);
  end if;
  insert into public.suivis (projet_id, affectation_id, auteur, type, message, resultat_appel)
  values (af.projet_id, af.id, 'artisan', 'appel', v_txt, p_resultat);
  return json_build_object('ok', true);
end;
$function$;

-- ---------- 3) L'agence enregistre ses propres appels ----------
--
-- Fonction distincte de celle par token : ici l'appelant est authentifié, et le
-- suivi doit être attribué à l'agence, pas à l'artisan. Confondre les deux
-- rendrait l'historique illisible.

create or replace function public.log_appel(
  p_projet_id uuid,
  p_resultat text default 'pas_de_reponse',
  p_message text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_txt text;
begin
  if p_resultat not in ('pas_de_reponse', 'repondu', 'rappeler', 'faux_numero') then
    return json_build_object('ok', false, 'error', 'resultat_invalide');
  end if;

  -- Le chantier doit être dans le périmètre de l'appelant : sans ce contrôle,
  -- n'importe qui pourrait écrire l'historique d'un dossier qu'il ne voit pas.
  if p_projet_id not in (select public.mes_projets()) then
    return json_build_object('ok', false, 'error', 'hors_perimetre');
  end if;

  v_txt := case p_resultat
    when 'pas_de_reponse' then '📞 Appel — pas de réponse'
    when 'repondu'        then '📞 Appel — client joint'
    when 'rappeler'       then '📞 Appel — à rappeler plus tard'
    when 'faux_numero'    then '📞 Appel — numéro injoignable / invalide'
    end;
  if coalesce(btrim(p_message), '') <> '' then
    v_txt := v_txt || ' — ' || btrim(p_message);
  end if;

  insert into public.suivis (projet_id, auteur, type, message, resultat_appel)
  values (p_projet_id, 'agence', 'appel', v_txt, p_resultat);

  return json_build_object('ok', true);
end
$function$;

comment on function public.log_appel(uuid, text, text) is
  'Enregistre une tentative d''appel côté agence. Distincte de '
  'log_appel_by_token, qui attribue le suivi à l''artisan.';

revoke all on function public.log_appel(uuid, text, text) from public, anon;
grant execute on function public.log_appel(uuid, text, text) to authenticated;

-- ---------- 4) La liste expose l'historique d'appels ----------
--
-- Reprise à l'identique de la version en production, avec les quatre champs
-- d'appel en plus. Réécrire la fonction de mémoire risquerait de perdre une
-- clause au passage.

CREATE OR REPLACE FUNCTION public.chantiers_a_reattribuer()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(json_agg(x order by x.sorti_le desc), '[]'::json)
  from (
    select
      p.id                         as projet_id,
      af.id                        as affectation_id,
      p.client_nom,
      p.client_telephone,
      p.client_ville,
      p.client_code_postal,
      p.metier,
      p.metiers,
      p.description,
      p.statut                     as statut_projet,
      coalesce(a.societe, a.nom)   as artisan_nom,
      af.artisan_id,
      af.etape,
      af.montant_devis,
      af.devis_url is not null     as devis_depose,
      af.motif_perte,
      af.motif_perte_detail,
      coalesce(af.retire_at, af.perdu_at, af.updated_at) as sorti_le,
      case
        when af.retire_at is not null then 'retrait'
        when af.statut = 'perdu'      then 'perdu'
        else 'masque'
      end as nature,
      (select s.message from public.suivis s
        where s.affectation_id = af.id and coalesce(btrim(s.message), '') <> ''
        order by s.created_at desc limit 1) as derniere_raison,
      -- Toujours 0 par construction (origine = 'reprise'), mais conservé : le
      -- front l'affiche et d'autres appelants peuvent en dépendre.
      0::bigint as artisans_actifs,
      p.assigne_a,
      (select m.nom from public.membres m where m.user_id = p.assigne_a) as assigne_nom,
      (current_date - coalesce(af.retire_at, af.perdu_at, af.updated_at)::date) as jours_dattente,

      -- Historique des tentatives d'appel, dans l'ordre. Le front en fait cinq
      -- pastilles : rouge quand personne n'a décroché, verte quand le client a
      -- répondu. Cinq échecs d'affilée disent qu'il faut cesser d'insister.
      coalesce((
        select json_agg(s.resultat_appel order by s.created_at)
          from public.suivis s
         where s.projet_id = p.id
           and s.type = 'appel'
           and s.resultat_appel is not null
      ), '[]'::json) as appels,
      (select count(*) from public.suivis s
        where s.projet_id = p.id and s.type = 'appel') as nb_appels,
      (select count(*) from public.suivis s
        where s.projet_id = p.id and s.type = 'appel'
          and s.resultat_appel = 'pas_de_reponse') as nb_sans_reponse,
      (select max(s.created_at) from public.suivis s
        where s.projet_id = p.id and s.type = 'appel') as dernier_appel
    from public.affectations af
    join public.projets p on p.id = af.projet_id
    left join public.artisans a on a.id = af.artisan_id
    where p.deleted_at is null
      -- Le filtre tient maintenant en une condition : plus personne dessus.
      and p.origine = 'reprise'
      and p.statut not in ('mort', 'devis_signe', 'termine', 'artisan_demarche')
      and (af.retire_at is not null or af.masque_at is not null or af.statut = 'perdu')
      -- Une seule ligne par projet : la sortie la plus récente. Sans cela, un
      -- chantier passé par trois artisans apparaissait trois fois.
      and af.id = (
        select af2.id from public.affectations af2
         where af2.projet_id = p.id
           and (af2.retire_at is not null or af2.masque_at is not null
                or af2.statut = 'perdu')
         order by coalesce(af2.retire_at, af2.perdu_at, af2.updated_at) desc
         limit 1
      )
  ) x;
$function$;
