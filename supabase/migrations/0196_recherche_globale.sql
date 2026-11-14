-- Recherche unique, sans copie des fiches ni élargissement de leurs droits.
create function public.texte_recherche(p_texte text)
returns text language sql immutable parallel safe set search_path = public, pg_temp as $$
  select trim(regexp_replace(translate(replace(replace(lower(coalesce(p_texte,'')), 'œ','oe'), 'æ','ae'),
    'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '[^a-z0-9]+', ' ', 'g'));
$$;
create function public.telephone_recherche(p_texte text)
returns text language sql immutable parallel safe set search_path = public, pg_temp as $$
  with n as (select regexp_replace(coalesce(p_texte,''),'[^0-9]','','g') as chiffres)
  select case
    when chiffres like '0033%' then '0'||substr(chiffres,5)
    when trim(p_texte) like '+33%' or chiffres ~ '^33[1-9][0-9]{8}$' then '0'||substr(chiffres,3)
    else chiffres end from n;
$$;
revoke all on function public.texte_recherche(text), public.telephone_recherche(text) from public;
grant execute on function public.texte_recherche(text), public.telephone_recherche(text) to authenticated;

create function public.recherche_globale(p_recherche text)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare q text; chiffres text;
begin
  if not exists(select 1 from public.membres where user_id=auth.uid() and actif) then
    raise exception 'connexion_requise' using errcode='42501';
  end if;
  q:=public.texte_recherche(left(p_recherche,160));
  if length(q)<2 then return jsonb_build_object('resultats','[]'::jsonb,'total',0); end if;
  if trim(p_recherche) ~ '^[0-9+().[:space:]-]+$' then
    chiffres:=public.telephone_recherche(p_recherche);
  end if;
  return (
    with fiches as (
      select p.id, 'projet'::text as type, p.client_nom as nom, p.client_ville as ville,
        p.client_telephone as telephone, p.client_email as email, p.statut::text as statut,
        (p.masque_agence_at is not null) as masque, array_to_string(p.metiers,', ') as detail,
        public.texte_recherche(concat_ws(' ',p.client_nom,p.client_ville,p.client_code_postal,
          p.client_adresse,p.client_telephone,p.client_email,array_to_string(p.metiers,' '))) as texte,
        public.telephone_recherche(p.client_telephone) as numero
      from public.projets p where p.deleted_at is null
      union all
      select a.id, case when a.partenaire_at is not null then 'partenaire' else 'artisan' end,
        coalesce(nullif(a.societe,''),nullif(concat_ws(' ',a.prenom,a.nom),''),'Artisan'),
        a.ville,a.telephone,a.email,null::text,(a.ecarte_at is not null),
        concat_ws(' · ',nullif(concat_ws(' ',a.prenom,a.nom),''),nullif(array_to_string(a.metiers,', '),'')),
        public.texte_recherche(concat_ws(' ',a.nom,a.prenom,a.societe,a.telephone,a.email,
          a.ville,a.code_postal,a.adresse,a.siren,array_to_string(a.metiers,' '))),
        public.telephone_recherche(a.telephone)
      from public.artisans a
    ), correspondances as (
      select *, case
        when length(chiffres)>=6 and numero=chiffres then 0
        when lower(email)=lower(trim(p_recherche)) then 0
        when public.texte_recherche(nom)=q then 1
        when starts_with(public.texte_recherche(nom),q) then 2
        else 3 end as rang
      from fiches f where
        (length(chiffres)>=2 and position(chiffres in f.numero)>0)
        or not exists(select 1 from unnest(string_to_array(q,' ')) mot where position(mot in f.texte)=0)
    ), selection as (
      select * from correspondances order by rang,masque,nom,id limit 30
    )
    select jsonb_build_object('total',(select count(*) from correspondances),
      'resultats',coalesce(jsonb_agg(jsonb_build_object(
        'id',id,'type',type,'nom',nom,'ville',ville,'telephone',telephone,'email',email,
        'statut',statut,'masque',masque,'detail',detail
      ) order by rang,masque,nom,id),'[]'::jsonb)) from selection
  );
end;
$$;
revoke all on function public.recherche_globale(text) from public, anon;
grant execute on function public.recherche_globale(text) to authenticated;
