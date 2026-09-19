# OKB v170 — Abnormal Rescue Path Control

تم البناء على **v169** مع الحفاظ على منطق التاريخ الحالي في OKB Abnormal بدون تغيير.

## التعديل الوحيد
كارت **أوردرات تم إنقاذها** لا يعتبر الأوردر Rescued لمجرد أن حالته الحالية Signed وكان Returned/Cancel سابقًا.

المسار المطلوب أصبح موثقًا من Activity Log بهذا الترتيب:

`Returned / Cancel -> Delivering -> order_collected (Collection Engine) -> current Signed`

- Returned/Cancel يجب أن تكون حالة صريحة مسجلة في Activity Log.
- بعد آخر حالة غير طبيعية يجب وجود حالة `Delivering` صريحة.
- بعدها يجب وجود حدث `order_collected` ناتج عن محرك التحصيل.
- والحالة الحالية للأوردر يجب أن تكون `Signed`.
- تغيير الحالة يدويًا إلى Signed بدون المرور بالمسار أعلاه لا يدخل الكارت.
- إذا عاد الأوردر إلى Returned/Cancel مرة أخرى، يبدأ التحقق من جديد من آخر حالة غير طبيعية.

## التاريخ
لم يتم تغيير آلية التاريخ: التقرير ما زال يعتمد فترة `created_at` للأوردر كما كانت في v169، حسب آلية الشركة الحالية.

## لا تغييرات أخرى
- لا SQL جديد.
- لا تعديل على Commission أو Treasury أو Financial Engine أو Stock أو Permissions أو OKB Filter أو Secretary Audit أو Navigation.
