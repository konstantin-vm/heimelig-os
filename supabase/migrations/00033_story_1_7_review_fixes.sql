-- Migration 00033 — Story 1.7 review fixes.
--
-- Addresses the patches surfaced by the 2026-05-02 code review of Story 1.7.
-- Idempotent end-to-end: every DDL guarded by IF EXISTS / OR REPLACE, the
-- column add uses IF NOT EXISTS, and the cron schedule replays via
-- unschedule-then-schedule.
--
-- Patches applied:
--   1. AC2 / audit-trail gap — add `bexio_oauth_states.created_by` so the
--      callback can populate `bexio_credentials.created_by` with the admin
--      who initiated the flow. Re-emit `bexio_complete_oauth` to take a new
--      `p_initiated_by uuid` parameter, persist it on the new credential
--      row, and surface it in the `bexio_credentials_connected` audit row.
--   2. Concurrency hardening — re-emit `bexio_complete_oauth` to take a
--      transaction-scoped advisory lock on a constant key so two parallel
--      reconnects serialize cleanly instead of racing the partial-unique
--      index.
--   3. `purge-bexio-oauth-states` cron — change predicate from `created_at
--      < now() - 1 hour` to `used_at IS NOT NULL OR expires_at <= now() -
--      interval '5 minutes'`. Used / expired rows now disappear within one
--      cron tick.
--   4. `bexio_set_credentials_revoked` — write an audit row even when the
--      revoke loses a race (0 rows updated). `details.note='lost_race'`
--      makes the no-op observable.
--   5. `bexio_decrypt_token` — treat empty-string ciphertext as NULL
--      instead of raising "Wrong key or corrupt data".
--   6. Vault-secret error messages — distinguish "not found" from "null
--      payload" so ops can diagnose key rotation issues without guessing.
--   7. `bexio_credentials_status_for_admin` — add `LIMIT 1` defense in
--      depth (still relies on the partial-unique index, but no longer only
--      on it).
--   8. Status-label thresholds — extract into one immutable SQL helper
--      `bexio_credentials_status_label(timestamptz, boolean)` and call it
--      from the view + the admin function so the two paths cannot drift.
--   9. `bexio_credentials_status` view — add a stronger COMMENT warning
--      that the view returns 0 rows under the default RLS posture (admins
--      MUST read via `bexio_credentials_status_for_admin()`).
--  10. `bexio_credentials.created_by` propagation — `bexio_complete_oauth`
--      writes the initiating admin's id into `created_by` so the audit
--      trigger captures the actor without relying on `auth.uid()`.

-- =============================================================================
-- 1. bexio_oauth_states.created_by
-- =============================================================================

alter table public.bexio_oauth_states
  add column if not exists created_by uuid references public.user_profiles(id) on delete set null;

comment on column public.bexio_oauth_states.created_by is
  'Admin user who initiated the OAuth flow via bexio-oauth-init. Propagated into bexio_credentials.created_by by bexio_complete_oauth. NULL for any rows created before migration 00033.';

-- =============================================================================
-- 3. Cron purge predicate — used_at OR expired (not created_at).
-- =============================================================================

do $$
begin
  perform cron.unschedule('purge-bexio-oauth-states');
exception when others then
  null;
end$$;

select cron.schedule(
  'purge-bexio-oauth-states',
  '*/15 * * * *',
  $cron$delete from public.bexio_oauth_states where used_at is not null or expires_at <= now() - interval '5 minutes'$cron$
);

-- =============================================================================
-- 5 + 6. bexio_decrypt_token — empty-string handling + distinct vault errors.
-- 6.    bexio_encrypt_token — distinct vault errors.
-- (search_path mirrors migration 00022.)
-- =============================================================================

create or replace function public.bexio_encrypt_token(p_plaintext text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_found boolean;
begin
  if p_plaintext is null then
    return null;
  end if;

  select decrypted_secret, true
    into v_key, v_found
    from vault.decrypted_secrets
   where name = 'bexio_token_key'
   limit 1;

  if not coalesce(v_found, false) then
    raise exception 'Vault secret bexio_token_key not found (vault.decrypted_secrets row missing)'
      using errcode = 'P0001';
  end if;
  if v_key is null or length(v_key) = 0 then
    raise exception 'Vault secret bexio_token_key has empty payload (rotation in progress?)'
      using errcode = 'P0001';
  end if;

  return encode(pgp_sym_encrypt(p_plaintext, v_key), 'base64');
end;
$$;

revoke execute on function public.bexio_encrypt_token(text) from public, anon, authenticated;
grant  execute on function public.bexio_encrypt_token(text) to service_role;

create or replace function public.bexio_decrypt_token(p_ciphertext text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_found boolean;
begin
  -- NULL or empty-string ciphertext maps to NULL — never raise. An empty
  -- string in production almost always means "not yet provisioned" or
  -- "partial restore from backup", not "wrong key".
  if p_ciphertext is null or length(p_ciphertext) = 0 then
    return null;
  end if;

  select decrypted_secret, true
    into v_key, v_found
    from vault.decrypted_secrets
   where name = 'bexio_token_key'
   limit 1;

  if not coalesce(v_found, false) then
    raise exception 'Vault secret bexio_token_key not found (vault.decrypted_secrets row missing)'
      using errcode = 'P0001';
  end if;
  if v_key is null or length(v_key) = 0 then
    raise exception 'Vault secret bexio_token_key has empty payload (rotation in progress?)'
      using errcode = 'P0001';
  end if;

  return pgp_sym_decrypt(decode(p_ciphertext, 'base64'), v_key);
end;
$$;

revoke execute on function public.bexio_decrypt_token(text) from public, anon, authenticated;
grant  execute on function public.bexio_decrypt_token(text) to service_role;

-- =============================================================================
-- 8. Status-label helper — one source of truth for view + admin function.
-- =============================================================================

create or replace function public.bexio_credentials_status_label(
  p_expires_at timestamptz,
  p_is_active  boolean
) returns text
language sql
immutable
set search_path = public
as $$
  select case
    when not p_is_active                                  then 'expired'
    when p_expires_at <= now()                            then 'expired'
    when p_expires_at <= now() + interval '5 minutes'     then 'expiring_soon'
    else                                                       'valid'
  end
$$;

comment on function public.bexio_credentials_status_label(timestamptz, boolean) is
  'Single source of truth for bexio credential status labels. Used by the bexio_credentials_status view and the bexio_credentials_status_for_admin function. Story 1.7 review (00033).';

-- =============================================================================
-- 8 + 9. View — use helper + stronger comment.
-- =============================================================================

create or replace view public.bexio_credentials_status
with (security_invoker = true)
as
select
  id,
  bexio_company_id,
  token_type,
  expires_at,
  scope,
  last_refreshed_at,
  refresh_count,
  is_active,
  environment,
  notes,
  created_at,
  updated_at,
  created_by,
  updated_by,
  public.bexio_credentials_status_label(expires_at, is_active) as status_label
from public.bexio_credentials
where is_active = true;

comment on view public.bexio_credentials_status is
  'Admin-readable metadata view over bexio_credentials. NEVER includes access_token_encrypted / refresh_token_encrypted. WARNING: With security_invoker=true and the deny-all RLS posture on bexio_credentials, this view returns 0 rows for every authenticated caller. Admins MUST read via bexio_credentials_status_for_admin() — the SECURITY DEFINER function applies the is_admin() gate explicitly. Story 1.7 AC3.';

-- =============================================================================
-- 7 + 8. bexio_credentials_status_for_admin — LIMIT 1 + helper-based label.
-- =============================================================================

create or replace function public.bexio_credentials_status_for_admin()
returns table (
  id                  uuid,
  bexio_company_id    text,
  token_type          text,
  expires_at          timestamptz,
  scope               text,
  last_refreshed_at   timestamptz,
  refresh_count       int,
  is_active           boolean,
  environment         text,
  notes               text,
  created_at          timestamptz,
  updated_at          timestamptz,
  created_by          uuid,
  updated_by          uuid,
  status_label        text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'permission denied: admin role required'
      using errcode = '42501';
  end if;

  return query
  select
    bc.id,
    bc.bexio_company_id,
    bc.token_type,
    bc.expires_at,
    bc.scope,
    bc.last_refreshed_at,
    bc.refresh_count,
    bc.is_active,
    bc.environment,
    bc.notes,
    bc.created_at,
    bc.updated_at,
    bc.created_by,
    bc.updated_by,
    public.bexio_credentials_status_label(bc.expires_at, bc.is_active) as status_label
  from public.bexio_credentials bc
  where bc.is_active = true
  limit 1;
end;
$$;

revoke execute on function public.bexio_credentials_status_for_admin() from public, anon;
grant  execute on function public.bexio_credentials_status_for_admin() to authenticated;

-- =============================================================================
-- 4. bexio_set_credentials_revoked — emit audit row even on lost race.
-- =============================================================================

create or replace function public.bexio_set_credentials_revoked(
  p_credential_id uuid,
  p_reason        text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.bexio_credentials
     set is_active = false
   where id = p_credential_id
     and is_active = true;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    -- Lost the race against another revocation path (or the credential was
    -- already inactive). Emit a low-severity audit so we can prove the
    -- revoke attempt happened, but do not raise.
    perform public.log_activity(
      'bexio_credentials_revoked',
      'bexio_credentials',
      p_credential_id,
      null,
      null,
      jsonb_build_object(
        'actor_system', 'bexio',
        'note',         'lost_race',
        'reason',       coalesce(p_reason, 'unknown')
      )
    );
    return;
  end if;

  perform public.log_activity(
    'bexio_credentials_revoked',
    'bexio_credentials',
    p_credential_id,
    null,
    jsonb_build_object('is_active', false),
    jsonb_build_object(
      'actor_system', 'bexio',
      'reason',       coalesce(p_reason, 'unknown')
    )
  );
end;
$$;

revoke execute on function public.bexio_set_credentials_revoked(uuid, text) from public, anon, authenticated;
grant  execute on function public.bexio_set_credentials_revoked(uuid, text) to service_role;

-- =============================================================================
-- 1 + 2 + 10. bexio_complete_oauth — advisory lock + p_initiated_by.
-- =============================================================================

-- Drop the old signature so the new one can land cleanly (function overload
-- by parameter list — leaving the old around invites accidental dispatch).
drop function if exists public.bexio_complete_oauth(text, text, text, text, timestamptz, text, text, text);

create or replace function public.bexio_complete_oauth(
  p_state                    text,
  p_access_token_encrypted   text,
  p_refresh_token_encrypted  text,
  p_token_type               text,
  p_expires_at               timestamptz,
  p_scope                    text,
  p_environment              text,
  p_bexio_company_id         text default null,
  p_initiated_by             uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state_row record;
  v_new_id    uuid;
begin
  if p_environment not in ('trial','production') then
    raise exception 'bexio_complete_oauth: invalid environment %', p_environment
      using errcode = '22023';
  end if;

  -- Serialize concurrent reconnects: the partial-unique index alone produces
  -- opaque 23505s on races. A transaction-scoped advisory lock on a constant
  -- key gives us clean queueing instead of "second writer fails persist".
  perform pg_advisory_xact_lock(hashtext('bexio_credentials_active'));

  -- Validate + lock the state row.
  select state, environment, used_at, expires_at, created_by
    into v_state_row
    from public.bexio_oauth_states
   where state = p_state
   for update;

  if not found then
    raise exception 'bexio_complete_oauth: state not found' using errcode = '22023';
  end if;

  if v_state_row.used_at is not null then
    raise exception 'bexio_complete_oauth: state already used' using errcode = '22023';
  end if;

  if v_state_row.expires_at <= now() then
    raise exception 'bexio_complete_oauth: state expired' using errcode = '22023';
  end if;

  if v_state_row.environment is distinct from p_environment then
    raise exception 'bexio_complete_oauth: environment mismatch (state=%, payload=%)',
      v_state_row.environment, p_environment
      using errcode = '22023';
  end if;

  -- Deactivate any prior active credential. Single-row partial-unique index
  -- guarantees at most one row matches.
  update public.bexio_credentials
     set is_active = false
   where is_active = true;

  -- Insert the new active credential. created_by gets the initiating admin
  -- so the audit trigger and the credentials-status view both have an actor
  -- attribution even though we are running as service_role.
  insert into public.bexio_credentials (
    bexio_company_id,
    access_token_encrypted,
    refresh_token_encrypted,
    token_type,
    expires_at,
    scope,
    is_active,
    environment,
    created_by
  )
  values (
    p_bexio_company_id,
    p_access_token_encrypted,
    p_refresh_token_encrypted,
    coalesce(p_token_type, 'Bearer'),
    p_expires_at,
    p_scope,
    true,
    p_environment,
    coalesce(p_initiated_by, v_state_row.created_by)
  )
  returning id into v_new_id;

  -- Burn the state row.
  update public.bexio_oauth_states
     set used_at = now()
   where state = p_state;

  -- Semantic audit event in addition to the structural row written by the
  -- audit trigger. `details.initiated_by` carries the admin actor since
  -- log_activity reads auth.uid() = NULL when called as service_role.
  perform public.log_activity(
    'bexio_credentials_connected',
    'bexio_credentials',
    v_new_id,
    null,
    jsonb_build_object(
      'environment', p_environment,
      'scope',       p_scope
    ),
    jsonb_build_object(
      'actor_system',  'bexio',
      'flow',          'oauth_authorization_code',
      'initiated_by',  coalesce(p_initiated_by, v_state_row.created_by)
    )
  );

  return v_new_id;
end;
$$;

revoke execute on function public.bexio_complete_oauth(text, text, text, text, timestamptz, text, text, text, uuid)
  from public, anon, authenticated;
grant  execute on function public.bexio_complete_oauth(text, text, text, text, timestamptz, text, text, text, uuid)
  to service_role;

comment on function public.bexio_complete_oauth(text, text, text, text, timestamptz, text, text, text, uuid) is
  'Atomic OAuth completion: advisory-locks on bexio_credentials_active, validates the state row, deactivates the prior active credential, inserts the new credential (created_by = initiating admin), marks the state row used, writes a bexio_credentials_connected audit row — all in one transaction. Service-role only. Story 1.7 AC7 + 00033 review fixes.';

-- =============================================================================
-- 8 (cont). bexio_get_active_credential_decrypted — also return created_at
-- so the Edge Function bexio-client can anchor proactive refresh on creation
-- time when last_refreshed_at is NULL.
-- =============================================================================

create or replace function public.bexio_get_active_credential_decrypted()
returns table (
  id                  uuid,
  bexio_company_id    text,
  access_token        text,
  refresh_token       text,
  token_type          text,
  expires_at          timestamptz,
  scope               text,
  last_refreshed_at   timestamptz,
  refresh_count       int,
  environment         text,
  created_at          timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    bc.id,
    bc.bexio_company_id,
    public.bexio_decrypt_token(bc.access_token_encrypted)  as access_token,
    public.bexio_decrypt_token(bc.refresh_token_encrypted) as refresh_token,
    bc.token_type,
    bc.expires_at,
    bc.scope,
    bc.last_refreshed_at,
    bc.refresh_count,
    bc.environment,
    bc.created_at
  from public.bexio_credentials bc
  where bc.is_active = true
  limit 1;
end;
$$;

revoke execute on function public.bexio_get_active_credential_decrypted() from public, anon, authenticated;
grant  execute on function public.bexio_get_active_credential_decrypted() to service_role;
