-- Aucun accès aux chantiers avant la signature du contrat (0200).
-- Exécuté sur PostgreSQL LOCAL jetable ; toutes les écritures sont annulées.
begin;
select set_config('request.jwt.claim.role', 'anon', true);

do $audit$
declare
  a uuid; a_ext uuid; p uuid; af uuid; c public.contrats;
  espace json; r json;
begin
  insert into public.artisans(nom, contrat_externe, token)
  values ('Audit fictif non signé', false, 'audit-avant-signature') returning id into a;
  insert into public.artisans(nom, contrat_externe, token)
  values ('Audit fictif contrat externe', true, 'audit-contrat-externe') returning id into a_ext;
  insert into public.projets(client_nom, client_ville, description, budget_estime, metier, statut, latitude, longitude, photos)
  values ('Client fictif', 'Ville fictive', 'Description privée', 9000, 'Couverture', 'nouveau', 47.2, -1.5,
          array['https://example.test/photo.jpg']) returning id into p;
  insert into public.affectations(projet_id, artisan_id, token)
  values (p, a, 'audit-af-avant-signature') returning id into af;
  insert into public.affectations(projet_id, artisan_id, token)
  values (p, a_ext, 'audit-af-contrat-externe');
  insert into public.projet_documents(projet_id, nom, chemin, visible_artisan)
  values (p, 'plan-fictif.pdf', p::text || '/pieces/fictif.pdf', true);

  -- 1. Avant signature : aucun chantier, seulement leur nombre.
  espace := public.get_espace_artisan('audit-avant-signature');
  if (espace->>'signe')::boolean then raise exception 'AUDIT: fixture déjà signée'; end if;
  if json_array_length(espace->'projets') <> 0 then
    raise exception 'AUDIT: chantiers visibles avant signature : %', espace->'projets';
  end if;
  if json_array_length(espace->'projets_perdus') <> 0 then
    raise exception 'AUDIT: chantiers perdus visibles avant signature';
  end if;
  if (espace->>'nb_chantiers_en_attente')::int <> 1 then
    raise exception 'AUDIT: nombre de chantiers en attente faux : %', espace->>'nb_chantiers_en_attente';
  end if;
  if espace::text like '%Description privée%' or espace::text like '%photo.jpg%' or espace::text like '%Ville fictive%' then
    raise exception 'AUDIT: détail de chantier dans la réponse avant signature';
  end if;

  -- 2. Ni position de la maison, ni échanges, ni documents avant signature.
  r := public.metre_contexte_by_token('audit-avant-signature', 'audit-af-avant-signature');
  if r->>'error' is distinct from 'contrat_requis' or r::text like '%47.2%' then
    raise exception 'AUDIT: position de la maison livrée avant signature : %', r;
  end if;
  r := public.contexte_devis_by_token('audit-avant-signature', 'audit-af-avant-signature');
  if r->>'error' is distinct from 'contrat_requis' then
    raise exception 'AUDIT: contexte de chantier livré avant signature : %', r;
  end if;
  if json_array_length(public.documents_projet_par_token('audit-af-avant-signature')) <> 0 then
    raise exception 'AUDIT: documents listés avant signature';
  end if;

  -- 3. Après signature : tout revient.
  c := public.ensure_engagement_contrat(a);
  update public.contrats set statut = 'signe', signed_at = now(), signataire_nom = 'Fictif' where id = c.id;
  espace := public.get_espace_artisan('audit-avant-signature');
  if json_array_length(espace->'projets') <> 1 or (espace->>'nb_chantiers_en_attente')::int <> 0 then
    raise exception 'AUDIT: chantiers absents après signature : %', espace->'projets';
  end if;
  if (espace->'projets'->0->>'client_nom') is distinct from 'Client fictif' then
    raise exception 'AUDIT: coordonnées client absentes après signature';
  end if;
  r := public.metre_contexte_by_token('audit-avant-signature', 'audit-af-avant-signature');
  if not (r->>'ok')::boolean or (r->>'latitude')::numeric <> 47.2 then
    raise exception 'AUDIT: métré refusé après signature : %', r;
  end if;
  if (public.contexte_devis_by_token('audit-avant-signature', 'audit-af-avant-signature')->>'ok')::boolean is not true then
    raise exception 'AUDIT: contexte devis refusé après signature';
  end if;
  if json_array_length(public.documents_projet_par_token('audit-af-avant-signature')) <> 1 then
    raise exception 'AUDIT: documents absents après signature';
  end if;

  -- 4. Un contrat externe (enregistré par l'agence) vaut signature.
  espace := public.get_espace_artisan('audit-contrat-externe');
  if json_array_length(espace->'projets') <> 1 then
    raise exception 'AUDIT: contrat externe privé de ses chantiers';
  end if;
end
$audit$;
rollback;
