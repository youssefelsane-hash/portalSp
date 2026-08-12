# modules/buildings

نظام العمائر (docs/08 §13، `docs/adr/0003-buildings-qr-discount.md`) — كل عمارة كود فريد → QR يتحط على الباب → أي طلب بالكود ده ياخد خصم → العمارة عليها "اشتراك شهري بحد أدنى طلبات" (تتبّع بس، بدون إنفاذ تلقائي).

- **`buildings`** (migration `0065`): `code` فريد (مولّد تلقائيًا عبر `next_human_readable_number('BLD')` — نفس الدالة المستخدمة لـ`ORD-2026-000001`/`EMP-2026-000001`، مش اختراع نظام ترقيم جديد)، `name_ar`, `address_text` (نص وصفي حر — العمارة مالهاش عميل واحد يملكها فمش FK لـ`addresses`), `discount_percentage` (افتراضي 10%), `minimum_monthly_orders` (افتراضي 5), `is_active`.
- **`orders.building_id`** جديد (nullable FK) — **متبادل استبعادياً مع `promo_code` في v1** (القرار الكامل وأسبابه في ADR-0003) — طلب واحد ياخد خصم عمارة أو كود خصم، مش الاتنين. محاولة استخدام الاتنين مع بعض بترفض `400` بوضوح.
- **`GET/POST/PATCH /admin/buildings`** (`buildings.manage` صلاحية جديدة، `super_admin`/`ops_manager`) — `POST`/`PATCH` محتاجين الصلاحية، `GET` مفتوح لأي أدمن. كل صف بيرجّع `current_month_orders_count`/`meets_minimum_monthly_orders` محسوبين لحظيًا (`COUNT` مباشر من `orders.building_id` للشهر التقويمي الحالي UTC) — **تتبّع بس، مفيش تعليق تلقائي للخصم أو إشعار لو العمارة تحت الحد** (قرار متعمّد، القاموس الأصلي مالوش عاقبة محددة).
- **`GET /admin/buildings/:id/qr`** — بيرجّع `qr_data_uri` (PNG base64 عبر مكتبة `qrcode` npm، توليد محلي بالكامل بدون أي تكامل خارجي — الكود المشفّر جوّه الـ QR هو `building.code` نفسه، نص عادي). نفس عقد `{success,data,...}` زي باقي الـ API، مش صورة خام (`@Res()`) — أبسط وأقل خطورة لصورة صغيرة.
- **`POST /orders` بقى ياخد `building_code` اختياري** — بيتحل (`findActiveByCodeOrThrow`) قبل الـ transaction (مجرد قراءة، مفيش كتابة زي `promo_code` اللي محتاج `order.id` يتسجّل في `promo_code_usages`)، والخصم بيتطبّق جوّه الـ transaction (نسبة مئوية على `totalAmountCents` قبل الخصم، بعد ما رسوم الطوارئ اتضافت).
- **اتعمله اختبار حي كامل**: عمارة حقيقية اتعملت (`discount_percentage=15`, `minimum_monthly_orders=10`) وطلع كودها `BLD-2026-000001` تلقائي. `GET .../qr` رجّع `qr_data_uri` PNG حقيقي صالح. طلب حقيقي بالكود ده → خصم `6000` قرش بالظبط (15% من `40000`)، `total_amount_cents=34000`. كود غلط اترفض `404` بوضوح. محاولة `promo_code`+`building_code` مع بعض اترفضت `400`. بعد الطلب، `current_month_orders_count` ظهر `1` صح (`meets_minimum_monthly_orders=false` بما إن 1 < 10).

## إصلاح أداء حقيقي (مراجعة شاملة 2026-08-12، فرع `hgotr7`) — N+1 في `GET /admin/buildings`

`AdminBuildingsController.list()` كان بينادي `getCurrentMonthOrdersCount(b.id)` مرة منفصلة
لكل عمارة جوّه `Promise.all(buildings.map(...))` — يعني استعلام `SELECT COUNT(*)` واحد لكل
عمارة (N+1 كلاسيكي)، بدل استعلام واحد مجمّع. مش بَقّة وظيفية (النتيجة كانت صح) لكن غير كفء
مع عدد كبير من العمائر. الإصلاح: `getCurrentMonthOrdersCountBulk(buildingIds)` جديدة في
`buildings.service.ts` — استعلام واحد بـ`GROUP BY building_id` على كل الـ`IDs` دفعة واحدة،
والعمائر اللي معندهاش طلبات الشهر ده بترجع `0` تلقائيًا (`Map` مبدئي بالكل=0 قبل الاستعلام).
اتعمله اختبار حي: النتيجة طابقت `SELECT COUNT(*)` المباشر بالظبط (`1`) لعمارة حقيقية فيها طلب.

مرجع كامل: `../../../../docs/08-pricing-engine-and-platform-vision.md` §13 و`../../../../docs/adr/0003-buildings-qr-discount.md`.
