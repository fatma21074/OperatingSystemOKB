# OKB v166 — Financial Safety Fixes

تم بناء هذه النسخة مباشرة على `OKB_v165_Treasury_Center_Refresh` مع الحفاظ على جميع التعديلات السابقة.

## التعديلات فقط
1. تقرير طباعة مطابقة اليومية يستخدم نفس معادلة الشاشة ونفس `FINANCIAL_TOLERANCE` عبر `difference = net - expectedReconciliationNetCash` بدل الاعتماد على `net > 0`.
2. عند تعديل أوردر من صفحة الفرع، اختيار `Signed` لا يظهر لأي مستخدم غير Admin. الـAdmin يحتفظ بكل الصلاحيات كما هي.
3. قفل اليومية لا يستخدم `localStorage` كبديل عند فشل الحفظ. حالة اليومية لا تتحول إلى Locked إلا بعد نجاح الحفظ في جدول `khazna_lock` بقاعدة البيانات.

لا يوجد SQL Migration جديد، ولا تغييرات على CSS أو Financial Engine أو Commission أو المخزون أو الفلاتر أو صلاحيات Admin.
