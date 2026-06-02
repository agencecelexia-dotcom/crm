-- ============================================================
--  0008 — Infos société de l'artisan (pour le contrat) + taux variable
-- ============================================================

-- ---------- Artisan : champs société (auto-remplis via SIRET) + taux par défaut ----------
alter table public.artisans
  add column if not exists forme_juridique text,
  add column if not exists capital_social text,
  add column if not exists siren text,
  add column if not exists ville_immatriculation text,
  add column if not exists representant text,
  add column if not exists qualite_representant text,
  add column if not exists taux_commission numeric not null default 0.10;

-- ---------- Projet : taux de commission par projet (défaut 10 %) ----------
alter table public.projets
  add column if not exists taux_commission numeric not null default 0.10;

-- Recalcule la colonne commission générée à partir du taux du projet
alter table public.projets drop column if exists commission;
alter table public.projets
  add column commission numeric
  generated always as (coalesce(montant_devis_signe, 0) * coalesce(taux_commission, 0.10)) stored;

-- ---------- get_mission_by_token : lecture seule (plus de création automatique) ----------
-- Le contrat est désormais généré côté CRM (variables remplies). Ici on lit
-- simplement le contrat existant de l'artisan (ou null s'il n'a pas encore été préparé).
create or replace function public.get_mission_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare
  p public.projets;
  a public.artisans;
  c public.contrats;
begin
  select * into p from public.projets where token = p_token;
  if p.id is null then
    return null;
  end if;

  if p.artisan_id is not null then
    select * into a from public.artisans where id = p.artisan_id;
    select * into c from public.contrats
      where artisan_id = p.artisan_id
      order by created_at asc
      limit 1;
  end if;

  return json_build_object(
    'projet', json_build_object(
      'client_nom', p.client_nom,
      'client_telephone', p.client_telephone,
      'client_email', p.client_email,
      'client_adresse', p.client_adresse,
      'client_code_postal', p.client_code_postal,
      'client_ville', p.client_ville,
      'metier', p.metier,
      'sous_metier', p.sous_metier,
      'description', p.description,
      'budget_estime', p.budget_estime,
      'statut', p.statut,
      'devis_depose', p.devis_url is not null,
      'devis_signe_depose', p.devis_signe_url is not null
    ),
    'artisan', case when a.id is not null
      then json_build_object('nom', a.nom, 'prenom', a.prenom, 'societe', a.societe)
      else null end,
    'engagement', case when c.id is not null
      then json_build_object(
        'token', c.token, 'statut', c.statut, 'contenu', c.contenu,
        'signataire_nom', c.signataire_nom, 'signed_at', c.signed_at,
        'signature_data', c.signature_data)
      else null end
  );
end;
$func$;

grant execute on function public.get_mission_by_token(text) to anon, authenticated;
