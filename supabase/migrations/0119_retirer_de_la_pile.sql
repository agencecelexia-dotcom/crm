-- Retirer un chantier de la pile à réattribuer, un par un.
--
-- La pile compte 64 chantiers, dont certains n'ont plus lieu d'y être : client
-- injoignable depuis des mois, dossier traité hors CRM, doublon. Les laisser
-- fausse le compteur et noie ceux qui méritent un appel.
--
-- CE QUE FAIT CETTE FONCTION
--
-- Elle marque le projet `mort` : il sort de la pile, du pipe et des compteurs,
-- mais RIEN n'est supprimé. L'historique, les affectations et les suivis
-- restent consultables, et la corbeille permet de revenir en arrière.
--
-- Réservé aux fondateurs : décider qu'un chantier n'a plus d'avenir engage le
-- chiffre d'affaires, ce n'est pas au commercial de le faire — lui gagne sa
-- commission dessus.

create or replace function public.retirer_de_la_pile(
  p_projet_id uuid,
  p_motif text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_projet public.projets;
begin
  if not public.est_fondateur() then
    return json_build_object('ok', false, 'error', 'reserve_fondateur');
  end if;

  select * into v_projet from public.projets
   where id = p_projet_id and deleted_at is null;

  if v_projet.id is null then
    return json_build_object('ok', false, 'error', 'introuvable');
  end if;

  -- Un chantier signé ne se retire pas ainsi : la commission est en jeu et le
  -- geste demanderait une décision comptable, pas un clic dans une liste.
  if v_projet.statut in ('devis_signe', 'termine')
     or coalesce(v_projet.commission_encaissee, false) then
    return json_build_object('ok', false, 'error', 'chantier_signe');
  end if;

  update public.projets
     set statut = 'mort',
         perdu_at = coalesce(perdu_at, now()),
         -- Libérer l'assignation : un chantier mort ne doit pas rester
         -- comptabilisé dans le pipe d'un commercial.
         assigne_a = null,
         notes_internes = case
           when coalesce(btrim(p_motif), '') = '' then notes_internes
           else coalesce(notes_internes || E'\n', '')
                || format('[%s] Retiré de la pile : %s',
                          to_char(now(), 'DD/MM/YYYY'), btrim(p_motif))
         end
   where id = p_projet_id;

  return json_build_object('ok', true);
end
$function$;

comment on function public.retirer_de_la_pile(uuid, text) is
  'Sort un chantier de la pile à réattribuer en le marquant `mort`. Rien n''est '
  'supprimé : l''historique reste, et le statut peut être repris à la main. '
  'Refuse un chantier signé ou encaissé. Réservé aux fondateurs.';

revoke all on function public.retirer_de_la_pile(uuid, text) from public, anon;
grant execute on function public.retirer_de_la_pile(uuid, text) to authenticated;
