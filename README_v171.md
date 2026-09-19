# OKB v171 — Rescued Orders Export Intelligence

Base: OKB v170 Abnormal Rescue Path.

## Scope
This release changes only the OKB Abnormal Excel export for the sheet `أوردرات تم إنقاذها` and the metadata already loaded from Activity Log to support that export.

## Rescued Orders sheet additions
- الحالة قبل الإنقاذ: Returned / Cancel.
- سبب الإلغاء / المرتجع.
- تاريخ الإلغاء / المرتجع: timestamp of the qualifying abnormal status event.
- تاريخ العودة Delivering: timestamp of the Delivering event after the abnormal status.
- تاريخ إنقاذ الأوردر: accounting collection timestamp / collected_at, with safe fallbacks.
- مدة الإنقاذ (يوم): elapsed whole days from abnormal status to rescue collection.
- Total Revenue: effective order total.
- Deposit.
- قيمة التحصيل عند الإنقاذ.
- طريقة الدفع.
- تم الإنقاذ بواسطة: collection activity user / collection metadata.
- آخر ملاحظة: latest `order_note_added` activity for the order.
- أضيفت بواسطة.
- تاريخ آخر ملاحظة.
- تاريخ إنشاء الأوردر.
- Status.

## Behavior preserved
- Rescue qualification remains exactly: Returned/Cancel -> Delivering -> order_collected -> current Signed.
- Report period remains based on order `created_at`, as defined in v170.
- Other OKB Abnormal sheets keep their previous columns and behavior.
- No SQL migration required.
- No changes to Financial Engine, Commission, Treasury, Stock, Permissions, OKB Filter, Secretary Audit, navigation, or order workflow.
