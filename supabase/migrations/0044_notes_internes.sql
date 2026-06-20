-- 0044 — Notes internes privées par projet (agence uniquement).
-- Même modèle de protection que estimation_interne (0030) : simple colonne sur
-- projets, JAMAIS exposée aux RPC artisan. get_espace_artisan (0041) et
-- get_mission_by_token (0018) construisent un json_build_object en LISTE BLANCHE
-- de champs ; cette colonne n'y figure pas, donc l'artisan ne la reçoit jamais.

alter table public.projets add column if not exists notes_internes text;

comment on column public.projets.notes_internes is
  'Notes internes agence — privées, jamais renvoyées à l''artisan (RPC artisan = whitelist).';
