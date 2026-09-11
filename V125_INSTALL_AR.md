# v125 — Role Commission + Branch Stock Lock

شغّل الملف التالي مرة واحدة من Supabase SQL Editor باختيار **Run without RLS**:

`supabase/019_role_commission_branch_stock_lock.sql`

الملف آمن سواء تم تشغيل Migration 018 القديم أم لم يتم تشغيله.

## Commission 🚩

- الصلاحية تظهر داخل مجموعة **OKB Stores** في جدول Permission الطبيعي.
- اختر الـRole ثم فعّل `Commission 🚩` واضغط **حفظ الصلاحيات**.
- Admin يرى جميع الفروع.
- أي Role مصرح له يرى فقط الفروع الموجودة في `managed_branches` لحسابه.
- فحص الصلاحية والفرع يتم داخل Supabase قبل إرجاع بيانات التقرير.

## Branch Stock

- Admin يرى جميع الفروع.
- أي مستخدم آخر، بما في ذلك Account Manager، يرى فقط الفروع المسندة إلى حسابه.
- لو مدير الحسابات مطلوب له كل الفروع، اربط حسابه بالفروع الأربعة من Users.
- سياسات Supabase تقيد الأرصدة والاستلامات وسجل المخزون حسب الفرع.
- تعديل ربط الفروع أو صلاحيات الـRoles متاح للـAdmin فقط.

لا يغير الملف أرصدة المخزون أو الأوردرات أو Signed أو التحصيل أو قفل اليومية.
