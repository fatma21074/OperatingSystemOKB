# OKB v155 — Branch Rank Performance

This version is based on v154 and optimizes Branch Rank only. The central financial engine, Doctor Rank, Daily Report, Operation Manager workbook, branch pages, Commission, CSS, and all Supabase migrations remain unchanged.

## Branch Rank improvements

- Loads and renders the selected current period before the previous-month comparison finishes.
- Prefetches comparison data in the background; ranking tabs reuse it without a new query.
- Reuses a completed in-memory snapshot for 60 seconds and refreshes stale data in the background.
- Deduplicates concurrent requests and cancels superseded date or permission scopes.
- Uses exact Cairo day boundaries and stable pagination beyond 1,000 orders.
- Requests only the columns required by Branch Rank and limits branch-mode database reads to the four OKB branches (or the account's managed branches).
- Rechecks the active account, Role permission, managed branches, and selected scope before accepting any page of results.
- Processes each Branch Rank order once through the existing central effective-price rule, then reuses one derived snapshot for KPIs, the details table, both ranking tabs, and charts.
- Keeps current-period and comparison snapshots synchronized with Realtime INSERT, UPDATE, and DELETE events.
- Keeps the last complete same-scope snapshot if a forced refresh fails after a later page.
- Avoids destroying and rebuilding charts when the dataset and theme have not changed.

## Unchanged rules

- Orders whose centrally recovered effective price is below 40 remain excluded.
- Group Cancel remains excluded from Branch Rank Total and the conversion denominator.
- Conversion, return rate, score, and previous-month comparison formulas are unchanged.
- Store Manager comparison behavior remains unchanged.
- Operation Manager Report keeps its independent secure financial loader and workbook reconciliation checks.

## Database

No SQL migration is required for v155.

## Verification

- Branch Rank suites cover Cairo boundaries, 1,000+ pagination, current-first rendering, current/comparison cache reuse, forced refresh, one-pass financial aggregation, managed-branch scope, permission revocation, request cancellation, failed later pages, Realtime synchronization, and year/leap-month comparisons.
- Existing Doctor Rank, Daily Report, Pending, Operation Manager, Commission, branch pages, CSS, and Supabase files are checked for regressions or byte identity where applicable.
