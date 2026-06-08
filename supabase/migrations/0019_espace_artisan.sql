-- ============================================================
--  0019 — Espace artisan unique : un token par artisan.
--  L'artisan signe son contrat une fois puis accède à TOUS ses
--  chantiers via /artisan/:token. Identité client masquée tant que
--  le contrat n'est pas signé (masquage côté serveur).
-- ============================================================

alter table public.artisans
  add column if not exists token text unique
  default replace(gen_random_uuid()::text, '-', '');

-- Rétro-remplissage des artisans existants sans token
update public.artisans
  set token = replace(gen_random_uuid()::text, '-', '')
  where token is null;

-- ---------- Lecture publique de l'espace artisan (par token artisan) ----------
create or replace function public.get_espace_artisan(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  a public.artisans;
  c public.contrats;
  v_signe boolean;
begin
  select * into a from public.artisans where token = p_token;
  if a.id is null then return null; end if;

  c := public.ensure_engagement_contrat(a.id);
  v_signe := c.statut = 'signe';

  return json_build_object(
    'artisan', json_build_object('nom', a.nom, 'prenom', a.prenom, 'societe', a.societe),
    'engagement', json_build_object(
      'token', c.token, 'statut', c.statut, 'contenu', c.contenu,
      'signataire_nom', c.signataire_nom, 'signed_at', c.signed_at,
      'signature_data', c.signature_data, 'apporteur_signature', c.apporteur_signature
    ),
    'signe', v_signe,
    'projets', (
      select coalesce(json_agg(p_json order by ord, cree desc), '[]'::json)
      from (
        select
          -- ordre : actifs d'abord, perdu/devis_signe en bas
          case p.statut when 'perdu' then 2 when 'devis_signe' then 1 else 0 end as ord,
          p.created_at as cree,
          json_build_object(
            'id', p.id,
            'token', p.token,
            'statut', p.statut,
            'metier', p.metier,
            'metiers', p.metiers,
            'sous_metier', p.sous_metier,
            'description', p.description,
            'budget_estime', p.budget_estime,
            'client_ville', p.client_ville,
            'photos', coalesce(p.photos, '{}'),
            'devis_depose', p.devis_url is not null,
            'devis_signe_depose', p.devis_signe_url is not null,
            -- identité client : seulement si le contrat est signé
            'client_nom', case when v_signe then p.client_nom else null end,
            'client_telephone', case when v_signe then p.client_telephone else null end,
            'client_email', case when v_signe then p.client_email else null end,
            'client_adresse', case when v_signe then p.client_adresse else null end,
            'client_code_postal', case when v_signe then p.client_code_postal else null end,
            'suivis', (
              select coalesce(json_agg(json_build_object(
                'auteur', s.auteur, 'type', s.type, 'statut', s.statut_artisan,
                'message', s.message, 'created_at', s.created_at
              ) order by s.created_at), '[]'::json)
              from public.suivis s where s.projet_id = p.id
            )
          ) as p_json
        from public.projets p
        where p.artisan_id = a.id
      ) sub
    )
  );
end;
$func$;

grant execute on function public.get_espace_artisan(text) to anon, authenticated;
