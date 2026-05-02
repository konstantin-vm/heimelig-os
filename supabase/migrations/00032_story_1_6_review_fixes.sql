-- Story 1.6 review fix-up — `storage_first_segment_is_uuid` volatility class.
--
-- Background: Migration 00019 declared the helper IMMUTABLE. The body wraps
-- `storage.foldername(text)`, which Supabase declares STABLE (not IMMUTABLE).
-- An IMMUTABLE wrapper around a STABLE function is a contract violation: the
-- planner is allowed to constant-fold IMMUTABLE results across rows in a single
-- statement, which can produce wrong RLS decisions in pathological plans
-- (index-only scans, parameterized prepared statements, batched UPDATEs).
--
-- Fix: re-declare the helper as STABLE. Behavior is unchanged for single-row
-- evaluation (the dominant call site in storage.objects RLS); only the planner's
-- folding latitude changes.
--
-- Idempotent: `create or replace function` reconciles the volatility class.

create or replace function public.storage_first_segment_is_uuid(p_name text)
returns boolean
language sql
stable
parallel safe
set search_path = storage, public, pg_temp
as $$
  -- storage.foldername returns the folder array (excludes the file).
  -- For 'foo.pdf' (no folder) it returns {} -> [1] is NULL -> coalesce to '' -> regex fails.
  -- For '<uuid>/foo.pdf' -> {<uuid>} -> [1] is <uuid>.
  select coalesce((storage.foldername(p_name))[1], '')
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
$$;

comment on function public.storage_first_segment_is_uuid(text) is
  'Story 1.6 — true iff the first folder segment of a storage object name is a UUID. STABLE (00032 review fix-up; was IMMUTABLE in 00019).';
