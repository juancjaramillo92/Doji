-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — 017: one renewal of the TradingView sign-in at a time
-- ───────────────────────────────────────────────────────────────────────────
-- An OAuth server that rotates may treat a refresh token presented twice as
-- stolen and revoke the whole sign-in. Once the briefing and the release look
-- both read through doji-tradingview, two of them can find the access token
-- stale in the same second and both present the refresh token — so a renewal
-- takes this lease first, by a PATCH filtered on it being empty or lapsed. That
-- is the arbitration `balance` uses: a filter Postgres evaluates inside the
-- UPDATE, with no read to lose a race against. Whoever does not get the lease
-- waits for the token the holder writes.
--
-- A lease rather than a flag because a holder can die mid-renewal, and a flag
-- left set would stop every renewal after it. This one lapses on its own.
--
-- Safe to re-run: `if not exists`.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.tradingview_auth add column if not exists refreshing_until timestamptz;
