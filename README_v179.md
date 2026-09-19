# OKB v179 — Financial Audit Permissions + Locked Treasury Audit

## التعديلات

- إضافة صلاحيتين مستقلتين ومتتاليتين داخل `🔐 Permission → الخزنة — تقارير`:
  - `🛡️ Financial Audit (رئيسي)` (`btn_financial_audit_main`)
  - `🛡️ Financial Audit (خزنة)` (`btn_khazna_financial_audit`)
- زر Financial Audit الرئيسي في الهيدر لم يعد Admin-only إجباريًا؛ يظهر للأدمن تلقائيًا، ولأي Role يسمح له الأدمن بالصلاحية الجديدة.
- Financial Audit (خزنة) أصبح منفصلًا ومقيدًا بسياق الخزنة المفتوحة:
  - نفس `من / إلى` الخاصة بالخزنة.
  - نفس فرع الخزنة الحالية، أو نفس نطاق خزنة الفروع عند فتحه منها.
  - لا يسمح بتغيير الفرع أو التاريخ من داخل Audit الخزنة.
  - إخفاء فلتر `كل الفروع` وفلتر `كل الموظفين` في Treasury Audit لكل المستخدمين، بما فيهم Admin.
  - تاريخ الخزنة مخفي كفلتر لأنه Bound على الخزنة المصدر.
  - يبقى فلتر `كل الحالات` هو فلتر الـAudit الرئيسي داخل Treasury Audit، بالإضافة إلى البحث.
- المستخدم غير Admin لا يرى Findings الناتجة عن حركات التحصيل/التصحيح المنسوبة للـAdmin، كما في v178.
- Admin عند فتح Audit من خزنة فرع يرى نفس الفرع والفترة لكن يحتفظ برؤية Admin Findings؛ وعند فتحه من خزنة الفروع يتبع نطاق خزنة الفروع المفتوح.
- Navigation / Back أصبح يسمح باستعادة Financial Audit الرئيسي بناءً على `btn_financial_audit_main`، وAudit الخزنة بناءً على `btn_khazna_financial_audit`.
- فتح أوردر من Financial Audit يسمح للمستخدم الذي لديه أي من صلاحيتَي Audit، مع بقاء قيود الفروع السابقة لغير Admin.

## قاعدة البيانات

لا يوجد SQL أو Migration جديد. الصلاحيات تستخدم نفس جدول `role_permissions` الحالي.
