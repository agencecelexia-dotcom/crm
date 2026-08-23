-- Voir le CRM d'un commercial depuis l'écran Équipe.
--
-- POURQUOI PAS UNE USURPATION DE SESSION
--
-- Se connecter « à la place de » quelqu'un est possible techniquement, mais
-- ouvre trois problèmes : les actions faites dans cette session lui seraient
-- attribuées, l'historique deviendrait ininterprétable, et un accès sans mot
-- de passe est exactement le mécanisme qu'un attaquant cherche à obtenir.
--
-- Cette fonction renvoie donc à la LECTURE ce que le commercial voit : ses
-- reprises, ses chiffres, ses gains. Le fondateur observe sans agir en son nom.
-- S'il doit intervenir sur un chantier, il le fait depuis sa propre session —
-- il a déjà tous les droits dessus.

create or replace function public.vue_commercial(p_membre_id uuid)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_membre public.membres;
  v_res json;
begin
  -- Réservé aux fondateurs : c'est l'activité d'une personne, pas une donnée
  -- que ses collègues ont à consulter.
  if not public.est_fondateur() then
    return json_build_object('ok', false, 'error', 'reserve_fondateur');
  end if;

  select * into v_membre from public.membres where id = p_membre_id;
  if v_membre.id is null then
    return json_build_object('ok', false, 'error', 'introuvable');
  end if;

  select json_build_object(
    'ok', true,
    'membre', json_build_object(
      'nom', v_membre.nom,
      'email', v_membre.email,
      'actif', v_membre.actif,
      'taux', v_membre.taux_retrocession,
      'depuis', v_membre.active_at
    ),

    -- Ce qu'il a en main : le contenu exact de son écran « Mon pipe ».
    'chantiers', coalesce((
      select json_agg(c order by c.repris_depuis desc)
      from (
        select
          p.id as projet_id,
          p.client_nom,
          p.client_ville,
          p.metiers,
          p.statut,
          p.montant_devis,
          p.commission,
          p.commission_encaissee,
          (select coalesce(a.societe, a.nom)
             from public.affectations af
             join public.artisans a on a.id = af.artisan_id
            where af.projet_id = p.id and af.retire_at is null
              and coalesce(af.statut, '') <> 'perdu'
            order by af.created_at desc limit 1) as artisan_actuel,
          (current_date - p.updated_at::date) as repris_depuis,
          round(coalesce(p.commission, 0) * v_membre.taux_retrocession, 2) as sa_part
        from public.projets p
       where p.deleted_at is null
         and p.assigne_a = v_membre.user_id
      ) c
    ), '[]'::json),

    -- Ses chiffres, pour juger sans ouvrir chaque dossier.
    'stats', (
      select json_build_object(
        'en_cours', count(*) filter (
          where statut not in ('devis_signe', 'termine', 'mort')
        ),
        'replaces', count(*) filter (where statut = 'devis_signe'),
        'sans_suite', count(*) filter (where statut = 'mort'),
        'ca_replace', coalesce(sum(montant_devis) filter (
          where statut = 'devis_signe'
        ), 0),
        -- Le dossier le plus ancien : c'est souvent l'information la plus
        -- utile. Un chantier repris et laissé de côté bloque tout le monde.
        'plus_ancien_j', coalesce(max(current_date - updated_at::date) filter (
          where statut not in ('devis_signe', 'termine', 'mort')
        ), 0)
      )
      from public.projets
      where deleted_at is null and assigne_a = v_membre.user_id
    ),

    -- Ce qu'on lui doit, et ce qu'on lui a déjà versé.
    'gains', (
      select json_build_object(
        'a_verser', coalesce(sum(montant) filter (where verse_at is null), 0),
        'verse', coalesce(sum(montant) filter (where verse_at is not null), 0)
      )
      from public.retrocessions where membre_id = p_membre_id
    )
  ) into v_res;

  return v_res;
end
$function$;

comment on function public.vue_commercial(uuid) is
  'Ce que voit un commercial, en lecture seule, pour un fondateur. Volontairement '
  'pas une usurpation de session : les actions resteraient attribuées au '
  'commercial et l''historique deviendrait ininterprétable.';

revoke all on function public.vue_commercial(uuid) from public, anon;
grant execute on function public.vue_commercial(uuid) to authenticated;
