-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 016: the TradingView sign-in
-- ───────────────────────────────────────────────────────────────────────────
-- One row, written and read by doji-tradingview alone: the OAuth client, the
-- tokens, and between ?connect=1 and the callback the state and PKCE verifier.
-- A table rather than an Edge secret because the refresh token may rotate on
-- every use and a function cannot rewrite its own secrets.
--
-- No policy, for 008's reason. Never in the memory backup: a live refresh token
-- in a workflow artefact is the account.
--
-- Safe to re-run.
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

-- Both public roles by name, for 007's reason: a row holding a credential
-- gets two walls, not RLS alone.
revoke all on public.tradingview_auth from anon, authenticated;
