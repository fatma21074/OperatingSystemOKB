# OKB v167 — OKB Filter Permission Card

Built directly on OKB v166.

## Change scope
- Added an independent **OKB Filter** card in **Permission**, directly beside **Commission 🚩**.
- The card reads active statuses from the central OKB Filter registry.
- Each selected Role can show/hide individual filter statuses.
- Admin always sees all active filters and keeps full permissions.
- Permission changes are reflected live through the existing Role Permission realtime sync.
- The permission controls **filter visibility only**. It does not grant status editing, collection, treasury, Signed, inventory, or financial permissions.
- `كل الحالات` remains fixed and is not permission-controlled.
- Existing roles keep v166 behavior by default: filters remain visible until Admin explicitly disables them for a Role.

## Database
No new SQL migration is required. Dynamic filter permissions are stored inside the existing `role_permissions.permissions` JSON.
