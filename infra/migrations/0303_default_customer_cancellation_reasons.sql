-- أسباب إلغاء افتراضية **للعميل** — نظير `0216_default_technician_cancellation_reasons.sql`
-- اللي بذر أسباب الفني وحده.
--
-- الفجوة اللي بيقفلها (اتقاست حيًا في تدقيق ج-٣): `GET /cancellation-reasons?applies_to=customer`
-- كان بيرجّع **قايمة فاضية** — مفيش ولا سبب عميل واحد في القاعدة. النتيجتين المباشرتين:
--
--   ١. شاشة إلغاء الطلب في `customer-app` و`customer-web` بتفتح قايمة اختيار فاضية. الاتنين
--      بيندهوا نفس المسار وبيبعتوا `cancellation_reason_id` أصلاً — فالواجهة مبنية صح، الداتا
--      هي اللي ناقصة.
--   ٢. **سياسة رسوم إلغاء العميل عمليًا معطّلة**: الرسم بيتحسب من `charges_fee`/`fee_percentage`
--      على صف السبب (`order-cancellation.service.ts`)، فمن غير صفوف مفيش أي إلغاء عميل ممكن
--      يترتب عليه رسم مهما كانت نية الإدارة.
--
-- `charges_fee = false` لكل الصفوف هنا **مقصود**: نسبة الرسم قرار عمل للمالك مش رقم نخترعه
-- (قاعدة CLAUDE.md). البذر ده بيخلي السياسة **قابلة للتفعيل** من شاشة الأدمن الموجودة
-- (`/admin/cancellation-reasons`) بدل ما تفضل غير قابلة للوصول أصلاً.
--
-- **أثر سلوكي مقصود ومهم**: `order-cancellation.service.ts` بيفرض اختيار سبب **لو** فيه أسباب
-- عميل معرّفة. بعد الـmigration دي، إلغاء العميل من غير `cancellation_reason_id` هيترفض بـ
-- «لازم تختار سبب الإلغاء من القايمة». اتأكد إن التطبيقين بيبعتوه فعلاً قبل التطبيق:
-- `customer-app/lib/features/orders/orders_repository.dart` و`customer-web/src/app/orders/[id]/page.tsx`.
--
-- الإدخال idempotent بالاسم + النوع — مايكررش صف أنشأه الأدمن قبل كده.
INSERT INTO cancellation_reasons
  (reason_ar, reason_en, applies_to, charges_fee, fee_percentage, affects_technician_score, display_order, requires_free_text)
SELECT v.reason_ar, v.reason_en, 'customer'::cancellation_applies_to, false, 0, false, v.display_order, v.requires_free_text
FROM (VALUES
  ('غيّرت رأيي', 'Changed my mind', 10::smallint, false),
  ('حجزت بالغلط', 'Booked by mistake', 20::smallint, false),
  ('الموعد مابقاش مناسب', 'The appointment no longer works for me', 30::smallint, false),
  ('لقيت حل تاني للمشكلة', 'Found another solution for the problem', 40::smallint, false),
  ('السعر أعلى من المتوقع', 'Price is higher than expected', 50::smallint, false),
  ('الفني اتأخر', 'The technician was late', 60::smallint, false),
  ('سبب آخر', 'Other reason', 90::smallint, true)
) AS v(reason_ar, reason_en, display_order, requires_free_text)
WHERE NOT EXISTS (
  SELECT 1 FROM cancellation_reasons cr
  WHERE cr.applies_to = 'customer' AND cr.reason_ar = v.reason_ar
);
