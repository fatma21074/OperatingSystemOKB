# OKB v202 — Area Analysis Left View Fix

Built on v201.

## Fixed
- `Area Analysis` and `Doctor Breakdown` now open with column A on the **left** (`rightToLeft: false`).
- Arabic text, alignment inside cells, calculations, comparison column, colors, Smart Area Match and permissions are unchanged.
- Removed two accidental worksheet-view lines that had leaked into `Pending Orders` export in v200/v201 and referenced variables that do not belong to that export. This restores Pending export to its pre-leak behavior.
- Uses physical asset `js/main.v202.js` to avoid stale browser cache.

No SQL changes.
