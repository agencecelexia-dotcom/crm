-- Les photos de façade : une photo de rue (Panoramax, Mapillary) ou prise par
-- l'artisan, par façade de maison, et ce que la vision y a lu.
--
-- POURQUOI
--
-- Le LiDAR voit les toits d'en haut : il mesure la hauteur des murs, mais ne
-- voit ni les fenêtres ni un mur en retrait derrière une terrasse. Une photo
-- de la façade, lue par Claude, donne le nombre et la surface des ouvertures
-- (à déduire du ravalement) et une hauteur de contrôle. L'artisan confirme
-- avant que rien ne soit déduit.
--
-- Rattachée au BÂTIMENT (cleabs), comme le relevé : deux chantiers sur la même
-- maison partagent ses photos. Auteur et licence sont gardés pour être cités
-- (Panoramax et Mapillary : CC BY-SA 4.0). Tout passe par la fonction
-- `facade-photo`, qui écrit avec la clé de service ; l'agence lit.

create table if not exists public.facade_photo (
  id           uuid primary key default gen_random_uuid(),
  cleabs       text not null,
  orientation  text not null,
  source       text not null check (source in ('panoramax', 'mapillary', 'artisan')),
  -- Identifiant chez le fournisseur, ou chemin du dépôt de l'artisan.
  photo_ref    text not null,
  -- Chemin de l'image dans le stockage privé « facades ».
  chemin       text not null,
  auteur       text,
  licence      text,
  page         text,
  pris_le      timestamptz,
  lon          double precision,
  lat          double precision,
  cap          numeric,
  champ        numeric,
  largeur      integer,
  hauteur      integer,
  -- Qualité de la vue : note, distance, angle à la façade, où le mur doit
  -- apparaître (abscisses de 0 à 1000).
  note         numeric,
  distance_m   numeric,
  incidence    numeric,
  colonnes     integer[],
  deposee_par  uuid references public.artisans (id) on delete set null,
  -- Ce que la vision a lu, et ce qu'on en a tiré (_ouvertures.ts).
  lecture      jsonb,
  lu_le        timestamptz,
  lu_par       uuid references public.artisans (id) on delete set null,
  modele       text,
  cree_le      timestamptz not null default now(),
  unique (cleabs, orientation, source, photo_ref)
);

create index if not exists facade_photo_cleabs on public.facade_photo (cleabs);
create index if not exists facade_photo_quota on public.facade_photo (lu_par, lu_le);

alter table public.facade_photo enable row level security;

do $$
begin
  drop policy if exists facade_photo_lecture on public.facade_photo;
  create policy facade_photo_lecture on public.facade_photo
    for select to authenticated using (true);
end $$;

-- Les images : privées, servies par liens signés depuis la fonction.
insert into storage.buckets (id, name, public)
values ('facades', 'facades', false)
on conflict (id) do nothing;
