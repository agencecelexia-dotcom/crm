-- 0027 — Notifier l'agence par email à chaque changement de statut déclaré par
-- l'artisan (via n8n / pg_net). Reprend add_suivi_by_token (0026) + http_post.
create or replace function public.add_suivi_by_token(
  p_token text, p_statut text default null, p_message text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $func$
declare af public.affectations;
begin
  select * into af from public.affectations where token = p_token;
  if af.id is null then return json_build_object('ok', false); end if;
  if coalesce(p_statut, '') = '' and coalesce(p_message, '') = '' then
    return json_build_object('ok', false);
  end if;

  insert into public.suivis (projet_id, affectation_id, auteur, type, statut_artisan, message)
  values (
    af.projet_id, af.id, 'artisan',
    case when coalesce(p_statut, '') <> '' then 'statut' else 'note' end,
    nullif(p_statut, ''), nullif(p_message, '')
  );

  if coalesce(p_statut, '') <> '' then
    update public.affectations set statut = p_statut where id = af.id;
    select * into af from public.affectations where id = af.id;

    -- Notifie l'agence du changement de statut (n8n → email)
    perform net.http_post(
      url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
      body := jsonb_build_object(
        'event', 'changement_statut',
        'statut', p_statut,
        'artisan', (select coalesce(a.societe, a.nom) from public.artisans a where a.id = af.artisan_id),
        'client_nom', (select p.client_nom from public.projets p where p.id = af.projet_id),
        'client_ville', (select p.client_ville from public.projets p where p.id = af.projet_id),
        'metier', (select p.metier from public.projets p where p.id = af.projet_id),
        'lien', 'https://crm-ci7k.vercel.app/projets/' || af.projet_id
      )
    );
  end if;

  if p_statut = 'devis_signe' then
    delete from public.affectations where projet_id = af.projet_id and id <> af.id;
    update public.projets
      set artisan_id = af.artisan_id, statut = 'devis_signe',
          montant_devis_signe = af.montant_devis_signe
      where id = af.projet_id;
  elsif p_statut in ('contacte', 'rdv_pris', 'en_attente', 'devis_envoye', 'termine', 'perdu') then
    update public.projets p set statut = coalesce((
      select af2.statut from public.affectations af2
      where af2.projet_id = p.id and af2.statut <> 'perdu'
      order by case af2.statut
        when 'termine' then 5 when 'devis_signe' then 4 when 'devis_envoye' then 3
        when 'rdv_pris' then 2 when 'contacte' then 1 else 0 end desc
      limit 1), p.statut)
      where p.id = af.projet_id;
  end if;

  return json_build_object('ok', true);
end;
$func$;
grant execute on function public.add_suivi_by_token(text, text, text) to anon, authenticated;
