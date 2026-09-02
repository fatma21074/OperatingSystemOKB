# تثبيت مراجع OCR المالي — OKB CRM

> لا ترفع النسخة أونلاين قبل إكمال الخطوات التالية واختبارها محليًا.

## 1) إنشاء جدول نتائج المراجعة

افتح Supabase → SQL Editor → New query، ثم انسخ وشغّل الملف:

`supabase/009_payment_ocr_audit.sql`

## 2) إعداد Google Cloud Vision

1. أنشئ/اختر مشروعًا في Google Cloud.
2. فعّل Cloud Vision API.
3. أنشئ API Key مخصصًا للخدمة.
4. يفضّل تقييد المفتاح على Cloud Vision API ووضع حد يومي للاستخدام.

## 3) حفظ المفتاح بأمان

في Supabase → Edge Functions → Secrets أضف:

- Name: `GOOGLE_VISION_API_KEY`
- Value: مفتاح Google Vision

لا تضع المفتاح داخل `main.js` أو GitHub.

## 4) نشر Edge Function

انشر الوظيفة الموجودة في:

`supabase/functions/okb-payment-ocr/index.ts`

ويجب أن يكون اسم الوظيفة:

`okb-payment-ocr`

واجعل Verify JWT مغلقًا؛ الوظيفة تتحقق بنفسها من جلسة OKB الآمنة.

## 5) الاختبار

1. سجّل أوردر Deposit بقيمة 100 مع صورة واضحة بقيمة 100.
2. افتح Financial Audit واضغط إعادة الفحص؛ يجب ظهور OCR مطابق.
3. جرّب صورة بقيمة مختلفة؛ يجب ظهور اختلاف وإرسال رسالة Chat من Financial Audit.
4. جرّب تحصيل كاش + تحويل؛ يجب مقارنة الصورة بجزء التحويل فقط.

## قواعد الأمان

- OCR مراجع مساعد ولا يعدل أي مبلغ.
- فشل OCR لا يمنع حفظ الأوردر أو التحصيل.
- لا تعتمد على OCR وحده في قرار اتهام موظف؛ الصور غير الواضحة تحتاج مراجعة بشرية.
