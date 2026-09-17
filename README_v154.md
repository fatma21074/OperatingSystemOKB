# OKB v154 — Doctor Rank Performance

This version is based on v153 and changes Doctor Rank only. Shipping Rank and all Supabase migrations remain unchanged.

## Doctor Rank improvements

- Loads the current selected period with exact Cairo day boundaries.
- Requests only the columns required by Doctor Rank and restricts the database request to the four OKB branches.
- Applies the account's managed-branch scope both before the request and again before data is accepted.
- Rechecks the active user and Doctor Rank permission during paginated requests, and ignores superseded requests.
- Reuses a completed in-memory snapshot when the page or branch filter is reopened; explicit Refresh forces a fresh database read.
- Keeps live order INSERT/UPDATE/DELETE events synchronized with the cached snapshot.
- Aggregates all doctor KPIs in one pass and caches the derived result.
- Uses the existing central financial functions (`getEffectiveOrderPrice` and `getOrderOutstandingBalance`) without changing their logic.
- Weekly comparison reuses the loaded period when possible and otherwise uses the same scoped Doctor Rank loader.
- Displays loading, success, and error state without replacing a valid same-period snapshot after a failed refresh.

## Database

No SQL migration is required for v154.

## Verification

- 11 Doctor Rank suites passed against the actual application functions with mocked Supabase/DOM interfaces.
- Covered Cairo boundaries, pagination beyond 1,000 rows, cache reuse, forced refresh, managed-branch scope, permission revocation, request cancellation, failed later pages, Realtime changes, weekly reuse, and central financial recovery.
- The 9 Daily Report regression suites passed on v154.
- Pending deletion/month behavior and the critical Operation Manager financial/week reconciliation suites passed on v154.
- Shipping Rank functions, central financial functions, and every file under `supabase/` are byte-identical to v153.
