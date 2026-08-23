-- Deux pipes distincts pour le commercial, et un suivi des reprises pour les
-- fondateurs.
--
-- LE MODÈLE
--
-- Sur les prochains mois, la quasi-totalité des chantiers part chez Batryx. Un
-- commercial n'est donc PAS payé sur ce pipe-là : il l'observe. Sa rémunération
-- vient des chantiers que Batryx perd et qu'il parvient à replacer. D'où la
-- séparation stricte de deux listes qui ne doivent jamais se mélanger :
--
--   * le PIPE EN COURS  — tout ce qui vit chez les artisans. Lecture seule pour
--     le commercial : il voit ce qui se passe, il n'y touche pas.
--   * les À RÉATTRIBUER — les chantiers perdus, retirés ou masqués. C'est là
--     qu'il travaille, et là qu'il gagne sa commission.
--
-- CE QUI CHANGE ICI
--
-- 1. `mes_projets()` s'ouvre en LECTURE à tout le pipe pour les commerciaux.
--    Jusqu'ici un commercial ne voyait que ses propres dossiers : il lui était
--    impossible de suivre l'activité de Batryx, donc d'anticiper les pertes.
--    L'écriture, elle, reste cloisonnée — c'est l'objet du point 2.
--
-- 2. Une police d'écriture explicite : un commercial ne peut modifier qu'un
--    chantier qu'il a créé ou qui lui est assigné. Voir n'est pas pouvoir.
--
-- 3. `reprises_par_commercial()` — l'écran de suivi demandé par les fondateurs :
--    qui a repris quoi, où ça en est, ce que ça a rapporté.

-- ---------- 1) Le commercial voit tout le pipe, en lecture ----------

create or replace function public.mes_projets()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- Un membre actif voit l'ensemble du pipe : c'est la condition pour suivre
  -- l'activité de Batryx et repérer les chantiers qui vont sortir. Le
  -- cloisonnement se joue à l'ÉCRITURE, pas à la lecture.
  select p.id from public.projets p
   where exists (
     select 1 from public.membres m
      where m.user_id = auth.uid() and m.actif
   );
$function$;

comment on function public.mes_projets() is
  'Projets visibles. Tout membre actif voit le pipe entier — indispensable pour '
  'suivre Batryx. Le cloisonnement porte sur l''écriture (police projets_ecriture).';

-- ---------- 2) L'écriture reste cloisonnée ----------

do $$
begin
  -- On remplace la police d'écriture existante plutôt que d'en empiler une :
  -- deux polices permissives se cumuleraient et annuleraient la restriction.
  drop policy if exists projets_update on public.projets;

  create policy projets_update on public.projets
    for update
    using (
      public.est_fondateur()
      or created_by = auth.uid()
      or assigne_a  = auth.uid()
    )
    with check (
      public.est_fondateur()
      or created_by = auth.uid()
      or assigne_a  = auth.uid()
    );
end $$;

-- ---------- 3) Le suivi des reprises, pour les fondateurs ----------

create or replace function public.reprises_par_commercial()
returns json
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- Réservé aux fondateurs : c'est un écran de pilotage, il expose le travail
  -- de chacun et les montants en jeu.
  select case when not public.est_fondateur() then '[]'::json else
    coalesce(json_agg(x order by x.en_cours desc, x.nom), '[]'::json)
  end
  from (
    select
      m.id                as membre_id,
      m.nom,
      m.email,
      m.actif,
      m.taux_retrocession,

      -- Ce qu'il a en main aujourd'hui.
      count(*) filter (
        where p.id is not null and p.statut not in ('mort', 'devis_signe', 'termine')
      ) as en_cours,

      -- Ce qu'il a transformé : la seule chose qui déclenche sa commission.
      count(*) filter (where p.statut = 'devis_signe') as signes,

      -- Ce qui n'a rien donné, pour équilibrer la lecture.
      count(*) filter (where p.statut = 'mort') as perdus,

      -- Volume replacé, en euros.
      coalesce(sum(p.montant_devis) filter (where p.statut = 'devis_signe'), 0) as ca_signe,

      -- Sa part, telle qu'elle sera versée à l'encaissement.
      coalesce((
        select sum(r.montant) from public.retrocessions r
         where r.membre_id = m.id and r.verse_at is not null
      ), 0) as deja_verse,
      coalesce((
        select sum(r.montant) from public.retrocessions r
         where r.membre_id = m.id and r.verse_at is null
      ), 0) as a_verser,

      -- Depuis quand le plus vieux dossier attend : un chantier repris et
      -- laissé de côté est un chantier perdu une deuxième fois.
      max(current_date - p.updated_at::date) filter (
        where p.statut not in ('mort', 'devis_signe', 'termine')
      ) as jours_plus_ancien
    from public.membres m
    left join public.projets p
           on p.assigne_a = m.user_id and p.deleted_at is null
    where m.role = 'commercial'
    group by m.id, m.nom, m.email, m.actif, m.taux_retrocession
  ) x;
$function$;

comment on function public.reprises_par_commercial() is
  'Suivi des chantiers repris par chaque commercial : en cours, signés, CA, '
  'rétrocessions dues et versées. Réservé aux fondateurs.';

revoke all on function public.reprises_par_commercial() from public, anon;
grant execute on function public.reprises_par_commercial() to authenticated;
