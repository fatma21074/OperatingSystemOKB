# OKB v173 — Smart Rescue Evidence Path

Base: `OKB_v172_Rescued_Export_Classic_With_Details`

## Change scope
Only the rescue qualification logic inside `OKB Abnormal -> أوردرات تم إنقاذها` was adjusted.

## Final rescue rule
An order is counted as rescued only when:
1. Its current status is `Signed`.
2. Its history contains a real previous `Returned` or `Cancel` state.
3. There is real collection evidence **after the latest** `Returned/Cancel`:
   - Preferred proof: `order_collected` Activity Log event after that state.
   - Legacy fallback: `collected_at` / latest collection timestamp is later than that state.

`Delivering` remains part of the normal operational journey, but it is no longer a mandatory Activity Log record for rescue qualification because historical logs may not contain that intermediate state.

A manual change to `Signed` without post-abnormal collection evidence is still NOT counted as rescued.

## Preserved behavior
- Date filter remains based on `created_at` exactly as before.
- Existing classic export + details-below layout remains unchanged.
- If a Delivering event exists after the abnormal state, it is still captured in the rescue details; if legacy history lacks it, the field is simply blank.
- No SQL migration.
- No changes to Commission, Treasury, Financial Engine, Stock, Permissions, OKB Filter, Secretary Audit, navigation, or any other feature.
