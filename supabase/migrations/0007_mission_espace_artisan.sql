-- ============================================================
--  0007 — "Espace artisan" public par projet (mission)
--  Un lien public unique par projet : l'artisan signe son contrat
--  d'engagement (si pas déjà fait), puis accède au dossier client
--  et dépose le devis / le devis signé. Accès par token uniquement.
-- ============================================================

-- Token public par projet (lien espace artisan)
alter table public.projets
  add column if not exists token text not null unique
  default replace(gen_random_uuid()::text, '-', '');

-- ---------- Contrat d'engagement : création idempotente ----------
-- Crée le contrat d'engagement de l'artisan s'il n'existe pas, sinon le renvoie.
-- Texte par défaut (PROVISOIRE) — à remplacer par les clauses définitives.
create or replace function public.ensure_engagement_contrat(p_artisan_id uuid)
returns public.contrats
language plpgsql
security definer
set search_path = public
as $func$
declare
  a public.artisans;
  c public.contrats;
  v_contenu text;
begin
  select * into a from public.artisans where id = p_artisan_id;
  if a.id is null then
    return null;
  end if;

  select * into c
  from public.contrats
  where artisan_id = p_artisan_id
  order by created_at asc
  limit 1;

  if c.id is not null then
    return c;
  end if;

  v_contenu :=
    $a$CONTRAT D'ENGAGEMENT — APPORT D'AFFAIRES

Entre les soussignés :

• CELEXIA, plateforme de mise en relation, ci-après « Celexia » ;
• $a$
    || coalesce(a.prenom || ' ', '') || a.nom
    || coalesce(' (' || a.societe || ')', '')
    || $b$, professionnel ci-après « l'Artisan ».

PRÉAMBULE
Celexia met en relation des particuliers ayant un projet de travaux avec des
artisans de confiance. Celexia ne réalise pas les travaux : elle présente le
client à l'Artisan, qui réalise la prestation et facture le client en direct.

ARTICLE 1 — OBJET
Le présent contrat définit les conditions dans lesquelles Celexia transmet à
l'Artisan des demandes de clients (« projets ») et la rémunération due à Celexia.

ARTICLE 2 — COMMISSION
En contrepartie de chaque projet transmis et abouti, l'Artisan s'engage à
reverser à Celexia une commission de 10 % (dix pour cent) du montant hors
taxes du devis signé avec le client.

ARTICLE 3 — FAIT GÉNÉRATEUR & PAIEMENT
La commission est due dès la signature du devis entre l'Artisan et le client.
Le paiement intervient selon les modalités convenues entre les parties.

ARTICLE 4 — ENGAGEMENTS DE L'ARTISAN
L'Artisan s'engage à traiter les clients transmis avec sérieux, à établir un
devis, et à informer Celexia de l'issue de chaque projet (devis signé ou non).

ARTICLE 5 — DURÉE
Le présent contrat prend effet à sa signature et s'applique à l'ensemble des
projets transmis par Celexia à l'Artisan.

En signant ci-dessous, l'Artisan reconnaît avoir lu et accepté l'intégralité
des présentes conditions.$b$;

  insert into public.contrats (artisan_id, contenu)
  values (p_artisan_id, v_contenu)
  returning * into c;

  return c;
end;
$func$;

grant execute on function public.ensure_engagement_contrat(uuid) to authenticated;

-- ---------- Lecture publique de la mission (par token projet) ----------
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
    c := public.ensure_engagement_contrat(p.artisan_id);
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
