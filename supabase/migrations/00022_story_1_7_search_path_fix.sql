-- Migration 00022 — Story 1.7 fix-up: drop `vault` from the encryption helpers'
-- search_path.
--
-- Background:
--   Migration 00021 created `bexio_encrypt_token` / `bexio_decrypt_token` with
--   `set search_path = public, vault, extensions`. Authenticated callers (who
--   are denied EXECUTE on these functions) trigger a Supabase Cloud
--   pooler-level connection termination instead of a clean 42501 — Postgres
--   appears to validate every schema in the function's search_path against
--   the calling role before raising the EXECUTE-denied error, and the
--   `authenticated` role lacks USAGE on the locked-down `vault` schema. The
--   resulting failure mode is "Connection terminated unexpectedly" which
--   confused the smoke matrix.
--
-- Fix:
--   Drop `vault` from the search_path. The function body already references
--   `vault.decrypted_secrets` with a fully-qualified name; `vault` doesn't
--   need to be on the search_path for resolution.
--
-- Same `extensions` schema is kept on the search_path so `pgp_sym_encrypt` /
-- `pgp_sym_decrypt` / `encode` / `decode` resolve cleanly under the locked
-- search_path.

create or replace function public.bexio_encrypt_token(p_plaintext text)
returns text
language plpgsql
security definer
set search_path = public, extensions
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

create or replace function public.bexio_decrypt_token(p_ciphertext text)
returns text
language plpgsql
security definer
set search_path = public, extensions
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

-- Round-trip self-test still passes.
do $$
declare v_round_trip text;
begin
  select public.bexio_decrypt_token(public.bexio_encrypt_token('roundtrip-test-00022'))
  into v_round_trip;
  if v_round_trip is distinct from 'roundtrip-test-00022' then
    raise exception 'bexio encryption round-trip failed (got %)', coalesce(v_round_trip, '<null>');
  end if;
end$$;
