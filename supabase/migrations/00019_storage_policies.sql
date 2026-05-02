-- Migration 00019 — Role-based RLS policies on storage.objects.
-- Story 1.6 (Storage Buckets & Role-Based Storage Policies).
-- See _bmad-output/implementation-artifacts/1-6-storage-buckets-role-based-storage-policies.md
--   AC3, AC4, AC6, AC7, AC8.
--
-- Depends on:
--   - 00001_helper_functions.sql — is_admin(), is_office(), is_warehouse()
--   - 00018_storage_buckets.sql  — three private buckets
--
-- Policy matrix (AC3 — verbatim):
--   | bucket          | role        | INSERT | SELECT | UPDATE | DELETE |
--   |-----------------|-------------|--------|--------|--------|--------|
--   | medical-certs   | admin       |   ✅   |   ✅   |   ✅   |   ✅   |
--   | medical-certs   | office      |   ✅   |   ✅   |   ✅   |   ✅   |
--   | medical-certs   | warehouse   |   —    |   —    |   —    |   —    |
--   | medical-certs   | technician  |   —    |   —    |   —    |   —    |
--   | qr-labels       | admin       |   ✅   |   ✅   |   ✅   |   ✅   |
--   | qr-labels       | office      |   ✅   |   ✅   |   ✅   |   ✅   |
--   | qr-labels       | warehouse   |   ✅   |   ✅   |   ✅   |   ✅   |
--   | qr-labels       | technician  |   —    |   —    |   —    |   —    |
--   | signatures      | admin       |   —    |   ✅   |   —    |   —    |
--   | signatures      | office      |   —    |   ✅   |   —    |   —    |
--   | signatures      | warehouse   |   —    |   —    |   —    |   —    |
--   | signatures      | technician  |   —    |   —    |   —    |   —    |
--
-- Total: 22 policies. Empty cells = no policy = default DENY.
--
-- Naming convention (AC6): {bucket_underscore}_{role}_{op}.
--   Bucket ids carry hyphens (`medical-certs`); identifiers cannot, so the
--   policy-name slug uses underscores (`medical_certs_admin_insert`).
--
-- Predicate shape (AC3):
--   bucket_id = '<bucket>'
--     AND public.is_<role>()
--     AND public.storage_first_segment_is_uuid(name)
--
-- INSERT uses `with check (...)`; SELECT/UPDATE/DELETE use `using (...)`;
-- UPDATE additionally repeats the predicate in `with check (...)` so a row
-- can't be moved into the bucket from elsewhere via UPDATE.
--
-- Deferred (AC7):
--   `qr_labels_technician_select`  — Epic 7 follow-up; will scope by
--     `exists (select 1 from public.tour_stops ts where ts.id::text = (storage.foldername(name))[1] and ts.technician_id = auth.uid())`
--   `signatures_technician_insert` — Epic 8 Story 8.6; same shape on insert.
--   Reserved names; this migration does not create them.
--   TODO(7.x/8.x): add the two technician policies once tour_stops exists.
--
-- storage.objects already has RLS enabled by Supabase (`relrowsecurity = true`).
-- We only add policies here; we do NOT call `enable row level security` (that
-- would require ownership of `storage.objects`, which is owned by the
-- `supabase_storage_admin` role, not us).
--
-- Idempotency: every policy is `drop policy if exists ... ; create policy ...`.
-- Re-running this migration is a no-op.

-- ---------------------------------------------------------------------------
-- Helper: storage_first_segment_is_uuid(text) returns boolean
-- ---------------------------------------------------------------------------

create or replace function public.storage_first_segment_is_uuid(p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = storage, public, pg_temp
as $$
  -- storage.foldername returns the folder array (excludes the file).
  -- For 'foo.pdf' (no folder) it returns {} -> [1] is NULL -> coalesce to '' -> regex fails.
  -- For '<uuid>/foo.pdf' -> {<uuid>} -> [1] is <uuid>.
  select coalesce((storage.foldername(p_name))[1], '')
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
$$;

revoke execute on function public.storage_first_segment_is_uuid(text) from public, anon;
grant  execute on function public.storage_first_segment_is_uuid(text) to authenticated;

comment on function public.storage_first_segment_is_uuid(text) is
  'Story 1.6 — true iff the first folder segment of a storage object name is a UUID.';

-- ---------------------------------------------------------------------------
-- medical-certs — admin (4 policies)
-- ---------------------------------------------------------------------------

drop policy if exists medical_certs_admin_insert on storage.objects;
create policy medical_certs_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'medical-certs'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists medical_certs_admin_select on storage.objects;
create policy medical_certs_admin_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'medical-certs'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists medical_certs_admin_update on storage.objects;
create policy medical_certs_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'medical-certs'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  )
  with check (
    bucket_id = 'medical-certs'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists medical_certs_admin_delete on storage.objects;
create policy medical_certs_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'medical-certs'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  );

-- ---------------------------------------------------------------------------
-- medical-certs — office (4 policies)
-- ---------------------------------------------------------------------------

drop policy if exists medical_certs_office_insert on storage.objects;
create policy medical_certs_office_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'medical-certs'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists medical_certs_office_select on storage.objects;
create policy medical_certs_office_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'medical-certs'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists medical_certs_office_update on storage.objects;
create policy medical_certs_office_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'medical-certs'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  )
  with check (
    bucket_id = 'medical-certs'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists medical_certs_office_delete on storage.objects;
create policy medical_certs_office_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'medical-certs'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  );

-- ---------------------------------------------------------------------------
-- qr-labels — admin (4 policies)
-- ---------------------------------------------------------------------------

drop policy if exists qr_labels_admin_insert on storage.objects;
create policy qr_labels_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'qr-labels'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists qr_labels_admin_select on storage.objects;
create policy qr_labels_admin_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'qr-labels'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists qr_labels_admin_update on storage.objects;
create policy qr_labels_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'qr-labels'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  )
  with check (
    bucket_id = 'qr-labels'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists qr_labels_admin_delete on storage.objects;
create policy qr_labels_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'qr-labels'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  );

-- ---------------------------------------------------------------------------
-- qr-labels — office (4 policies)
-- ---------------------------------------------------------------------------

drop policy if exists qr_labels_office_insert on storage.objects;
create policy qr_labels_office_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'qr-labels'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists qr_labels_office_select on storage.objects;
create policy qr_labels_office_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'qr-labels'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists qr_labels_office_update on storage.objects;
create policy qr_labels_office_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'qr-labels'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  )
  with check (
    bucket_id = 'qr-labels'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists qr_labels_office_delete on storage.objects;
create policy qr_labels_office_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'qr-labels'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  );

-- ---------------------------------------------------------------------------
-- qr-labels — warehouse (4 policies)
-- ---------------------------------------------------------------------------

drop policy if exists qr_labels_warehouse_insert on storage.objects;
create policy qr_labels_warehouse_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'qr-labels'
    and public.is_warehouse()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists qr_labels_warehouse_select on storage.objects;
create policy qr_labels_warehouse_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'qr-labels'
    and public.is_warehouse()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists qr_labels_warehouse_update on storage.objects;
create policy qr_labels_warehouse_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'qr-labels'
    and public.is_warehouse()
    and public.storage_first_segment_is_uuid(name)
  )
  with check (
    bucket_id = 'qr-labels'
    and public.is_warehouse()
    and public.storage_first_segment_is_uuid(name)
  );

drop policy if exists qr_labels_warehouse_delete on storage.objects;
create policy qr_labels_warehouse_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'qr-labels'
    and public.is_warehouse()
    and public.storage_first_segment_is_uuid(name)
  );

-- ---------------------------------------------------------------------------
-- signatures — admin (1 policy: SELECT only)
-- ---------------------------------------------------------------------------

drop policy if exists signatures_admin_select on storage.objects;
create policy signatures_admin_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'signatures'
    and public.is_admin()
    and public.storage_first_segment_is_uuid(name)
  );

-- ---------------------------------------------------------------------------
-- signatures — office (1 policy: SELECT only)
-- ---------------------------------------------------------------------------

drop policy if exists signatures_office_select on storage.objects;
create policy signatures_office_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'signatures'
    and public.is_office()
    and public.storage_first_segment_is_uuid(name)
  );

-- ---------------------------------------------------------------------------
-- Deferred policies — placeholders only (no CREATE; AC7).
--
-- TODO(7.x): create policy qr_labels_technician_select  on storage.objects
--   for select to authenticated using (
--     bucket_id = 'qr-labels'
--     and public.is_technician()
--     and exists (
--       select 1 from public.tour_stops ts
--        where ts.id::text = (storage.foldername(name))[1]
--          and ts.technician_id = auth.uid()
--     )
--   );
--
-- TODO(8.6): create policy signatures_technician_insert on storage.objects
--   for insert to authenticated with check (
--     bucket_id = 'signatures'
--     and public.is_technician()
--     and exists (
--       select 1 from public.tour_stops ts
--        where ts.id::text = (storage.foldername(name))[1]
--          and ts.technician_id = auth.uid()
--     )
--   );
-- ---------------------------------------------------------------------------
