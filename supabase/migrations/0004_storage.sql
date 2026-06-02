-- ============================================================
--  0004 — Storage : bucket privé "documents" (contrats / devis PDF)
--  Accès réservé aux utilisateurs authentifiés ; lecture via URLs signées.
-- ============================================================

-- Création du bucket privé (public = false)
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Politiques d'accès au bucket : uniquement les utilisateurs authentifiés
drop policy if exists "documents_authenticated_read" on storage.objects;
create policy "documents_authenticated_read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'documents');

drop policy if exists "documents_authenticated_insert" on storage.objects;
create policy "documents_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents');

drop policy if exists "documents_authenticated_update" on storage.objects;
create policy "documents_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'documents')
  with check (bucket_id = 'documents');

drop policy if exists "documents_authenticated_delete" on storage.objects;
create policy "documents_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documents');
