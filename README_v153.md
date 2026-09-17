# OKB v153 — Daily Report Engine

## Base

This version is built directly from `OKB_v152_Pending_Current_Month` and preserves its existing application and Supabase files.

## Daily Report purpose

- The page is now a focused registration and operations report for the four approved branches.
- The default preset is the current Cairo day.
- Presets cover today, the last seven Cairo days, and the current month from day one through today.
- A custom historical `From / To` range remains supported.
- `Reset` always returns to today and the Daily tab.

## Counts and filters

- Registered Total counts each saved order once, including Cancel, zero-value, and error-tagged orders.
- Zero Orders uses the same stored-zero classification used by the Dashboard and branch pages.
- Error Orders uses the existing `error_order` metadata flag.
- Cards cover Signed, Delivering, Returned, Cancel, other statuses, and each of the four branches.
- Branch and category filters can be combined; search can narrow Ticket ID, order number, customer, employee, branch, or status.
- The table is paginated at 40 rows so large periods do not create an oversized DOM.

## Central financial engine

- Price, Deposit, collected amount, and remaining amount are calculated through the existing `analyzeOrderFinancials`, `getEffectiveOrderPrice`, collection-history, and outstanding-balance paths.
- Financial cards and exported values follow the same filtered rows shown in the table.
- Each order can be opened in a separate same-origin tab and is checked again against the report permission and branch access.

## Loading and integrity

- The query uses the exact Cairo UTC range instead of a multi-day safety margin.
- Only the fields required by this report are requested; large unrelated order fields are not downloaded.
- Results are paginated beyond 1,000 rows and deduplicated by order ID.
- The same range is cached, while `Refresh` explicitly requests fresh data.
- A changed range stops the older paginated request before it downloads another page.
- Realtime insert, update, and delete events update the cached report without a forced full reload.
- A failed later page never replaces a complete dataset, and Export is blocked until a successful refresh.
- Branch-scoped accounts are filtered in the database request and rechecked in the client.

## Verification

- JavaScript syntax validation passed.
- 9 focused Daily Report suites passed.
- 8 current-month Pending suites passed against this version.
- 7 Operation Manager / central-financial reconciliation suites passed.
- 14 existing new-tab and Commission export checks passed, plus a focused Daily Report historical new-tab check.
- HTML parsing found no duplicate IDs.
- No Supabase migration or database change is required for v153.

The verification uses the application functions with simulated Supabase, DOM, and export interfaces. It does not replace a final smoke test against the deployed production database and browser.
