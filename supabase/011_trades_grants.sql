-- ═══════════════════════════════════════════════════════════════════════════
-- DOJI — the journal/broker boundary, said to the database
-- ───────────────────────────────────────────────────────────────────────────
-- 001's policy decides which ROWS a session may write, not which columns, and
-- Supabase's default privileges grant anon and authenticated everything on a
-- new table by name. So any signed-in session could update net_pnl directly
-- through PostgREST. This narrows the app to the columns it owns.
--
-- Five, not Data.OWNED's four: delete and undo write `deleted` through
-- update() directly. agree.test.mjs holds the list against both.
--
-- Idempotent, so re-applying is safe. To roll back, restoring exactly
-- Supabase's defaults, with RLS still behind them:
--
--     grant insert, update, delete on public.trades to anon, authenticated;
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT is untouched: the app and realtime read every column. PUBLIC and both
-- roles by name, for 007's reason.
revoke insert, update, delete on public.trades from public, anon, authenticated;

-- The four journal answers and the soft-delete flag.
grant update (setup, followed_rules, followed_sl, followed_tp, deleted)
  on public.trades to authenticated;

-- No INSERT: every row arrives from a broker writer holding the secret key.
-- No DELETE: a removal is the `deleted` flag, and the history stays.
