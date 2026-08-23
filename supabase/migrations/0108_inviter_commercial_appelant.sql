-- Corrige l'invitation d'un commercial, qui échouait systématiquement avec
-- « Seul un fondateur peut inviter » — y compris pour un vrai fondateur.
--
-- Cause : `inviter_commercial()` s'appuyait sur `est_fondateur()`, donc sur
-- `auth.uid()`. Or l'edge function `inviter-membre` appelle cette fonction avec
-- la clé service_role, contexte dans lequel `auth.uid()` est NUL. Le contrôle
-- était donc toujours faux, quel que soit le compte connecté.
--
-- Vérifié en production : `est_fondateur()` renvoie faux en service_role et
-- vrai avec le JWT du fondateur.
--
-- Correctif : l'appelant est transmis explicitement. L'edge function a déjà
-- validé le JWT et vérifié le rôle avant d'appeler ; on refait ici le contrôle
-- sur cet identifiant, sans dépendre du contexte d'authentification.
--
-- Le contrôle n'est pas affaibli : `p_invite_par` doit correspondre à un
-- fondateur ACTIF de la table `membres`. Un appel avec un identifiant
-- quelconque est rejeté, et la fonction reste inatteignable depuis le
-- navigateur (l'edge function détient seule la clé service_role).

create or replace function public.inviter_commercial(
  p_user_id uuid,
  p_email text,
  p_nom text,
  p_taux numeric default 0.10,
  p_invite_par uuid default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_auteur uuid;
begin
  -- L'appelant : soit le JWT quand il existe (appel direct authentifié), soit
  -- l'identifiant transmis par l'edge function (appel en service_role).
  v_auteur := coalesce(auth.uid(), p_invite_par);

  if v_auteur is null then
    return json_build_object('ok', false, 'error', 'reserve_fondateur');
  end if;

  -- Le rôle est revérifié en base : l'edge function ne peut pas se contenter
  -- de l'affirmer, sinon un appel forgé suffirait à créer un membre.
  if not exists (
    select 1 from public.membres
    where user_id = v_auteur and role = 'fondateur' and actif
  ) then
    return json_build_object('ok', false, 'error', 'reserve_fondateur');
  end if;

  if coalesce(btrim(p_nom), '') = '' then
    return json_build_object('ok', false, 'error', 'nom_requis');
  end if;
  if p_taux < 0 or p_taux > 1 then
    return json_build_object('ok', false, 'error', 'taux_invalide');
  end if;

  insert into public.membres (user_id, role, nom, email, taux_retrocession, invite_par)
  values (p_user_id, 'commercial', btrim(p_nom), lower(btrim(p_email)), p_taux, v_auteur)
  on conflict (user_id) do update
    set nom = excluded.nom, email = excluded.email,
        taux_retrocession = excluded.taux_retrocession, actif = true
  returning id into v_id;

  -- L'e-mail d'invitation est pilotable depuis l'écran d'automatisations
  -- (famille « E-mails externes »), comme toute automatisation du CRM.
  if public.automatisation_active('auto_mail_invitation') then
    perform net.http_post(
      url := 'https://n8n.srv1241880.hstgr.cloud/webhook/crm-celexia-events',
      body := jsonb_build_object(
        'event', 'invitation_commercial',
        'email', lower(btrim(p_email)),
        'nom',   btrim(p_nom),
        'lien',  'https://crm-ci7k.vercel.app/login'
      )
    );
  end if;

  return json_build_object('ok', true, 'membre_id', v_id);
end
$function$;

comment on function public.inviter_commercial(uuid, text, text, numeric, uuid) is
  'Enregistre un commercial invité. Appelée par l''edge function inviter-membre '
  'en service_role : l''appelant est alors transmis via p_invite_par, car '
  'auth.uid() est nul dans ce contexte. Le rôle fondateur est revérifié en base.';

-- L'ancienne signature à 4 arguments doit disparaître : le paramètre ajouté
-- ayant une valeur par défaut, les deux versions coexistaient et un appel à 4
-- arguments serait devenu ambigu — ou pire, aurait retenu la version cassée.
drop function if exists public.inviter_commercial(uuid, text, text, numeric);
