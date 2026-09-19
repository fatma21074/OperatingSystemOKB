# OKB v180 — Treasury Audit Fixed Branch Filter

Base: v179.

## التعديل
- إصلاح ظهور فلاتر Financial Audit (خزنة) بعد تحويل الـselects إلى searchable controls.
- إزالة فلتر `كل الموظفين` بالكامل من Financial Audit (خزنة)، بما في ذلك الـsearchable wrapper وليس الـselect المخفي فقط.
- فلتر الفرع في Financial Audit (خزنة) أصبح قيمة ثابتة Read-only مرتبطة بفرع/نطاق الخزنة المفتوحة، ولا يمكن تغييره من شاشة الـAudit.
- المستخدم غير Admin يرى فرعه المسموح فقط؛ الـAdmin عند الدخول من Treasury Audit يظل مربوطًا بسياق الخزنة المفتوحة.
- يظل فلتر `كل الحالات` متاحًا كفلتر الـAudit التفاعلي.
- Financial Audit (رئيسي) لم يتغير: يحتفظ بفلاتر الفرع والموظف والحالات.

لا يوجد SQL جديد.
