# ADR-0106 — الوضع قرار سيرفر، وترتيب خطوات الويب ترتيب اعتماديات

- **الحالة**: مقبول ومنفّذ
- **التاريخ**: 2026-09-17
- **السياق**: طلب مالك، `docs/08 §160`

## المشكلة ١ — محرك وضع حجز مصغّر في الويب بينحرف عن السيرفر

`apps/customer-web/src/app/services/[id]/page.tsx` كان بيحسب:

```ts
const bookingMode: BookingMode = isSameDayBooking ? 'emergency' : 'individual';
```

ويبعته في `booking_mode` للمعاينة والإنشاء وقايمة المنفّذين. وفي المقابل
`OrderCreationService` **بيتجاهل `dto.booking_mode` تمامًا** ويشتقّ الوضع بنفسه (ADR-0048):
نفس اليوم ⇒ `emergency`، وغير كده `team`/`individual` من `requiredTechnicians`/
`requiredAssistants` + قدرات الخدمة.

### الأثر الحقيقي — مش تنظيف نظري

النسخة المحلية **مستحيل تطلّع `team`**، بينما `apps/customer-app` بيبعته لخدمة
`allows_team && !allows_individual`. و`GET /services/:id/technicians` كان بيستخدم
`booking_mode === 'team'` في **فضاء الأهلية** (`isTeamBooking` بيفلتر على
`technician_level_config.eligible_for_team_booking` — `professional` فأعلى بس).

يعني **نفس الخدمة ونفس العنوان ونفس التاريخ كانوا بيرجّعوا قايمة منفّذين مختلفة حسب الواجهة**.
اتقاس فعليًا قبل الإصلاح (`scripts/verify-web-mobile-booking-parity.js`):

```
ويب(individual) = [فني مؤهّل, فني غير مؤهّل]   ← فضاءين مختلفين
موبايل(team)    = [فني مؤهّل]
```

ده مش فرق توافر بين لحظتين — ده **فرق قاعدة عمل بين واجهتين**.

## القرار ١ — الاشتقاق بيحصل على السيرفر، والعميل يبعت حقائق

`listTechniciansForService` بقى بيشتقّ بنفسه:

```ts
const isEmergency = isSameDayUrgent({ scheduledAt }) || query.booking_mode === 'emergency';
const derivedMode = resolveBookingMode({
  urgent: isEmergency,
  requiredTechnicians: neutralEstimate?.required_technicians ?? null,
  requiredAssistants: neutralEstimate?.required_assistants ?? null,
  service,
});
```

**نفس** `resolveBookingMode()` اللي `POST /orders` بيستخدمها بالحرف، وبنفس مدخلات التسعير
المحايد اللي الـendpoint كان بيحسبها أصلاً — فمفيش حساب جديد ولا خوارزمية مكررة. الواجهتين
بيوصلوا لنفس الفضاء **بالبناء** مش بالاتفاق.

و`booking_mode` لسه **مقبول كحقيقة استعجال بس** (نسخ تطبيق منشورة بتبعته للطوارئ بلا
`scheduled_at`)، ومابقاش له أي دخل في قرار الفريق.

وفي الويب: `bookingMode` و`type BookingMode` و`availableBookingModes()` اتشالوا بالكامل،
والصفحة بقت بتتعامل بحقيقة واحدة (`isSameDayBooking`). و`booking_mode` اتشال من body
المعاينة والإنشاء (السيرفر بيتجاهله أصلاً).

## المشكلة ٢ — ترتيب الخطوات مكانش ترتيب الاعتماديات

الصفحة كانت: `١. تفاصيل الشغل والموعد → ٢. العنوان والفني → ٣. التأكيد`.

بينما اقتراح الأيام والساعات (`fetchSuggestedDays`/`fetchSuggestedTimes`) و
`serviceAvailableForAddress` **كلهم محتاجين `selectedAddressId`**. فالعميل الجديد كان بيشوف
منتقي تاريخ **بلا أي اقتراح** — الـeffects بتخرج بدري على `!selectedAddressId` — وبعدها يدخل
العنوان اللي المفروض الاقتراح اتبنى عليه.

وكان فيه drift في الـgating كمان: `stepOneComplete` مكانتش بتشترط العنوان خالص، و
`stepTwoComplete` كانت بتشترط `providerLocked` رغم إن التعليق اللي فوقها بيوصف اختيار المنفّذ
كخطوة تالتة.

## القرار ٢ — نفس ترتيب اعتماديات التطبيق، بتلات خطوات

| الخطوة | المحتوى | شرط الإكمال |
|---|---|---|
| ١ | العنوان **ثم** تفاصيل الشغل | عنوان مختار + الخدمة متاحة فيه + الحقول الإجبارية |
| ٢ | الموعد **ثم** المنفّذ | الميعاد (والساعة لو مطلوبة) + المنفّذ متقفل |
| ٣ | تكرار/ملخص/دفع/سياسات | `canSubmit` |

`apps/customer-app` بيمشي بنفس الترتيب
(`service → address → job details → duration → date/time → provider → confirmation`).
الويب مش مطلوب يبقى نفس عدد الشاشات — المطلوب **نفس ترتيب الاعتماديات**.

## القرار ٣ — الاختيار التلقائي للعنوان الافتراضي بس

`const def = list.find((a) => a.is_default) ?? list[0]` — الاحتياطي `?? list[0]` كان بيختار
عنوان **عشوائي** لعميل عنده أكتر من عنوان ومحدد فيهم افتراضي، والاقتراحات وفحص التوافر
بيتحسبوا عليه. نفس الاحتياطي اتشال من `apps/customer-app` في ADR-0100 لنفس السبب، وفضل هنا.
دلوقتي العنوان الافتراضي **الحقيقي** بس هو اللي بيتختار تلقائي (ده اختيار العميل المسجّل، مش
تخمين).

## التحقق

- `scripts/verify-web-mobile-booking-parity.js` — ٧ تحقّقات حيّة، منها ضوابط نفي:
  الفلتر **لسه شغّال** (الفني غير المؤهّل مستبعد من الاتنين، مش إننا فتحنا الفضاء)، وخدمة
  فردية بتفتح الفضاء للاتنين حتى لو عميل قديم بعت `team`. والطلب الفعلي بيتسجّل بنفس الوضع
  المشتقّ مهما بعت العميل إيه: `ويب(بلا وضع)=team · موبايل(team)=team · ويب قديم(individual)=team`.
- `scripts/verify-web-flow-order.js` — متصفح حقيقي: الخطوة ١ بتطلب العنوان، «التالي» مقفول
  قبل اختيار عنوان، والخطوة ٢ بتطلب الميعاد **ومعاه نداء `booking-slots/days` فيه
  `address_id`** — الدليل إن الاعتمادية اتحققت.

## اللي فضل عن قصد (توافق)

| الحاجة | ليه فضلت |
|---|---|
| `booking_mode` في `ListTechniciansForServiceDto` | نسخ تطبيق **منشورة** بتبعته، وبعضها للطوارئ بلا `scheduled_at`. بقى مقروء كحقيقة استعجال بس، ومكتوب كده في الكود. |
| `booking_mode` في `CreateOrderBody`/`PreviewOrderBody` (اختياري) | نفس السبب. السيرفر بيتجاهله من ADR-0048، والويب مابقاش يبعته. |
| `allows_individual` / `allows_team` / `allows_emergency` في `ServiceDto` بالويب | الـAPI بيرجّعهم وأي قارئ ممكن يحتاجهم للعرض. **مفيش قرار تجاري في `customer-web` مبني عليهم**، ومكتوب في النوع إنهم مدخلات لقرار السيرفر. |
| الاشتقاق المحلي في `catalog_navigation.dart` | **للتنقّل بس** (أي شاشة تتفتح)، ومكتوب كده في الكود منها. مابقاش له أي أثر على فضاء الأهلية بعد الإصلاح ده. |
| `ServiceLevelPricing` / `service_level_pricing` | سجل تاريخي بعد migration 0316؛ مفيش مسار حساب يقراه (الـDI مكتوب `_legacyLevelPricing`). لازم يفضل لقراءة طلبات قديمة. |

## الحدود الصريحة

- الاشتقاق على `/technicians` بيعتمد على `neutralEstimate`، واللي بيرجع `null` لخدمة `formula`
  بلا `field_values` (العميل لسه ما ملاش الفورم). في الحالة دي `requiredTechnicians` بتبقى
  `null` فالوضع بيطلع `individual`/`team` حسب قدرات الخدمة بس — نفس ما `resolveBookingMode`
  بيعمله لأي مدخل ناقص، ومفيش تخمين إضافي.
- الويب لسه مابيمنعش حجز نفس اليوم لخدمة `allows_emergency = false` قبل ما يوصل للسيرفر؛
  السيرفر بيرفض برسالة واضحة والصفحة بتعرضها. مش انحدار (كان كده قبل كده)، بس فجوة موثّقة.
