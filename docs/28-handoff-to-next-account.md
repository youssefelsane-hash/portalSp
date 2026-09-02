# تسليم للأكاونت التاني — حالة §115 بعد سيشن 2026-09-02 (مساءً)

> **اقرأ الأول**: `CLAUDE.md` → `docs/26-agent-investigation-and-delivery-method.md` →
> `docs/27-end-to-end-engineering-contract.md` → `docs/08-pricing-engine-and-platform-vision.md`
> (الـbacklog الحي) → الملف ده.

**الفرع**: `claude/home-repair-company-project-hgotr7` — آخر commit `f8e1336`.
**نقطة البداية**: `origin/main` = `e8167bc`. الفرع فيه **13 commit** فوقها لسه ماتدمجوش.

**أول أمر تعمله**:
```bash
git fetch origin main && git log --oneline origin/main..origin/claude/home-repair-company-project-hgotr7
```
لو المين اتحرّك، ادمج قبل أي شغل. **ولا تكرّر حاجة موجودة** — الدرس المكلف في السيشن دي تحت.

---

## أ) اللي اتعمل في السيشن دي (بنود 15، 16، 17 + إصلاحين)

### بند 15 — الإشعارات والريل-تايم (ADR-0067، migration 0252)

أربع قرارات في مسار التقييم كانت بتحصل **من غير أي إشعار**:

| القرار | كان بيحصل إيه | بقى إيه |
|---|---|---|
| سعر خارج النطاق اتبعت | يتحجز في `pending_admin_review` **من غير أي حدث** — الطابور قناة الاكتشاف الوحيدة | `ORDER_QUOTE_ABOVE_RANGE_SUBMITTED_EVENT` → توجيه لـ`ops_manager` |
| الأدمن **رفض** السعر | مفيش حدث خالص (المسار مابيغيّرش حالة الطلب) — الفني المطلوب منه سعر جديد محدش قاله | `ORDER_QUOTE_ABOVE_RANGE_DECIDED_EVENT` → الفني، في الاعتماد والرفض |
| انتهاء صلاحية العرض | **مفيش عملية أصلاً** — العرض مايتعلّمش `expired` غير لما العميل يحاول يوافق متأخر | `QuoteExpiryService` (كاسح كل دقيقة) → `ORDER_QUOTE_EXPIRED_EVENT` |
| التحويل لمعاينة في الموقع | العميل ماياخدش **ولا إشعار** رغم إن رسم معاينة اتضاف على طلبه | `ORDER_ROUTED_TO_ONSITE_ASSESSMENT_EVENT` بيذكر الرسم بالجنيه |

**وفجوة أكبر اتقفلت**: `NotificationRoutingService.routeToRole()` كانت بتكتب صف `in_app` لكل موظف
**من يوم ما اتبنت — ومافيش شاشة في لوحة الإدارة كانت بتقراه**. كل التوجيهات (نقص طاقم، طوارئ،
InstaPay، إلغاء فني…) بتتسجّل وتموت. اتعمل `apps/admin/src/components/notification-bell.tsx`
بيستهلك نفس الـendpoints الموجودة — صفر API جديد.

**كاتب واحد لحالة `expired`**: `InspectionQuoteService.expireQuoteInTransaction()`. التلات مسارات
(الكاسح، محاولة العميل المتأخرة، إعادة إصدار الأدمن) بتناديها.

**اختبار**: `apps/api/src/modules/orders/quote-lifecycle-notifications.spec.ts` — 8/8 حي.

### بند 16 — Audit وRBAC (ADR-0068، migration 0253)

`orders.adjust_price` كانت بتفتح **سبع** عمليات مختلفة الخطورة بصلاحية واحدة. اتفصلت لتلاتة
**مختارة بأثر التغيير مش بالـendpoint**:

| الصلاحية | إمتى بتتطلب |
|---|---|
| `orders.adjust_price` | الأساس، زي ما هي |
| `orders.approve_price_increase` | إضافة لما التعديل بيزوّد الإجمالي، وعلى اعتماد عرض خارج النطاق |
| `orders.waive_fees` | إضافة لما الإجمالي بينزل تحت رسوم التقييم/المعاينة المسجّلة |

التعريف الوحيد في `apps/api/src/modules/orders/price-change-authority.ts`. الـguard بيتأكد من
الأساسية بس (بيشتغل **قبل** ما نعرف السعر الحالي)، والـcontroller بيحلّ التنتين ويمرّرهم،
والقرار بيتاخد **جوّه الترانزاكشن بعد قفل الصف**. مفيش endpoint جديد.

**التوافق**: migration 0253 بتدي الصلاحيتين لكل دور عنده `orders.adjust_price` — صفر تغيير سلوك.

**audit اتضاف**: `order.provider_lock.released` (فك القفل بيرجّع فلوس وكان بلا audit خالص)،
`order.quote.expired`، و`change_kind` على تعديل السعر (increase/fee_waiver/decrease).

**اختبارات**: `price-authority-and-audit.spec.ts` (7) + `price-authority-enforcement.spec.ts` (4)
+ `provider-lock-no-silent-replacement.spec.ts` اتوسّع (5/5).

### بند 17 — الإلغاء والاسترداد (ADR-0069، migration 0254)

المراجعة طلعت تلات نتايج، **واحدة بس فيها فجوة**:
1. `CUSTOMER_CANCELLABLE_STATUSES` — سليمة، الأربع حالات الجديدة موجودة. مفيش تغيير.
2. رسم التقييم بالصور — قرار مالك محسوم (يرجع كامل)، مقفول باختبار. مفيش تغيير.
3. **الفجوة**: طلب معاينة في الموقع مدفوع مقدمًا → الفني سافر وعاين وسعّر → العميل لغى من
   `AWAITING_INITIAL_QUOTE_APPROVAL` → **المبلغ كله كان بيرجع** والفني ماخدش ولا مليم.

**اللي اتعمل**: `services.assessment_fee_refundable_after_visit` — سياسة لكل خدمة،
**الافتراضي `true` = سلوك ما قبل التغيير بالحرف**، مع snapshot على الطلب وتوجل في واجهة الأدمن.
القرار في `apps/api/src/modules/orders/assessment-fee-refund-policy.ts`.

**⚠️ قرار مفتوح للمالك — مش شغل ناقص**: الافتراضي ماتغيّرش عمدًا. ده تغيير في فلوس العملاء.
لو المالك قال «الحجب يبقى الافتراضي» → migration جديدة بسطر واحد:
`ALTER TABLE services ALTER COLUMN assessment_fee_refundable_after_visit SET DEFAULT false;`
+ `UPDATE services SET assessment_fee_refundable_after_visit = false WHERE onsite_assessment_enabled;`

**اختبار**: `assessment-fee-refund-policy.spec.ts` (7 حالات حدّية).

### إصلاحين لبَقّتين في شغل السيشن دي نفسها

1. **`8e8185a`** — الاسترداد الجزئي ماكانش واصل لمسار المحفظة ولا لحالة الدفع: عميل بيترد له في
   المحفظة كان هياخد **المبلغ كامل** بينما مسار البوابة بيرجّع الجزئي، و`paymentStatus` كان
   بيتعلّم `refunded` على استرداد جزئي (كذب على أي تقرير مالي).
2. **`f8e1336`** — **الجرس وقّع لوحة الإدارة كلها**. الـ`ResponseInterceptor` العام بيفرد
   `{items, meta}` لـ`data: items`، يعني `apiFetch` بيرجّع **المصفوفة نفسها**. استخدمت
   `authedFetch` بدل `authedFetchPaginated` فـ`list.items` طلعت `undefined`.
   **الـtypecheck عدّى** لأن النوع كان مكتوب باليد على النداء.
   **الدرس**: `next build` **مش** بديل عن فتح الصفحة فعلاً.

### الفحوصات وقت التسليم

| | |
|---|---|
| `npx jest` (apps/api) | **266 suite / 1569 اختبار — كلهم عدّوا** |
| `npx tsc --noEmit` + `npx nest build` | نضاف |
| `apps/admin`: tsc + eslint + `next build` | نضاف |
| `git diff --check` | نضيف |

---

## ب) ⚠️ الدرس المكلف — اقراه قبل ما تكتب سطر

في السيشن دي بنيت بندي **7 و8 كاملين** (طابور التقييم + القرارات الأربعة) وبعدين اكتشفت إن
سيشن تانية عملتهم وخدوا merge على main في `ccef526` — و`migration 0251` بتاعتي اتعارضت مع
`0251_dynamic_estimated_range.sql` بتاعتهم.

**رميت شغلي كله** بدل ما أدمج نسخة تانية (قاعدة العقد: «ممنوع إنشاء مسار جديد يكرر مسارًا
موجودًا»)، ورجّعت الفرع على `origin/main` ونضّفت الـDB المحلية.

**عشان مايحصلش تاني**: قبل أي بند، اعمل `git fetch origin main` واقرا `git log origin/main`
و`docs/08` آخر قسم. البنود اللي على main دلوقتي من سيشن تانية: **7، 8، 9، 11، 14، وجزء من 10**.

---

## ج) اللي فاضل — بالتفصيل

### 🔴 بند 13 — إخفاء تفكيك الطوارئ عن العميل (فجوة مؤكّدة، أصغر شغل وأوضحه)

**ابدأ بيه.** `customer-web` ✅ متعمّل صح (شوف التعليق في `apps/customer-web/src/lib/orders.ts:45`
— «`emergency_surcharge_cents` موجود عشان الحسابات تتطابق لكن **مايتعرضش كبند منفصل للعميل**»).

**Flutter ❌ لسه بيعرضه**:
```
apps/customer-app/lib/features/orders/create_order_screen.dart:956-961
  if (preview.emergencySurchargeCents > 0)
    _buildPriceLine('رسوم الطوارئ', '+${_formatEgp(...)}', color: Colors.orange)
```
**المطلوب**: شيل السطر ده. الحقل يفضل في الـmodel (`models.dart:190`) عشان الحسابات تتطابق —
العرض بس هو اللي يتشال، بالظبط زي customer-web.
**انتبه**: `emergencySlaMinutes` تحته مباشرة (سطر 962) **مالوش علاقة** — ده وقت الوصول المتوقع،
معلومة مفيدة للعميل ومش تفكيك فلوس. سيبه.
**التحقق**: `export PATH="$PATH:/opt/flutter/bin"` ثم `flutter analyze` + `flutter test`
(83 اختبار في customer-app).

### 🟠 بند 10 — النطاق التقديري: الجزء الناقص هو الـUI في customer-web

اللي **اتعمل خلاص** على main: الحساب الديناميكي (`b2b003c`)، تشخيص الفني + Quote Revision
(`0b07bc4`)، ومراجعة الإدارة عند تجاوز النطاق (`ccef526` + ADR-0067/0068 بتوعي).

**اللي محتاج تحقق**: Flutter بيعرض النطاق فعلاً
(`create_order_screen.dart:948-952` — «نطاق تقديري: X – Y»). لكن **customer-web** عنده الحقول في
الأنواع (`src/lib/orders.ts:51,65` — `min_price_cents`, `display_price_min_cents`) و**مش واضح إنها
بتترسم**. افحص `apps/customer-web/src/app/services/[id]/page.tsx` — لو مش بتتعرض، ده الناقص.
اعرضها بنفس صياغة Flutter عشان التطبيقين يتطابقوا (قاعدة العقد: Web/Flutter parity).

### 🟠 بند 18 — اختبارات E2E المسمّاة بالاسم

الـregression الكامل بيعدّي (266/1569)، بس المالك طلب **سيناريوهات مسمّاة**:
`fixed`، `remote`، `onsite`، `range`، `above-range`، `fee credit`، `double approval`،
`candidate lost`، `price lock`، وWeb/Flutter parity.

**اللي مغطّى فعلاً دلوقتي** (متفرّق، مش في مصفوفة واحدة):
- `price lock` + `candidate lost` → `provider-lock-no-silent-replacement.spec.ts` (5/5)
- `above-range` + `double approval` → `assessment-triage.spec.ts`
- `onsite`/`remote` → `inspection-then-quote.spec.ts`
- `fee credit` → منطق `assessmentCreditFor()` في `inspection-quote.service.ts`

**الناقص**: `fixed` و`range` كسيناريوهين صريحين، وملف واحد بيمشي المصفوفة كلها بالترتيب.
اعملها كـspec واحد جديد اسمه واضح، **ومتكرّرش** اللي مغطّى فوق — نادي نفس الخدمات.

### 🟡 بند 12 — كروت المرشحين: خلصت، محتاجة تحقق بس

customer-web: `services/[id]/page.tsx:1288-1325` بيعرض الاسم، المستوى، بادج التوثيق، التقييم،
المسافة، الالتزام بالمواعيد، عدم التوافر + أقرب يوم، و`final_price_cents`.
Flutter: `technician_marketplace_screen.dart:386-388` بيعرض السعر لكل فني.

**اللي محتاج تحقق**: إن الاختيار **اليدوي** بيتأكد بتذكرة `match-preview` فعلاً (مش بس بيبعت
`requested_technician_id`) — `create_order_screen.dart:826` بيمرّر `matchPreviewId`، اتأكد إنه
مش `null` في المسار اليدوي. لو `null`، ده يفتح باب الاستبدال الصامت من ناحية الواجهة.

### 🟢 بند 19 — Railway: الكود خلص، الباقي عندك مش في الريبو

الـ5 متغيرات مفروضة في `apps/api/src/config/env.validation.ts`، و`start:railway` بيشغّل
الـmigrations قبل الإقلاع (`apps/api/package.json:11`). التشخيص الكامل في `docs/23` §5.
**الفعل الوحيد الباقي**: ضبط المتغيرات في Railway → Service → Variables. مش حاجة تتعمل من الكود.

---

## د) حاجات مستنية المالك (مش شغل ناقص)

1. **§116-C** — طلب `ORD-2026-000273` ظهر للعميل ومش ظاهر للأدمن. الباك-إند **مبرّأ باختبار
   حي** (`admin-orders-visibility.spec.ts` بيثبت إن القايمة بترجّع كل الحالات). محتاجين منه:
   هل الطلب ده موجود في قاعدة بيانات الأدمن؟ وهل التطبيق واللوحة كانوا على نفس `API_BASE_URL`؟
   من غير ده الآلية الدقيقة مش مثبتة.
2. **افتراضي ADR-0069** (فوق) — تغيير فلوس عملاء، قراره.
3. **أرقام الإنتاجية** (حجر/سباكة/كهرباء/جبس) — فجوة مفتوحة من `docs/07`، الحقل بيفضل NULL
   لحد ما الأدمن يدخله. **ماتخترعش أرقام.**

---

## هـ) قواعد التشغيل المحلي (توفّرلك وقت)

```bash
service postgresql start && redis-server --daemonize yes    # Docker مش متاح
DATABASE_URL=postgres://baytak:baytak@localhost:5432/baytak node infra/migrations/migrate.js
cd apps/api && npx tsc --noEmit && npx nest build && npx jest -w=1
export PATH="$PATH:/opt/flutter/bin"                        # Flutter 3.44.9 / Dart 3.12.2
```

- **`npx jest` من `apps/api` مش من الروت** — من الروت بيفشل بـ`Cannot use import statement`.
- `-w=1` مهم: التشغيل المتوازي بيوقع الحاوية بـOOM (exit 137) وبيقتل Postgres/Redis معاه.
- لو ظهر `ECONNREFUSED 5432/6379` وسط اختبار → الخدمة وقعت، شغّلها تاني وأعد.
- **أعد بناء `packages/shared-types`** بعد أي تعديل فيها (`npm run build`) — الأخطاء بتبان
  كـ«الحقل مش موجود» في `apps/admin` وهي مجرد `dist` قديم.

## و) آخر تحذير

المالك طلب صراحة: **ماترفعش ولا تعدّل** `package-lock.json` ولا ملفات Flutter/iOS/SwiftPM
الظاهرة كـdirty/untracked. اعمل `git status` قبل أي `git add`، و**متعملش `git add -A`**.
