# OKB v172 — Rescued Export Classic + Details Below

## التعديل
تم الحفاظ على منطق `أوردرات تم إنقاذها` كما هو تمامًا من v171/v170 بدون أي تغيير في شروط الإنقاذ أو التاريخ.

داخل Tab `أوردرات تم إنقاذها` في Excel:

1. الجزء العلوي عاد لنفس شكل وبيانات التقرير القديم:
   - Ticket ID
   - Order Number
   - Customer
   - Doctor
   - Branch
   - Status
   - Mobile
   - Mobile 2
   - Price
   - Paid
   - Remaining
   - Notes
   - Date

2. بعد انتهاء البيانات القديمة يوجد سطران فارغان ثم قسم مستقل بعنوان `تفاصيل رحلة الإنقاذ`.

3. القسم السفلي يحتفظ بالتفاصيل الإضافية الخاصة برحلة الإنقاذ، مثل:
   - الحالة قبل الإنقاذ
   - سبب الإلغاء / المرتجع
   - تاريخ الإلغاء / المرتجع
   - تاريخ العودة Delivering
   - تاريخ إنقاذ الأوردر
   - مدة الإنقاذ
   - Total Revenue / Deposit / قيمة التحصيل
   - طريقة الدفع
   - تم الإنقاذ بواسطة
   - آخر ملاحظة + المستخدم + التاريخ

## مهم
- لم يتغير منطق تعريف Rescued Order.
- لم تتغير فلترة الفترة المعتمدة على `created_at`.
- لا يوجد SQL جديد.
- لا توجد تغييرات على Commission / Treasury / Financial Engine / Stock / Permissions / OKB Filter / Secretary Audit / Navigation.
