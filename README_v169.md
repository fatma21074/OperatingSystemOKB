# OKB v169 — Secretary Audit Branch-Only Notifications

Base: OKB v168 Dashboard Back + Label

## Changes
- Secretary Audit notifications are now generated only from the four OKB branch pages:
  - مدينة نصر
  - اسكندرية
  - طنطا
  - المنصورة
- Dashboard/company order entry no longer generates Secretary Audit notifications, blocked-draft alerts, audit chat alerts, or resolution notifications.
- New Secretary Audit activity events include an explicit `source_scope: branch` marker.
- The header notification badge only counts events carrying the explicit branch source marker and one of the four approved branches.
- Payment OCR Secretary Audit notifications only fire for orders explicitly saved from a branch page.
- Branch orders store `secretary_audit_scope: branch` in existing order metadata; Dashboard orders store `secretary_audit_scope: dashboard`.

## Safety
- No SQL migration required.
- No changes to Financial Engine, Commission, Treasury, Stock, Signed, Permissions, OKB Filter, or navigation logic.
