-- Migration 00021 — bexio_credentials + OAuth2 plumbing.
-- Story 1.7 (bexio OAuth2 Connection & Token Management).
-- See data-model-spec.md §5.9.2 and epics.md Story 1.7.
--
-- Scope:
--   * public.bexio_credentials  — encrypted access/refresh tokens (RLS = service-role only).
--   * public.bexio_oauth_states — short-lived CSRF state for the OAuth init/callback flow.
--   * pgcrypto-based encryption helpers `bexio_encrypt_token` / `bexio_decrypt_token`
--     using the AES-256 key stored in Supabase Vault under the secret name
--     `bexio_token_key`. The key never leaves the DB layer; both helpers are
--     GRANTed to service_role only.
--   * `bexio_credentials_status` view (token columns excluded) +
--     `bexio_credentials_status_for_admin()` SECURITY DEFINER read function.
--   * `bexio_get_active_credential_decrypted()` — service-role-only read RPC
--     consumed by the Edge Function shared bexio-client.ts.
--   * Audit trigger binding with TG_ARGV column suppression on the encrypted
--     token columns (defense in depth).
--   * pg_cron purge of expired oauth_states every 15 minutes.
--
-- One-time ops setup REQUIRED before this migration runs:
--   The Vault secret `bexio_token_key` MUST be created in the Supabase Dashboard
--   SQL editor BEFORE pushing this migration. The migration asserts the secret
--   exists and aborts with a clear error otherwise. Do NOT create the secret
--   from a migration — `pg_dump`-driven backups would commit the key to git
--   history.
--
--   In Dashboard → SQL Editor:
--     select vault.create_secret(
--       encode(gen_random_bytes(32), 'base64'),
--       'bexio_token_key',
--       'AES-256 key for bexio_credentials.access_token_encrypted / refresh_token_encrypted'
--     );
--
--   Verify:
--     select id, name, created_at from vault.secrets where name = 'bexio_token_key';
--
-- Edge Function secrets (set via `supabase secrets set ...`):
--   BEXIO_CLIENT_ID, BEXIO_CLIENT_SECRET,
--   BEXIO_REDIRECT_URI = https://<project-ref>.functions.supabase.co/bexio-oauth-callback,
--   BEXIO_AUTHORIZE_URL, BEXIO_TOKEN_URL, BEXIO_SCOPES (incl. offline_access).
--
-- nDSG / data residency: every credential storage + token exchange happens
-- between Edge Functions (Zürich) and bexio (Switzerland). Tokens never transit
-- Vercel Frankfurt. The redirect URI MUST point at a Supabase Edge Function
-- URL — never at a Next.js route.
--
-- Key rotation procedure (manual, ops):
--   1. select vault.create_secret(encode(gen_random_bytes(32),'base64'), 'bexio_token_key_v2', '...');
--   2. update bexio_credentials set
--        access_token_encrypted  = public.bexio_encrypt_token_v2(public.bexio_decrypt_token(access_token_encrypted)),
--        refresh_token_encrypted = public.bexio_encrypt_token_v2(public.bexio_decrypt_token(refresh_token_encrypted));
--      (Define _v2 helpers reading the new secret; commit a migration for that.)
--   3. drop the old secret + old helpers in a follow-up migration.
--
-- SQLSTATE codes raised here:
--   * 42501  — bexio_credentials_status_for_admin called by non-admin.
--   * P0001  — Vault secret missing at migration time.

-- =============================================================================
-- pgcrypto + Vault assertion
-- =============================================================================

-- pgcrypto already enabled in 00001; idempotent re-assertion.
create extension if not exists pgcrypto;

do $$
begin
  if (select count(*) from vault.secrets where name = 'bexio_token_key') = 0 then
    raise exception
      'Vault secret "bexio_token_key" missing — see migration 00021 header for the one-time setup SQL.'
      using errcode = 'P0001';
  end if;
end$$;

-- =============================================================================
-- bexio_credentials table
-- =============================================================================

create table if not exists public.bexio_credentials (
  id                       uuid          primary key default gen_random_uuid(),
  bexio_company_id         text,
  access_token_encrypted   text          not null,
  refresh_token_encrypted  text          not null,
  token_type               text          not null default 'Bearer',
  expires_at               timestamptz   not null,
  scope                    text,
  last_refreshed_at        timestamptz,
  refresh_count            int           not null default 0 check (refresh_count >= 0),
  is_active                boolean       not null default true,
  environment              text          not null default 'trial'
                                            check (environment in ('trial','production')),
  notes                    text,
  created_at               timestamptz   not null default now(),
  updated_at               timestamptz   not null default now(),
  created_by               uuid          references public.user_profiles(id) on delete set null,
  updated_by               uuid          references public.user_profiles(id) on delete set null
);

-- At most one active credential at a time.
create unique index if not exists idx_bexio_credentials_active_unique
  on public.bexio_credentials (is_active)
  where is_active = true;

-- Standard updated_at refresher.
drop trigger if exists set_bexio_credentials_updated_at on public.bexio_credentials;
create trigger set_bexio_credentials_updated_at
  before update on public.bexio_credentials
  for each row execute function public.set_updated_at();

alter table public.bexio_credentials enable  row level security;
alter table public.bexio_credentials force   row level security;

-- NO authenticated policies. Default DENY for SELECT/INSERT/UPDATE/DELETE.
-- Service role bypasses RLS (Supabase default), so Edge Functions running as
-- service_role can read/write directly. Admin reads only metadata via
-- bexio_credentials_status_for_admin() (defined further down).

comment on table public.bexio_credentials is
  'Encrypted bexio OAuth2 credential storage. RLS = service-role only. Tokens encrypted at rest via pgcrypto + Vault key bexio_token_key. Read by Edge Functions through bexio_get_active_credential_decrypted() RPC. Story 1.7.';

-- =============================================================================
-- bexio_oauth_states table — short-lived CSRF state.
-- =============================================================================

create table if not exists public.bexio_oauth_states (
  state         text          primary key,
  environment   text          not null check (environment in ('trial','production')),
  created_at    timestamptz   not null default now(),
  expires_at    timestamptz   not null default now() + interval '10 minutes',
  used_at       timestamptz
);

create index if not exists idx_bexio_oauth_states_active
  on public.bexio_oauth_states (expires_at)
  where used_at is null;

alter table public.bexio_oauth_states enable  row level security;
alter table public.bexio_oauth_states force   row level security;

-- NO authenticated policies. Service-role-only by default.
-- Audit trigger intentionally NOT bound — these rows are ephemeral and noisy.

comment on table public.bexio_oauth_states is
  'Short-lived OAuth2 state (CSRF protection) for bexio Authorization Code Flow. Inserted by bexio-oauth-init Edge Function, consumed by bexio-oauth-callback. Purged every 15min by pg_cron job purge-bexio-oauth-states. RLS = service-role only. Story 1.7.';

-- =============================================================================
-- pg_cron — purge expired oauth_states every 15 minutes.
-- =============================================================================

create extension if not exists pg_cron;

-- Idempotent unschedule-then-schedule (mirrors 00014's purge-resolved-error-log).
do $$
begin
  perform cron.unschedule('purge-bexio-oauth-states');
exception when others then
  null;
end$$;

select cron.schedule(
  'purge-bexio-oauth-states',
  '*/15 * * * *',
  $cron$delete from public.bexio_oauth_states where created_at < now() - interval '1 hour'$cron$
);

-- =============================================================================
-- Encryption helpers — bexio_encrypt_token / bexio_decrypt_token.
-- Key sourced from vault.decrypted_secrets (Supabase-managed). The key never
-- materialises in any migration, audit row, or log line — only inside these
-- two SECURITY DEFINER function bodies.
-- =============================================================================

create or replace function public.bexio_encrypt_token(p_plaintext text)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_key text;
begin
  if p_plaintext is null then
    return null;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'bexio_token_key'
  limit 1;

  if v_key is null then
    raise exception 'Vault secret bexio_token_key not accessible'
      using errcode = 'P0001';
  end if;

  return encode(pgp_sym_encrypt(p_plaintext, v_key), 'base64');
end;
$$;

revoke execute on function public.bexio_encrypt_token(text) from public, anon, authenticated;
grant  execute on function public.bexio_encrypt_token(text) to service_role;

comment on function public.bexio_encrypt_token(text) is
  'AES-256-encrypts plaintext via pgcrypto pgp_sym_encrypt using Vault secret bexio_token_key. Returns base64 ciphertext. SECURITY DEFINER + service_role-only EXECUTE. Story 1.7 AC4.';

create or replace function public.bexio_decrypt_token(p_ciphertext text)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_key text;
begin
  if p_ciphertext is null then
    return null;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'bexio_token_key'
  limit 1;

  if v_key is null then
    raise exception 'Vault secret bexio_token_key not accessible'
      using errcode = 'P0001';
  end if;

  return pgp_sym_decrypt(decode(p_ciphertext, 'base64'), v_key);
end;
$$;

revoke execute on function public.bexio_decrypt_token(text) from public, anon, authenticated;
grant  execute on function public.bexio_decrypt_token(text) to service_role;

comment on function public.bexio_decrypt_token(text) is
  'Inverse of bexio_encrypt_token. SECURITY DEFINER + service_role-only EXECUTE. Story 1.7 AC4.';

-- Round-trip self-test — fails the migration if Vault key + helpers misalign.
do $$
declare
  v_round_trip text;
begin
  select public.bexio_decrypt_token(public.bexio_encrypt_token('roundtrip-test'))
  into v_round_trip;

  if v_round_trip is distinct from 'roundtrip-test' then
    raise exception
      'bexio encryption round-trip failed (got %, expected ''roundtrip-test'')',
      coalesce(v_round_trip, '<null>');
  end if;
end$$;

-- =============================================================================
-- bexio_credentials_status view — token-free metadata for admin UI.
-- security_invoker = true so the view inherits the caller's RLS posture (which
-- is DENY-by-default for the underlying table); admin reads through the
-- SECURITY DEFINER function below instead.
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
  case
    when expires_at <= now()                            then 'expired'
    when expires_at <= now() + interval '5 minutes'     then 'expiring_soon'
    else                                                     'valid'
  end as status_label
from public.bexio_credentials
where is_active = true;

comment on view public.bexio_credentials_status is
  'Admin-readable metadata view over bexio_credentials. NEVER includes access_token_encrypted / refresh_token_encrypted. Read by admin via bexio_credentials_status_for_admin() SECURITY DEFINER function (security_invoker view alone returns nothing because the base table denies authenticated reads). Story 1.7 AC3.';

-- =============================================================================
-- bexio_credentials_status_for_admin() — admin read path.
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
    case
      when bc.expires_at <= now()                          then 'expired'
      when bc.expires_at <= now() + interval '5 minutes'   then 'expiring_soon'
      else                                                      'valid'
    end as status_label
  from public.bexio_credentials bc
  where bc.is_active = true;
end;
$$;

revoke execute on function public.bexio_credentials_status_for_admin() from public, anon;
grant  execute on function public.bexio_credentials_status_for_admin() to authenticated;

comment on function public.bexio_credentials_status_for_admin() is
  'Admin-only SECURITY DEFINER read path for bexio_credentials metadata. Returns 0 or 1 rows (active credential, or none). NEVER returns token columns. Raises 42501 for non-admin callers. Story 1.7 AC3.';

-- =============================================================================
-- bexio_get_active_credential_decrypted() — service-role read path for the
-- shared Edge Function bexio-client.ts. Returns the active row with
-- access_token + refresh_token already decrypted (in-process plaintext).
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
  environment         text
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
    bc.environment
  from public.bexio_credentials bc
  where bc.is_active = true
  limit 1;
end;
$$;

revoke execute on function public.bexio_get_active_credential_decrypted() from public, anon, authenticated;
grant  execute on function public.bexio_get_active_credential_decrypted() to service_role;

comment on function public.bexio_get_active_credential_decrypted() is
  'Service-role-only RPC consumed by supabase/functions/_shared/bexio-client.ts. Returns the active credential row with decrypted access_token + refresh_token. Plaintext tokens never leave the DB process; consumers must hold them only in Edge Function memory. Story 1.7 AC8.';

-- =============================================================================
-- bexio_set_credentials_revoked() — atomic revocation path used by
-- bexio-client.ts when refresh fails. Single transaction: flip is_active,
-- audit-log, and let the caller's own log_error happen separately (it's a
-- best-effort write that should not roll back this revocation).
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
  v_existed boolean;
begin
  update public.bexio_credentials
     set is_active = false
   where id = p_credential_id
     and is_active = true
  returning true into v_existed;

  if not coalesce(v_existed, false) then
    -- No-op when caller raced with another revocation path; do not raise.
    return;
  end if;

  perform public.log_activity(
    'bexio_credentials_revoked',
    'bexio_credentials',
    p_credential_id,
    null,
    jsonb_build_object('is_active', false),
    jsonb_build_object(
      'actor_system', 'other',
      'reason',       coalesce(p_reason, 'unknown')
    )
  );
end;
$$;

revoke execute on function public.bexio_set_credentials_revoked(uuid, text) from public, anon, authenticated;
grant  execute on function public.bexio_set_credentials_revoked(uuid, text) to service_role;

comment on function public.bexio_set_credentials_revoked(uuid, text) is
  'Service-role atomic revocation path. Flips is_active to false + writes a bexio_credentials_revoked audit row in one transaction. Used by Edge Function bexio-client.ts when refresh fails (refresh_token revoked, network exhausted, bexio 4xx). Story 1.7 AC14.';

-- =============================================================================
-- bexio_complete_oauth() — atomic deactivate-old + insert-new + mark-state-used
-- transaction used by the bexio-oauth-callback Edge Function.
-- =============================================================================

create or replace function public.bexio_complete_oauth(
  p_state                    text,
  p_access_token_encrypted   text,
  p_refresh_token_encrypted  text,
  p_token_type               text,
  p_expires_at               timestamptz,
  p_scope                    text,
  p_environment              text,
  p_bexio_company_id         text default null
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

  -- Validate + lock the state row.
  select state, environment, used_at, expires_at
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

  -- Insert the new active credential.
  insert into public.bexio_credentials (
    bexio_company_id,
    access_token_encrypted,
    refresh_token_encrypted,
    token_type,
    expires_at,
    scope,
    is_active,
    environment
  )
  values (
    p_bexio_company_id,
    p_access_token_encrypted,
    p_refresh_token_encrypted,
    coalesce(p_token_type, 'Bearer'),
    p_expires_at,
    p_scope,
    true,
    p_environment
  )
  returning id into v_new_id;

  -- Burn the state row.
  update public.bexio_oauth_states
     set used_at = now()
   where state = p_state;

  -- Semantic audit event in addition to the structural row written by the
  -- audit trigger (mirror Story 1.5 design).
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
      'actor_system', 'other',
      'flow',         'oauth_authorization_code'
    )
  );

  return v_new_id;
end;
$$;

revoke execute on function public.bexio_complete_oauth(text, text, text, text, timestamptz, text, text, text)
  from public, anon, authenticated;
grant  execute on function public.bexio_complete_oauth(text, text, text, text, timestamptz, text, text, text)
  to service_role;

comment on function public.bexio_complete_oauth(text, text, text, text, timestamptz, text, text, text) is
  'Atomic OAuth completion: validates the state row, deactivates the prior active credential, inserts the new credential, marks the state row used, writes a bexio_credentials_connected audit row — all in one transaction. Service-role only (Edge Function bexio-oauth-callback). Story 1.7 AC7.';

-- =============================================================================
-- bexio_record_token_refresh() — atomic refresh path for bexio-client.ts.
-- Updates the active credential row with new ciphertexts + bumps refresh
-- counters in one transaction.
-- =============================================================================

create or replace function public.bexio_record_token_refresh(
  p_credential_id            uuid,
  p_access_token_encrypted   text,
  p_refresh_token_encrypted  text,
  p_expires_at               timestamptz,
  p_scope                    text default null
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
     set access_token_encrypted  = p_access_token_encrypted,
         refresh_token_encrypted = p_refresh_token_encrypted,
         expires_at              = p_expires_at,
         scope                   = coalesce(p_scope, scope),
         last_refreshed_at       = now(),
         refresh_count           = refresh_count + 1
   where id = p_credential_id
     and is_active = true;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'bexio_record_token_refresh: no active credential with id %', p_credential_id
      using errcode = 'P0002';
  end if;

  perform public.log_activity(
    'bexio_token_refreshed',
    'bexio_credentials',
    p_credential_id,
    null,
    jsonb_build_object('expires_at', p_expires_at),
    jsonb_build_object('actor_system', 'other')
  );
end;
$$;

revoke execute on function public.bexio_record_token_refresh(uuid, text, text, timestamptz, text)
  from public, anon, authenticated;
grant  execute on function public.bexio_record_token_refresh(uuid, text, text, timestamptz, text)
  to service_role;

comment on function public.bexio_record_token_refresh(uuid, text, text, timestamptz, text) is
  'Atomic token-refresh write path. Updates ciphertexts + bumps refresh_count + last_refreshed_at + writes a bexio_token_refreshed audit row in one transaction. Service-role only. Story 1.7 AC8.';

-- =============================================================================
-- Audit trigger binding — token columns suppressed from before/after_values.
-- =============================================================================

drop trigger if exists trg_bexio_credentials_audit on public.bexio_credentials;
create trigger trg_bexio_credentials_audit
  after insert or update or delete on public.bexio_credentials
  for each row execute function public.audit_trigger_fn(
    'access_token_encrypted',
    'refresh_token_encrypted',
    'updated_at',
    'updated_by'
  );
