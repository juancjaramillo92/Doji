-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 016: the TradingView sign-in
-- ───────────────────────────────────────────────────────────────────────────
-- One row, written by doji-tradingview and read by nothing else. It holds what
-- an OAuth sign-in leaves behind — the client the server registered, where to
-- refresh, the tokens — and, between ?connect=1 and the browser coming back,
-- the state and PKCE verifier that prove the callback belongs to that connect.
--
-- A TABLE RATHER THAN AN EDGE SECRET because TradingView may rotate the refresh
-- token on every use and a function cannot rewrite its own secrets: kept there,
-- the sign-in would survive exactly one refresh.
--
-- No user_id and no policy, for sync_health's reason: only the function, holding
-- the secret key, ever touches it, and RLS with nothing behind it denies the
-- publishable key outright. It is NOT in the memory backup and must not be — a
-- live refresh token in a workflow artefact is the account, not a memory.
--
-- Safe to re-run: `if not exists`, and revokes that are no-ops when nothing is
-- held.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.tradingview_auth (
  id                text primary key default 'current' check (id = 'current'),
  client_id         text,
  token_endpoint    text,
  resource          text,
  access_token      text,
  refresh_token     text,
  expires_at        timestamptz,
  pending_state     text,
  pending_verifier  text
);

alter table public.tradingview_auth enable row level security;

-- Both public roles by name, for 007's reason: they hold table privileges from
-- the schema's default grants, and RLS is the second wall rather than the only
-- one for a row that holds a credential.
revoke all on public.tradingview_auth from anon, authenticated;
