# 12 — مرحلة تحسين UI/UX + تدقيق P0/P1/P2 شامل (2026-08-13)

**القاعدة الحاكمة**: نفس مبدأ `docs/08`/`docs/10`/`docs/11` — الملف ده نقطة تتبع حية، يتحدّث لحظيًا
وقت التنفيذ، مش بعده. اقرأه قبل أي تنفيذ من الأجزاء تحت.

## السياق

بعد ما `docs/11` (RBAC ديناميكي + ترشيح QR + KPI شهري + مسار وظيفي) خلص بالكامل واندمج في `main`
(commit `55a3f29`)، المالك بعت طلبين جداد في نفس الرسالة (2026-08-13):

1. **مرحلة تحسين UI/UX شاملة** — نظام تصميم موحّد عبر كل الواجهات (Customer/Technician/Domestic
   Worker/Admin)، **بدون أي ميزات عمل جديدة** في المرحلة دي.
2. **تقرير تدقيق شامل P0/P1/P2** — قايمة طويلة من المشاكل الحقيقية (أمان، مالية، معمارية، جودة)
   اتكشفت في مراجعة عميقة للكود الحالي، **بعضها P0 حرج** (تصعيد صلاحيات، OTP في اللوج، تحقق مبلغ
   الدفع، rotation غير ذرّي للـrefresh token).

**تعارض أولوية ظاهري محتاج قرار من المالك**: المرحلة الأولى بتقول صراحة "مفيش ميزات عمل جديدة"،
لكن التقرير التاني فيه بنود P0 أمنية/مالية حرجة (مش ميزات — إصلاحات بَقّات حقيقية). قبل أي تنفيذ،
لازم يتحدد: إصلاحات الـP0 الأمنية/المالية تتعمل الأول قبل مرحلة الـUI/UX، ولا بالتوازي، ولا
الأكونت التاني مخصص لمسار وأنا لمسار تاني (تجنّبًا للتكرار المذكور في تعليمات المالك نفسها:
"مش عايز أي اختلافات... كأنه كنتوا الاثنين واحد").

## الطلب الأول — مرحلة تحسين UI/UX (بالحرف تقريبًا، الإنجليزي الأصلي محفوظ في المحادثة)

- **لا تضيف ميزات عمل جديدة في المرحلة دي.** الهدف: Customer App وTechnician App وDomestic
  Worker experience وAdmin Panel تبقى حاسّة إنها منتج واحد حديث واحترافي وعالمي — بسيط بما يكفي
  إن أي مستخدم يفهمه فورًا، مع فضل كل التفاصيل التشغيلية المهمة سهلة الوصول.
- **متطلب**: مايتلمسش منطق العمل ولا تتبدّل تدفقات شغالة. كل تكامل باك-إند موجود لازم يتحافظ عليه.
- **أول خطوة مطلوبة صراحة**: إنشاء استراتيجية نظام تصميم مشترك للمنصة كلها، وبعدين تطبيقها بشكل
  منهجي.

### مبادئ التصميم المطلوبة
حديث، احترافي، minimal، خفيف، سريع، سهل القراءة جدًا، عربي أولاً/متوافق RTL، accessible، حِمل
معرفي منخفض، بدون فوضى بصرية، بدون حركات (animations) غير ضرورية، بدون gimmicks، بدون enums خام
من الباك-إند تظهر للمستخدم، تسلسل هرمي واضح، فعل أساسي واحد واضح لكل شاشة قدر الإمكان، المعلومة
المهمة تظهر فورًا، التفاصيل الثانوية/المتقدمة تتكشف تدريجيًا (progressive disclosure).

### عناصر نظام تصميم موحّد مطلوبة
تسلسل هرمي للخطوط (typography)، نظام مسافات (spacing)، أنماط الكروت، الأزرار، الحقول، شرائح
الحالة (status chips)، الـdialogs، الـbottom sheets، حالات التحميل، حالات الفراغ (empty states)،
حالات الخطأ/إعادة المحاولة، الـskeletons، الأيقونات، أنماط التنقل، أنماط التأكيد، أنماط الإجراءات
الهدّامة (destructive actions).

### Customer App
تبسيط رحلة الحجز لتكون مفهومة فورًا:
`الخدمة → تفاصيل الشغل → السعر المحسوب → مقارنة الفنيين → الجدولة → التأكيد → حالة الطلب اللحظية
→ الدفع → التقييم/الضمان`.
تركيز على: كروت خدمة واضحة، تنقل فئات بسيط، مقارنة فنيين سهلة (ترتيب/تقييم/مسافة/سعر نهائي
ظاهرين)، تفصيل سعر نظيف، اختيار موعد بسيط، CTA تأكيد واضح، جدول زمني بصري للطلب، وصول سهل
للشات/التتبع، إجراء ضمان/إعادة زيارة بسيط، حساب/سجل غير مزدحم، إشعارات وولاء/ترشيح بدون ازدحام
تجربة الحجز الأساسية.

### Technician App
التصميم حول "إيه اللي محتاج أعمله دلوقتي؟" — الشاشة الرئيسية/الطلب الحالي تدّي أولوية لـ: شغل
النهارده، الطلب الحالي، العنوان، الموعد المجدول، ملخص العميل/الخدمة، معلومات الفريق/المساعد
المطلوبة، فعل أساسي واحد حسب حالة الطلب (مثال: قبول → طالع → وصلت → بدء الشغل → إكمال). الأرباح،
الجدول، الـKPI، البروفايل، الشهادات، الشركة/الفريق، المساعد، الترشيحات، الإشعارات — تفضل متاحة
بس ثانوية للتنفيذ. الطلبات الطارئة تتميّز بصريًا بدون ما تزوّد الضوضاء.

### Admin Panel
تحويلها لـconsole تشغيلي احترافي مش مجرد صفحات CRUD متجمّعة — تحسين: بنية معلومات الـsidebar،
الداشبورد، الجداول، الفلاتر، البحث، إجراءات جماعية حيث مناسب، صفحات التفاصيل، ظهور الـaudit،
تأكيد الإجراءات الهدّامة. بنود تحتاج تبقى واضحة فورًا: طلبات متأخرة، إلغاءات، تحقق معلّق، تصعيد
مساعد، شكاوى/دعم، مشاكل دفع/استرداد، موافقات KPI، تغييرات دور/أمان.

### Pricing Engine
تحويله لميزة أدمن من الدرجة الأولى — سهل الاكتشاف من التنقل الرئيسي/إدارة الخدمات/صفحات تفاصيل
الخدمة، مش مخبّى في آخر صفحة طويلة. تجربة إدارة تسعير نظيفة: نظرة عامة، نموذج التسعير، الحقول،
الثوابت/القوائم، المعادلات، تسعير حسب مستوى الفني، رسوم الطوارئ، معاينة/اختبار، تحقق، تتبّع
تاريخي حيث متاح — بدون تعقيد موجّه للمطورين بلا داعي.

### Domestic Worker
اتساق بصري مع Customer/Technician الأساسيين مع الحفاظ على نموذج الحجز المنفصل.

### متطلبات جودة
مفيش شاشة "خلصت" لمجرد إنها "شكلها أحسن". لكل شاشة اتلمست، لازم يتأكد: كل الإجراءات الموجودة
لسه شغالة، التنقل شغال، حالات تحميل/خطأ/فراغ موجودة، RTL عربي صح، النصوص الطويلة شغالة، تخطيطات
الشاشات الكبيرة/الصغيرة آمنة، مفيش بيانات بتختفي، مفيش تكامل API بيتكسر، تحديثات الحالة بتنعكس
صح، accessibility/تباين أساسي مقبول. **مايتغيّرش حساب الباك-إند في المرحلة دي إلا لو مراجعة UI
كشفت بَقّة حقيقية.**

### خطة العمل المطلوبة (بالترتيب)
1. تدقيق كل الشاشات الحالية أولاً.
2. إنشاء نظام التصميم المشترك.
3. تحسين التنقل/بنية المعلومات.
4. Customer App.
5. Technician App.
6. واجهات Domestic Worker.
7. Admin Panel.
8. تجربة Pricing Engine.
9. مرور اتساق شامل عبر المنصات.
10. مراجعة بصرية E2E حقيقية على جهاز/متصفح.

لازم تتبّع حي بحالة كل شاشة: `untouched` / `redesigned` / `verified` / `blocked`. **مايتوقفش بعد
شاشات عرض قليلة — الهدف اتساق عبر المنتج الحالي كله.**

## الطلب الثاني — تقرير تدقيق P0/P1/P2 (بالحرف، ملخّص الفئات)

المالك بعت تقرير مراجعة عميقة (يبدو إنه من مراجعة مستقلة/أداة تدقيق) على حالة الكود الحالية.
**كل بند اتسجّل هنا بالحرف تقريبًا كنص خام — التحقق من صحة كل بند وتحديد الأولوية الفعلية لسه
مطلوب كخطوة تالية، مش مفروض إن كل بند فيه صح 100% لمجرد إنه اتسجّل هنا.**

### P0 — أمان/مالية حرجة

1. **Dynamic RBAC — Privilege Escalation حقيقي محتمل**: `setRolePermissions()` بيمنع الأدمن من
   منح صلاحية هو نفسه ماعندوش، لكن `assignRole()` مش بتعمل نفس الفحص — أدمن عنده `roles.manage`
   يقدر يعيّن Role أقوى منه لمستخدم آخر. مفيش منع صريح لتعيين `super_admin`. `cloneRole()` بتنسخ
   صلاحيات الدور المصدر كاملة بدون فحص إن الفاعل يملكها. **مطلوب**: منع assign/clone لأي Role
   فيه صلاحية الفاعل مايملكهاش إلا `super_admin`/`roles.grant_unrestricted`، منع تعيين/سحب
   `super_admin` إلا بواسطة Super Admin، regression tests لمحاولات التصعيد.
2. **Dynamic RBAC مش مطبّق على كل Admin endpoints**: `AdminReportsController`،
   `AdminRecurringOrdersController` وغيرهم عليهم `@Roles(UserType.ADMIN)` بس — أي حساب Admin
   (حتى Support Agent) يقدر يشوف Dashboard/Revenue/Technician Reports/Zone Reports. مطلوب
   صلاحيات قراءة مخصوصة (`reports.view`, `recurring_orders.view`, إلخ) ومراجعة Controller-by-
   Controller.
3. **واجهة الأدمن نفسها مايحترمش الصلاحيات**: `apps/admin/src/components/app-shell.tsx` فيه
   ~27 عنصر Menu ثابتين يظهروا لأي Admin بغض النظر عن صلاحياته الفعلية. مطلوب endpoint
   `/admin/me/permissions` والـSidebar/الأزرار تتفلتر بناءً عليه (backend يفضل مصدر الحقيقة).
4. **أكواد OTP بتتكتب في اللوج دايمًا**: `console.log([OTP] phone → code)` بتعليق "متعمدة
   دايمًا" — خطر حقيقي في Production. مطلوب: الكود يظهر بس في development/test، Production
   يسجّل masked phone + request ID بدون الكود.
5. **Refresh-token rotation مش atomic**: `findOne()` → فحص `isRevoked` → تغيير → إصدار جديد،
   بدون transaction/row lock. طلبين متزامنين بنفس Token ممكن الاتنين يطلعوا Token pairs جديدة.
   مطلوب: `SELECT FOR UPDATE` جوّه Transaction + concurrency test.
6. **حظر المستخدم لا يبطل Access Token فورًا**: `JwtStrategy.validate()` بيرجع الـpayload بس
   بدون مراجعة `is_blocked`/`is_active`/`deleted_at`. مطلوب: فحص active-user (DB/cache) في الـguard.
7. **Webhook الدفع لا يتحقق من مبلغ الدفع مقابل المتوقع**: `finalizeGatewayWebhook()` مابياخدش
   المبلغ من الـWebhook أصلاً، فمفيش مقارنة مع `payment.amountCents`. مطلوب: exact amount
   invariant قبل settlement + currency/reference/provider checks.
8. **Webhook بيرجع HTTP 200 حتى مع Crash داخلي**: كل Error بيرجع `{received:true}` — مناسب
   لـinvalid signature بس مش لأخطاء transient (DB/Redis/network). مطلوب: persist raw webhook
   durably + queue/retry، أو 5xx لأخطاء داخلية transient.
9. **الطلبات المجدولة البعيدة لسه بتتوزّع فورًا**: `OrderDispatchListener` بيوزّع أي Order فور
   الإنشاء حتى لو موعده بعد أسبوعين — `ADR-0009` تصميم فقط، مش منفّذ. مطلوب: delayed dispatch
   configurable + time-window-based busy semantics.
10. **رحلة اختيار الفني مرتّبة غلط لخدمات Formula pricing**: العميل بيختار الفني قبل ما يدخل
    تفاصيل الـformula (مساحة/عدد/نوع شغل)، فخدمات Formula بتظهر فنيين من غير `final_price_cents`.
    الـBackend جاهز (`GET /services/:id/technicians` بيدعم `field_values`) بس الـFlutter client
    مابيبعتوش. مطلوب: تغيير الـflow لخدمات Formula لـ`Service → Job/Pricing Details →
    Technician list + final price → Schedule → Confirmation`.

### ملحوظة صريحة من المالك — حاجات كانت بَقّات قديمة اتصلحت، متتصلحش تاني

Formula multiplier بيطبّق فعليًا، `previewPrice()` بيبعت `requested_technician_id`/
`schedule_slot_id`، قايمة الخدمات بتعرض "يُحسب حسب التفاصيل" بدل 0 جنيه، Admin عنده منيو مستقل
لمحرك التسعير، الـFormula Builder عنده Visual Tree Editor. **موديل جديد ميعيدش بناء البنود دي.**

### P1 — مهم لكن مش حرج فورًا

- Live Tracking مش Live فعلًا (GPS يدوي بضغطة، مفيش `getPositionStream()`/periodic updates).
- Push Notifications ناقصة lifecycle (`onTokenRefresh`, `onMessageOpenedApp`, `getInitialMessage`,
  deep-link router مركزي).
- Notification Preferences للفني/Domestic Worker مش موجودة (للعميل بس).
- 4 أنواع Dynamic Pricing fields مش مكتملة End-to-End (`location`, `image_upload`,
  `video_upload`, `voice_note`) — الأدمن بيمنعهم Required بس مش متنفذين في Customer App.
- Registration provisioning مش transactional/idempotent (`USER_REGISTERED_EVENT` fire-and-forget
  ممكن يسيب User بلا Profile/Wallet لو listener فشل).
- تخزين الملفات Production محتاج S3 إلزامي + signed URLs قصيرة المدة بدل تخزين presigned URL
  نفسه في DB لمدة تصل لأسبوع؛ `local` storage بيتقدّم بلا Auth حاليًا.
- Fawry integration لسه مش متحقق ضد sandbox حقيقي (signature field order "أفضل فهم" مش مؤكد).
- Refund للبطاقة/Fawry بيعوّض داخليًا (Wallet) مش reversal حقيقي على payment rail الأصلي.
- Domestic Worker vertical أقل نضجًا من الفني (Rating flow مستقل مش موجود، أرباح/محفظة/تفضيلات
  إشعار ناقصة).
- Test coverage قليلة (527 ملف TS، 4 ملفات Jest spec بس) — الـRBAC/webhook/refunds/assistant
  concurrency/recurring renewal/wallet flows محتاجين regression tests ثابتة.
- CI موجود بس محتاج يتوسع (`flutter test`، integration tests، Branch Protection على main).
- Android Release Signing بيرجع Debug signing بصمت لو `key.properties` مفقود — محتاج fail hard
  في build إنتاجي.
- IP/rate limiting خلف Proxy محتاج `trust proxy` صريح + اختبار `X-Forwarded-For`.
- API clients (Admin/Flutter) مش resilient لأخطاء 502/HTML/empty body — `res.json()`/
  `jsonDecode()` مباشرة بلا content-type-safe parsing/timeout/retry/correlation ID.

### P1/P2 — UI/Information Architecture (متداخل مع طلب الـUI/UX فوق)

- Admin Sidebar (~27 عنصر flat، بلا grouping/collapse/permission-aware filtering) — يحتاج تقسيم
  Operations/Marketplace/Workforce/Finance/CRM/Configuration/Security.
- Technician App الصفحة الرئيسية فيها IconButtons كتير في AppBar (زحمة على Mobile) — يحتاج
  Bottom navigation/Drawer + مركز الشاشة يبقى "المهمة الحالية".

### P2 — جودة/صيانة

- شاشات Flutter ضخمة (`create_order_screen.dart` ~927 سطر، `order_execution_screen.dart` ~793،
  `order_detail_screen.dart` ~721) — تحتاج فصل state/controllers/widgets قبل أي redesign كبير.
- Localization/RTL مش معماري بالكامل (مفيش `flutter_localizations`/`localizationsDelegates`
  واضح، الشاشات بتعتمد على `Directionality` يدويًا).
- Loyalty: `redeem()` بتخصم نقاط بس مفيش قاعدة تحويل نقاط→جنيه/خصم طلب كاملة محدّدة.
- Favorites: فنيين بس (`customer_favorite_technicians`) — لو المطلوب كان يشمل الخدمات كمان،
  مش مبني.

### بنود اتقفلت فعلاً (موثّقة صراحة كمرجعية، متتلمسش)

Delay compensation (ملغي عمدًا)، Academy Base (منخفض أولوية عمدًا)، Price Engine Backend/Formula
multiplier/Preview consistency/Admin Pricing page/Visual Formula Editor/Service forms، real GPS
acquisition، quote reconnect، media recovery، Assistant schedule conflict، manual assistant
assignment، Productivity learning pipeline، Favorites technician، Google Review prompt،
Notification Preferences (عميل)، CI الأساسي، security headers/CORS/JWT-secret validation، wallet
atomicity الأساسي، soft-delete matching bugs، BullMQ watchdog، Warranty/Revisit، Ratings،
Recurring، Buildings، Domestic Worker base flows.

## القرار — المالك حسم الأولوية (2026-08-13)

**P0 الأمان/المالية الأول، بالكامل، قبل أي حاجة من مرحلة UI/UX.** الترتيب المعتمد دلوقتي:

1. إصلاح كل بند P0 في القايمة فوق (10 بنود) — كل بند بمنطقه الفعلي متحقق منه أولاً (مش افتراض
   إن التقرير صح 100%)، إصلاح حقيقي، اختبار سلبي يثبت الإصلاح، توثيق في README الموديول.
2. بعد ما الـP0 كلها تتقفل وتتأكد حياً — نبدأ مرحلة UI/UX من نقطة 1 في خطة العمل فوق (تدقيق كل
   الشاشات الحالية).
3. بنود P1/P2 (خارج نطاق P0) تتقيّم بعد كده حسب الوقت المتاح — مش أولوية فورية.

**تتبّع تنفيذ P0 (يتحدّث فور إغلاق كل بند)**:

| # | البند | الحالة |
|---|---|---|
| 1 | RBAC — `assignRole()`/`cloneRole()` privilege escalation | ✅ خلص |
| 2 | Dynamic RBAC مش مطبّق على كل Admin endpoints (Reports/RecurringOrders...) | ✅ خلص |
| 3 | Admin UI مايحترمش الصلاحيات (Sidebar ثابت) | ✅ خلص |
| 4 | OTP بيتكتب في اللوج دايمًا | ✅ خلص |
| 5 | Refresh-token rotation مش atomic | ✅ خلص |
| 6 | حظر المستخدم لا يبطل Access Token فورًا | ✅ خلص |
| 7 | Webhook الدفع مايتحققش من المبلغ | ✅ خلص |
| 8 | Webhook بيرجع 200 حتى مع Crash داخلي | ✅ خلص (فجوة صغيرة متبقية موثّقة — راجع payments/README.md) |
| 9 | الطلبات المجدولة البعيدة بتتوزّع فورًا (ADR-0009 بند 1-2) | ✅ خلص (بند 3 من نفس الـADR لسه مؤجّل عمدًا — قرار مخاطرة موثّق) |
| 10 | رحلة اختيار الفني مرتّبة غلط لخدمات Formula | ✅ خلص (مبني ومراجع يدويًا بالكامل — Flutter SDK مش متاح في بيئة السيشن دي لاختبار حي آلي، موثّق كفجوة تحقق صريحة) |

### P0-2 — تفاصيل التنفيذ

الفحص الكامل (agent مخصص جرد كل الـcontrollers تحت `/admin`) أكّد إن الفجوة الحقيقية كانت
مقصورة على **اتنين بالظبط**: `AdminReportsController` (`dashboard/stats`, `reports/revenue`,
`reports/technicians`, `reports/zones`) و`AdminRecurringOrdersController` — الاتنين كان محميين
بـ`@Roles(ADMIN)` بس من غير أي `@RequirePermission`، ومفيش `reports.view`/`recurring_orders.view`
في كتالوج الصلاحيات أصلاً. الإصلاح: migration `0085` (صلاحيتين جداد، ممنوحتين لـ`ops_manager`/
`finance` — `super_admin` بياخدها أوتوماتيك) + `@RequirePermission` على مستوى الكنترولر في
الاتنين. اختبار regression حي في `apps/api/src/modules/admin/reports-and-recurring-orders-permission.spec.ts`.

**كنترولرز تانية اتفحصت وطلع إن الفتح لأي أدمن قرار متعمّد موثّق (مش نفس الفجوة، متتلمسش تاني)**:
`AdminWalletController` (تعليق: "طلب صريح: الأدمن عنده access إنه يخش يشوف المحفظة عشان يشوف هل
في مشكلة أو لأ")، `AdminTechnicianCompaniesController` (read-only بالكامل عمدًا)،
`AdminTechnicianReferralsController` (مفيش فعل مُغيّر يحتاج صلاحية دقيقة)، وGET endpoints في
`AdminPaymentsController` (payouts list/order-items — الـmutations زي approve/reject/complete
محمية فعلاً بـ`payouts.approve`/`refunds.issue`).

### P0-3 — تفاصيل التنفيذ

`GET /admin/me/permissions` جديد (`AdminRolesController`) بيرجّع صلاحيات الأدمن الحالي الفعلية
(`super_admin` بياخد الكتالوج كامل عن طريق الـbypass زي أي مكان تاني). `apps/admin`:
`useAuth()`/`AuthProvider` بقت بتحمّل الصلاحيات دي مع بيانات المستخدم (`permissions: Set<string>`,
`hasPermission()`)، و`app-shell.tsx`'s `NAV_ITEMS` بقى كل عنصر ممكن ياخد `permission` اختياري —
fail-closed (لو الصلاحيات لسه بتتحمّل، العنصر المقيّد يفضل مخفي مؤقتًا، مش ظاهر بالغلط).

**النطاق مقصور على**: (أ) الصفحات اللي فعلاً بترفض من الباك-إند بلا الصلاحية (نظرة عامة/التقارير
`reports.view`، الطلبات المتكررة `recurring_orders.view`، سجل النشاط `audit.view` — بدونها
الصفحة كانت هتبان فاضية/بترمي خطأ)، (ب) الأمثلة اللي المالك سمّاها صراحة في نص المراجعة الأمنية
(محرك التسعير `catalog.manage`، الأدوار والصلاحيات `roles.manage`، الإعدادات `settings.manage`).
باقي الصفحات (~23 عنصر) الـGET بتاعها مفتوح لأي أدمن عمدًا (قرارات موثّقة في تعليقات
الكنترولرز)، فمتفلترتش — توسيع الإخفاء لصفحات إدارة تانية (الكتالوج، المدن، إلخ) حسب الصلة
التشغيلية لا الحجب الفعلي، نطاق مرحلة تحسين UI/UX القادمة، مش P0.

**اتأكد حي بالكامل عبر متصفح حقيقي (Playwright)**: حساب `super_admin` حقيقي شاف كل الـ30 عنصر.
حساب `support_agent` حقيقي (صلاحياته الفعليتين بس `complaints.resolve`/`support_tickets.manage`)
شاف بالظبط الـ23 عنصر المفتوحين وماشافش الـ7 المقيّدين (نظرة عامة، محرك التسعير، الأدوار
والصلاحيات، التقارير، الطلبات المتكررة، الإعدادات، سجل النشاط) — تطابق تام مع المتوقع.

### P0-9 — تفاصيل التنفيذ

ADR-0009 (مكتوب بالكامل في `docs/adr/0009-deferred-dispatch-for-scheduled-orders.md`) بيقسّم
المشكلة لبندين مترابطين معماريًا بس مختلفين تمامًا في المخاطرة: (1-2) تأجيل *بث* المطابقة نفسه
لطلب مجدول بعيد، و(3) إعادة تعريف "الفني مشغول" بنافذة زمنية بدل استبعاد كامل — بند 3 بيلمس
`findEligibleTechnicians()` المستخدم في **كل** جولة مطابقة بالنظام (فوري أو مجدول)، مخاطرة أعلى
بكتير من بند 1-2. **القرار المنفّذ هنا: بند 1-2 بس**، بند 3 فضل مؤجّل عمدًا (نفس تقييم المخاطرة
في الـADR لسه صحيح، مفيش سبب جديد يغيّره).

**التنفيذ**: إعداد جديد `matching.deferred_dispatch_lead_hours` (افتراضي 4 ساعات، migration
`0086`). القرار "بعيد ولا لأ" بيتحسب مرة واحدة جوّه `OrdersService.create()` (دالة نقية
`computeDispatchDeferredUntil()` — `apps/api/src/modules/orders/deferred-dispatch.util.ts`)، مش
وقت معالجة الحدث لاحقًا، عشان `dto.schedule_slot_id` متاح مباشرة هناك ومش قابل للاشتقاق الموثوق
لاحقًا من صف الطلب (`requestedTechnicianId` بيتحط من مصادر تانية غير سلوت الجدولة الصريح كمان).
القرار بيتحمل جوّه حقل جديد اختياري `OrderCreatedEvent.dispatchDeferredUntil` — الحدث نفسه لسه
بيتصدّر فورًا دايمًا (`emitAsync`, بلا شرط) عشان listeners تانية (إحصائيات العميل، إشعار "طلبك
اتسجّل"، توجيه الطوارئ) لازم تشتغل فورًا؛ `OrderDispatchListener` بس هو اللي بيقرر يجدول job
مؤجّل (طابور `matching-dispatch` جديد + `MatchingDeferredDispatchProcessor`، نفس نمط
`matching-rounds`/`MatchingRoundExpiryProcessor` بالحرف) بدل ما يبث فورًا.

**اختبار حي**: اختبار وحدة نقي كامل لـ`computeDispatchDeferredUntil()` (5 حالات: فوري، بعيد،
قريب، سلوت صريح يستثني حتى لو بعيد، حافة leadHours بالظبط)، واختبار حي ضد **Redis حقيقي**
لـ`OrderDispatchListener` (`Queue`/`getJob`/`getState` فعليين مش mocks) بيثبت: طلب بعيد بيجدول
job `delayed` حقيقي بـdelay مطابق ومفيش بث فوري؛ طلب فوري/قريب بيبث فوري ومفيش job في الطابور؛
حالة دفاعية (وقت تأجيل في الماضي) بتبث فوري برضو. `ops.QueueWatchdogService` اتحدّث يراقب الطابور
الجديد كمان. تفاصيل كاملة (بما فيها فجوة موثّقة متبقية عن تفضيل فني عادي + موعد بعيد) في
`apps/api/src/modules/matching/README.md` § تأجيل بث المطابقة.

كل الفحوصات (`tsc --noEmit`, `nest build`, `jest`) عدّت نضيف — 8 اختبارات جديدة، صفر regression
على الـ78 اختبار الموجودين.

### P0-10 — تفاصيل التنفيذ

الفجوة كانت موثّقة صراحة بالفعل في `apps/customer-app/README.md` (قسم `TechnicianSelectionScreen`)
كـ"قرار هندسي مؤجَّل" وقت أول مراجعة تقنية (نفس اليوم) — رحلة formula كانت "اختار فني (بلا سعر) ←
دخّل تفاصيل الشغل"، فقايمة الفنيين كانت بتعرض `final_price_cents: null` لكل مرشّح لأن
`GET /services/:id/technicians` محتاج `field_values` عشان يحسب. مراجعة P0 رفعت البند ده لأنه فجوة
تجربة حقيقية تتعارض مع الهدف المعلن من "اختيار الفني قبل الحجز" (docs/08 §3) — العميل مش قادر
يقارن سعر فعليًا بين الفنيين.

**الحل**: شاشة جديدة `JobDetailsScreen` (`apps/customer-app/lib/features/orders/job_details_screen.dart`)
— لخدمات `pricing_model=formula` بس، `services_screen.dart` بيوديها قبل قايمة الفنيين (عنوان +
`field_values`)، وبعد "متابعة" بيروح لـ`TechnicianSelectionScreen` ومعاها البيانات جاهزة
(`initialAddress`+`fieldValues` — باراميترين اختياريين جداد، مايأثّرش على أي استخدام تاني للشاشة).
القايمة دلوقتي بتبعت `field_values` فعليًا لـ`GET /services/:id/technicians` (الباك-إند كان جاهز
من زمان — مفيش أي تغيير backend محتاج) فبترجع `final_price_cents` حقيقي لكل فني. لو العميل اختار
فني، `CreateOrderScreen` بياخد `initialFieldValues` جاهزة (باراميتر جديد) فمايدخلش نفس البيانات
مرتين — الفورم لسه ظاهر ومعدّل (مش read-only) لو حاب يغيّر حاجة. منطق رسم حقول الفورم الديناميكي
(كان مكرّر التكرار جوّه `CreateOrderScreen` بس) اتقلع لملف مشترك
`apps/customer-app/lib/features/catalog/pricing_field_widgets.dart` تستخدمه الشاشتين. مسار
"اختيار فني عبر سلوت جدولة" (`TechnicianProfileScreen` → `CreateOrderScreen` مباشرة، فني معروف
من الأساس) والخدمات غير formula مش متأثرين خالص.

**فجوة تحقق موثّقة صراحة**: بيئة السيشن دي معندهاش Flutter SDK مثبّت (رغم إن `CLAUDE.md` بيوثّق
إنه متاح عادةً على `/opt/flutter/bin` في سيشنز تانية) — `flutter analyze`/`flutter test` متعذّرين
هنا تمامًا. اتعملت مراجعة يدوية دقيقة لكل ملف اتلمس (استيرادات، توقيعات، أنواع، توافق مع الاستخدامات
الموجودة) بدل التحقق الآلي، بس ده مش بديل عن اختبار حي فعلي. **لازم أول سيشن جاية فيها Flutter SDK
متاح تشغّل المسار كامل حيًا** (formula service حقيقي → JobDetailsScreen → قايمة فنيين بسعر حقيقي
→ CreateOrderScreen بقيم جاهزة → تأكيد) وتضيف اختبار `test_live/` مخصص، بالظبط زي باقي الشاشات
الموثّقة في `apps/customer-app/README.md`.

## القرار — نطاق مرحلة UI/UX لهذه السيشن (2026-08-13)

كل بنود P0 (10/10) اتقفلت وأُكّدت حيًا/بمراجعة موثّقة. حسب قرار المالك السابق ("P0 الأول")، الخطوة
التالية مرحلة تحسين UI/UX (الطلب الأول فوق) — لكن بيئة السيشن دي تحديدًا معندهاش Flutter SDK (فحص
مباشر: `which flutter dart` وبحث عن `/opt/flutter` — مفيش، رغم توثيق `CLAUDE.md` العام)، يعني
Customer App/Technician App (Flutter) مايقدروش يتلمسوا بمعايير الجودة المطلوبة في الطلب الأول
("لازم يتأكد كل شاشة اتلمست بمعايير محدّدة" — ده محتاج `flutter test`/تشغيل حي، مش متاح هنا).

**قرار المالك (`AskUserQuestion`)**: نبدأ بـ**Admin Panel فقط** (Next.js — قابل للاختبار حي كامل في
بيئة السيشن دي عبر متصفح Chromium المثبّت مسبقًا). Customer App/Technician App (Flutter) وDomestic
Worker experience تتأجّل صراحة لسيشن فيها Flutter SDK متاح — **مش سهو، قرار نطاق واعٍ بسبب أداة**.
خطة العمل المطلوبة (10 خطوات، فوق) بتتطبّق مُصغّرة على نطاق Admin Panel: تدقيق شاشات الأدمن الحالية
→ نظام تصميم مشترك (قابل لإعادة الاستخدام لاحقًا في باقي المنصات) → تحسين تنقل/بنية معلومات
الـsidebar → تطبيق النظام على شاشات الأدمن → تجربة Pricing Engine (جزء من Admin Panel أصلاً) →
مراجعة بصرية E2E حقيقية بمتصفح حقيقي ضد الباك-إند الحقيقي.

**تتبّع حالة شاشات Admin Panel** (`untouched` / `redesigned` / `verified` / `blocked`) هيتحدّث في
قسم منفصل تحت أول ما التدقيق (خطوة 1) يخلص.

## تدقيق الشاشات (خطوة 1) + تنفيذ نظام التصميم (خطوة 2-3) + Pricing Engine (خطوة 8) — دفعة أولى

**الجرد**: 30 صفحة (`NAV_ITEMS` القديمة في `app-shell.tsx`) — مفيش نظام تصميم موحّد (theme رمادي
محايد بالكامل، صفر ألوان دلالية)، شريط تنقل مسطّح بلا تجميع منطقي ولا أيقونات، لوحة تحكم بكروت
إحصائية بس بلا أي "يحتاج انتباه"، وconfirm() المتصفح الافتراضي لبعض الإجراءات الهدّامة.

**نظام التصميم المشترك (`apps/admin/src/app/globals.css` + `components/ui/`)**:
- ألوان: أزرق ثقة احترافي (`--primary`) بدل الرمادي البحت، زائد نظام حالات دلالي كامل
  (`--success`/`--warning`/`--danger`/`--info`, نسخة light/dark للكل) — أول مرة الواجهة بتاخد هوية
  بصرية فعلية بدل رمادي محايد صرف.
- Primitives جديدة (`@radix-ui`, نفس أسلوب shadcn "new-york" المستخدم بالفعل): `dialog`,
  `alert-dialog` (تأكيد إجراءات هدّامة — مطلوب صراحة)، `tabs`, `tooltip`, `dropdown-menu`,
  `separator`, `skeleton` (حالات تحميل)، `sonner` (توست، متوصّل في `layout.tsx`)، `avatar`.
- مكوّنات مركّبة جديدة (`components/`): `StatusChip` (شريحة حالة بلون دلالي ثابت، بديل عن
  `Badge` العشوائي الألوان)، `PageHeader` (عنوان صفحة موحّد)، `EmptyState` (حالة فراغ بصرية بدل نص
  جاف)، `ConfirmDialog` (يحيط أي trigger بتأكيد `AlertDialog` متّسق بدل `window.confirm()`).
- `orderStatusTone()` جديدة في `lib/order-labels.ts` (بجانب `orderStatusBadgeVariant()` القديمة،
  مستبقاة زي ما هي) — تصنيف أغنى دلاليًا لحالات الطلب (5 حالات بدل 3).

**تحسين التنقل (`app-shell.tsx`)**: الـ30 عنصر اتقسّموا لـ8 مجموعات منطقية (العمليات/الفنيين/
العملاء/الكتالوج والتسعير/المالية/التقارير/النظام والإعدادات، زائد نظرة عامة لوحدها) مع أيقونة
لكل عنصر — **صلاحيات P0-3 محفوظة بالحرف بلا أي تغيير في منطق fail-closed**، إعادة التجميع بصرية
بس. Avatar بأول حرفين من اسم الأدمن جنب اسمه في الهيدر.

**لوحة تحكم — قسم "يحتاج انتباه"**: كارت جديد لكل بند من `DashboardStats` الموجودة بالفعل
(شكاوى مفتوحة، فنيين بانتظار التحقق، صرف معلّق، طلبات اتلغت النهاردة) بلون تحذير/خطر لو العدد > 0
وأخضر ✓ لو صفر، رابط مباشر للصفحة المعنية. **فجوة موثّقة صراحة (مش سهو)**: باقي البنود المطلوبة في
الطلب الأصلي (طلبات متأخرة، تصعيد مساعد، موافقات KPI معلّقة، تغييرات دور/أمان حديثة) محتاجة
endpoint تجميع جديد في الباك-إند — **خارج نطاق هذه المرحلة** (الطلب الأصلي نص صراحة: "مايتغيّرش
حساب الباك-إند إلا لو مراجعة UI كشفت بَقّة حقيقية"، وده مش بَقّة، ميزة جديدة). ملحوظة واضحة على
الصفحة نفسها بدل ما الفجوة تتخبّى.

**Pricing Engine (خطوة 8 من الخطة، جزئي)**: بقى في مجموعة "الكتالوج والتسعير" بأيقونة `$` مميّزة
بدل عنصر مسطّح جنب باقي الـ29 — الشكوى الأصلية "مخبّى في آخر صفحة طويلة" اتحلّت من ناحية الاكتشاف.
محتوى صفحة `/pricing` نفسها (بناء المعادلة، الحقول، المعاينة) لسه بمنطق سيشن سابقة، لسه محتاج مرور
تصميم مخصص — نطاق متبقي.

**اتأكد حي بالكامل عبر متصفح حقيقي (Playwright + Chromium مثبّت مسبقًا، ضد API/Postgres/Redis
حقيقيين)**: حساب أدمن `super_admin` جديد اتعمله bootstrap مباشر في القاعدة (نفس الطريقة الموثّقة
في `admin/README.md` — مفيش endpoint عام لأول حساب)، سجّل دخول كامل (OTP من لوج الباك-إند فعليًا،
مش mock)، لقطات شاشة كاملة لـ`/` و`/orders` و`/pricing`: التجميع الجديد للـsidebar ظهر بالظبط زي
المتوقع، الألوان الدلالية شغالة (كروت "يحتاج انتباه" خضراء لأن القاعدة فاضية من بيانات اختبار)،
RTL سليم بالكامل، صفحات قديمة (orders) لسه شغالة عادي مع الـtheme الجديد من غير أي كسر — الأزرار
والفلاتر فيها بقت بلون primary الجديد أوتوماتيك (كل الصفحات وارثة نفس الـtokens من غير أي لمسة
لكودها). Console نضيف تمامًا (خطأ 401 واحد بس على `/login` نفسها — متوقّع، فحص جلسة أولي طبيعي قبل
تسجيل الدخول). `tsc --noEmit`, `eslint`, و`next build` (production) الثلاثة عدّوا نضيف.

**نطاق متبقٍ صريح (task tracker محلي، مش موثّق بالاسم هنا صف بصف — راجع `app-shell.tsx`
`NAV_GROUPS` للقايمة الكاملة)**: ~27 صفحة تانية (الفنيين، العملاء، الشكاوى، الموظفين، الأدوار،
الإعدادات، إلخ) وارثة الألوان/الخطوط الجديدة أوتوماتيك (تستخدم نفس `Card`/`Button`/`Badge`
المشتركة) بس **لسه ماتلمستش فعليًا** بالمكوّنات المركّبة الجديدة (`PageHeader`/`StatusChip`/
`EmptyState`/`ConfirmDialog`) ولا بأي إعادة تصميم محتوى مقصودة — دي المرحلة الجاية (خطوة 4 من خطة
العمل، "تطبيق نظام التصميم على باقي صفحات CRUD"). Customer App/Technician App/Domestic Worker
(Flutter) لسه مؤجّلة بالكامل لسيشن فيها Flutter SDK متاح (القرار الموثّق فوق).

## دفعة ثانية — تطبيق `PageHeader`/`ConfirmDialog` عبر كل صفحات Admin Panel (نفس اليوم، استكمال بلا توقف)

تطبيق منهجي لـ`PageHeader` عبر **كل** الـ39 صفحة المتبقية (30 صفحة رئيسية + 12 صفحة تفاصيل
`[id]`/`[userId]`) — مش عيّنة زي الدفعة الأولى. كل صفحة كانت بتكتب `<h1>` بنمط مختلف شويّة (بعضها
`mb-6` مباشر، بعضها `flex justify-between` يدوي، بعضها مع Badge حالة جنبها، بعضها مع زرار رجوع) —
دلوقتي كلها `<PageHeader title=... description=... actions=... />` واحد موحّد. `PageHeader.title`/
`description` بقوا يقبلوا `React.ReactNode` مش `string` بس (كانت `string` بس في الدفعة الأولى) —
صفحات التفاصيل محتاجة تحط `Badge`/رقم مرجعي `dir="ltr"` جنب العنوان مباشرة، مش نص خام.

**`window.confirm()` → `ConfirmDialog`**: كل الـ5 استخدامات المتبقية لـ`window.confirm()` (تعطيل
كود خصم، حذف فلاج، حذف قاعدة توجيه إشعار، حذف دور، صرف مكافأة KPI) اتحوّلت لـ`ConfirmDialog` —
الدالة الأصلية بقت من غير فحص التأكيد جوّاها (بقى مسؤولية الـUI)، والزرار المُشغّل بقى `trigger`
جوّه `ConfirmDialog`. **`window.prompt()` (6 ملفات، تدفقات "سبب إلزامي" — رفض/إلغاء/استرجاع)
لسه باقي عمدًا** — محتاج مكوّن جديد "PromptDialog" (حقل نص + تحقق حد أدنى طول) مش مجرد swap
ميكانيكي زي `ConfirmDialog`، فتوثيقه هنا كنطاق متبقي بدل استعجاله.

**بَقّة حقيقية اتلقطت واتصلحت أثناء المراجعة الحية** (`apps/admin/src/app/catalog/page.tsx`):
جدول الفئات كان بيرندر `categories.map((category) => (<>...</>))` — Fragment شورت-هاند (`<>`)
بلا `key` كعنصر الإرجاع المباشر من `.map()` (الـ`key` كان بس على `TableRow` الداخلي، مش الـFragment
نفسه) — React كان بيطلع تحذير `"Each child in a list should have a unique key prop"` فعليًا في
المتصفح. اتصلحت بـ`Fragment key={category.id}` صريحة (`import { Fragment } from 'react'`). فحص
شامل للنمط ده (`.map()` بيرجّع `<>` بلا key) عبر باقي الصفحات كلها أكّد إنها الحالة الوحيدة.

**بَقّة تانية اتلقطت** (`technician-kpi/[id]/page.tsx`): `<Badge>{snapshot.status}</Badge>` كانت
بتعرض قيمة enum خام (`calculated`/`approved`/`paid`/`rejected`) من غير ترجمة — يخالف صراحة مبدأ
"بدون enums خام من الباك-إند تظهر للمستخدم" المذكور في الطلب الأول. القايمة (`technician-kpi/page.tsx`)
كان عندها فعلاً `STATUS_LABELS_AR`/`STATUS_BADGE_VARIANT` محليين مش مُصدَّرين — اتنقلوا لملف
مشترك جديد `lib/technician-kpi-labels.ts` (`KPI_STATUS_LABELS`/`KPI_STATUS_BADGE_VARIANT`) تستخدمه
الصفحتين دلوقتي.

**تصحيح تخطيط جانبي**: صفحتين (`academy`, `pricing`) كان عندهم `<div className="space-y-6 p-6">`
جوّه `<AppShell>` اللي أصلاً بيحط `p-6` على `<main>` — يعني padding مضاعف. اتشال الـ`p-6` الزيادة.

**اتأكد حي بالكامل عبر Playwright + Chromium حقيقيين** (نفس حساب `super_admin` bootstrap):
- تصفّح كل الـ39 صفحة المعدّلة تباعًا — صفر console errors حقيقية (فقط 401 متوقّع على `/login`
  نفسها، و429 واحد ظهر بس وقت تصفّح 26 صفحة بسرعة غير طبيعية في سكريبت الاختبار نفسه — اتأكد إنه
  مش بَقّة حقيقية بإعادة تحميل نفس الصفحة (`/roles`) لوحدها بشكل طبيعي، النتيجة نضيفة).
- **اختبار end-to-end كامل لـ`ConfirmDialog` على فلاج حقيقي**: إنشاء فلاج `POST /admin/feature-flags`
  حقيقي، الضغط على "حذف" فتح الحوار فعليًا (لقطة شاشة مؤكِّدة: عنوان + زرار أحمر "حذف" + "إلغاء"،
  RTL سليم)، الضغط على "حذف" جوّه الحوار نفّذ `DELETE` حقيقي واختفى الفلاج من القايمة والقاعدة —
  اتأكد الحذف الفعلي من `SELECT` مباشر على `feature_flags`، مش بس اختفاء بصري.
- `tsc --noEmit`, `eslint` (صفر أخطاء/تحذيرات جديدة — كل الأخطاء المتبقية `react/no-unescaped-entities`
  في نصوص مساعدة سطور تانية، موجودة قبل الدفعة دي أصلًا ومؤكّدة عبر `git diff` سطر بسطر)، و
  `next build` (production، كل الـ39 route نجحت) الثلاثة عدّوا نضيف.

**نطاق متبقٍ محدّث**: تطبيق `StatusChip`/`EmptyState` الفعلي (مش `PageHeader` بس) عبر باقي
الصفحات، و`PromptDialog` جديد لتدفقات "سبب إلزامي" الـ6، وإعادة تصميم محتوى الجداول/الفلاتر نفسها
(مش العنوان بس) — دي المرحلة الجاية.

## دفعة ثالثة — تطبيق `EmptyState` عبر كل قوائم Admin Panel (نفس اليوم، استكمال بلا توقف)

تطبيق منهجي لمكوّن `EmptyState` (اتبنى في الدفعة الأولى، مش مستخدم في أي صفحة لحد الآن) بدل
`<p className="text-muted-foreground">مفيش ...</p>` الخام في **كل الـ20 صفحة** اللي عندها رسالة
"القايمة فاضية" حقيقية (استُبعدت نصوص التحميل `جاري التحميل…` وأي تعليقات كود بالصدفة فيها كلمة
"مفيش" — الفلترة كانت بـregex دقيق `.length === 0 && <p ...>مفيش...`). كل صفحة أخدت تعديلين: إضافة
`import { EmptyState } from '@/components/empty-state';` بعد استيراد `PageHeader` مباشرة، واستبدال
سطر الـ`<p>` بـ`<EmptyState title="..." />` بنفس النص العربي الأصلي حرفيًا (زيرو تغيير في الصياغة).

الصفحات العشرين: `recurring-orders`, `reports` (سطرين: فنيين/مناطق), `payouts`, `internal-chat`,
`internal-chat/[id]`, `orders`, `technician-companies`, `technicians`, `employees`, `support-chat`,
`support-chat/[id]`, `support`, `notification-routing`, `support-tickets`, `promotions`,
`customers`, `cancellation-reasons`, `buildings`, `audit-log`, `domestic-workers`.

**اتأكد حي**: `tsc --noEmit` صفر أخطاء، `eslint src` صفر تحذيرات/أخطاء جديدة (نفس الـ16 خطأ
`react/no-unescaped-entities` المؤكَّدين قبل كده كسابقين على أي دفعة من الثلاثة — `git diff` صفر
على كل ملفاتهم في الدفعة دي)، `next build` (production) نجح لكل الـ39 route. اختبار Playwright حي
ضد الباك-إند الحقيقي: فلترة `/customers` برقم موبايل مش موجود، وفلترة `/audit-log` بنوع كيان وهمي —
الاتنين عرضوا `EmptyState` بشكله الصحيح (صندوق بحدود متقطّعة، أيقونة صندوق، النص العربي، RTL سليم)،
صفر console errors حقيقية (401 واحد متوقّع بس على فحص الجلسة قبل تسجيل الدخول).

**نطاق متبقٍ**: `PromptDialog` لتدفقات "سبب إلزامي" الـ6 (`window.prompt()`)، وإعادة تصميم محتوى
الجداول/الفلاتر نفسها بعمق أكبر من مجرد رأس الصفحة وحالة الفراغ.

## دفعة رابعة — تطبيق `StatusChip` عبر كل صفحات الحالة الدلالية (نفس اليوم، استكمال بلا توقف)

استبدال `Badge` العادي (اللي بيحصر أي حالة في 4 ألوان محدودة `default`/`secondary`/`destructive`/
`outline` من غير ربط دلالي بمعنى الحالة) بـ`StatusChip` (5 نغمات ثابتة: نجاح=أخضر، تحذير=كهرماني،
خطر=أحمر، معلومة=أزرق، محايد=رمادي) عبر كل مكان بيعرض حالة enum حقيقية من الباك-إند:

- **الطلبات** (`orders/page.tsx`, `orders/[id]/page.tsx`): `order_status` (دالة `orderStatusTone()`
  الموجودة بالفعل من دفعة سابقة، مش مستخدمة قبل كده في أي صفحة).
- **بَقّة حقيقية اتلقطت واتصلحت أثناء المراجعة**: الصفحتين كانتا بتعرضوا `order.payment_status`
  **خام** (`unpaid`/`pending`/`paid`/...) من غير ترجمة عربية — يخالف صراحة مبدأ "بدون enums خام
  تظهر للمستخدم" (نفس فئة بَقّة `technician-kpi/[id]` اللي اتصلحت في دفعة سابقة). اتضاف
  `PAYMENT_STATUS_LABELS`/`paymentStatusTone()` جداد في `lib/order-labels.ts` (مطابقين لـ
  `order_payment_status` enum في `infra/migrations/0002_enums.sql`).
- **طلبات الصرف** (`payouts/page.tsx`): `payout_status` (`payoutStatusTone()` جديدة في
  `lib/payments-labels.ts`، بديل لـ`payoutStatusBadgeVariant()` اللي اتشالت).
- **الشكاوى** (`support/page.tsx`, `support/[id]/page.tsx`): `complaint_status` و`severity`
  (`complaintStatusTone()`/`complaintSeverityTone()` جداد في `lib/support-labels.ts`).
- **تذاكر الدعم** (`support-tickets/page.tsx`, `support-tickets/[id]/page.tsx`): `ticket_status`
  (`ticketStatusTone()` جديدة في `lib/support-ticket-labels.ts`).
- **KPI الفنيين** (`technician-kpi/page.tsx`, `technician-kpi/[id]/page.tsx`): `snapshot.status`
  (`KPI_STATUS_TONE` جديد في `lib/technician-kpi-labels.ts`).

كل دالة `*BadgeVariant`/`*_BADGE_VARIANT` القديمة المستبدَلة اتشالت بالكامل (مش مُستبقاة كنسخة
ميتة) بعد التأكد إنها بقت من غير أي استخدام باقي عبر المشروع كله (`grep` شامل قبل الحذف).

**اتأكد حي**: `tsc --noEmit` صفر أخطاء، `eslint src` نفس الـ16 خطأ/تحذيرين السابقين بالحرف (صفر
جديد، `git diff` تأكيدي على كل ملف من ملفات الأخطاء)، `next build` نجح لكل الـ39 route. تحقق بصري
حي حقيقي: اتحقن 4 شكاوى تجريبية + 4 تذاكر دعم تجريبية مباشرة في قاعدة البيانات (تغطي الحالات
الأربع/الست المختلفة) عبر SQL مباشر، لقطة شاشة أكّدت الألوان الصحيحة لكل حالة (مفتوحة=كهرماني/أزرق
حسب الصفحة، مصعّدة=أحمر، اتحلّت=أخضر، مقفولة=رمادي، خطورة عالية/حرجة=أحمر، متوسطة=كهرماني،
منخفضة=رمادي) — الصفوف التجريبية اتمسحت فورًا بعد التأكد (`DELETE ... WHERE ... LIKE '%-TEST-%'`).

**نطاق متبقٍ**: إعادة تصميم محتوى الجداول/الفلاتر نفسها بعمق أكبر من مجرد رأس الصفحة/حالة
الفراغ/شريحة الحالة. صفحات تانية فيها Badge لحالات ثنائية بسيطة (نشط/معطّل، مفعّل/موقوف) اتسيبت
زي ما هي عمدًا — StatusChip مصمم لحالات enum متعددة القيم، مش toggle ثنائي بسيط لا يستفيد من 5
نغمات.

## دفعة خامسة — مكوّن `PromptDialog` جديد + إزالة كل `window.prompt()` (نفس اليوم، استكمال بلا توقف)

بنى مكوّن `PromptDialog` جديد (`src/components/prompt-dialog.tsx`) — نمط موحّد لتدفقات "سبب
إلزامي" بديل عن `window.prompt()` المتصفح الافتراضي (شكل غير متّسق، بيوقف كل الصفحة، والتحقق من
الطول بيحصل بعده عبر `window.alert()` منفصل ومزعج). بعكس `ConfirmDialog` (اللي بيقفل تلقائيًا وقت
الضغط لأن `AlertDialogAction` هو `DialogPrimitive.Close` من جوّه Radix)، هنا لازم نمنع الإرسال لحد
ما القيمة تعدّي الحد الأدنى — فمُستخدم `Dialog` العادي بـstate متحكّم فيه (`open`/`value`)، جوّه
`<form>` عادي عشان Enter يشتغل، وزرار الإرسال معطّل (`disabled`) لحد ما `isValid` (بيدعم `minLength`
وحقل `required` اختياري للحالات اللي الملاحظات فيها مش إلزامية).

اتحوّلت كل الـ9 مواضع لـ`window.prompt()` عبر 6 ملفات لاستخدام `PromptDialog`:
- `technician-progression/page.tsx`: `handleOverride` (10 حروف)، `handleReject` (5 حروف).
- `orders/[id]/page.tsx`: `handleRefund` (حرفين، كانت فجوة موثّقة صراحة إن endpoint الاسترجاع
  موجود من زمان بدون زرار — لسه كذلك، بس دلوقتي بشكل حوار متّسق بدل `window.prompt`).
- `domestic-workers/page.tsx`: `handleReview` رفض (حرف واحد على الأقل).
- `technicians/[id]/page.tsx`: 3 مواضع — `handleNextStep` (ملاحظات اختيارية، `required={false}`)،
  `handleReviewDocument` رفض، `handleReviewCertificate` رفض (كلها حرف واحد على الأقل).
- `technician-kpi/[id]/page.tsx`: `handleReject` (5 حروف).
- `payouts/page.tsx`: `handleReject` (حرفين).

كل الدوال المعنية اتغيّر توقيعها لتاخد السبب/الملاحظات كـparameter مباشر بدل استدعاء
`window.prompt()`/`window.alert()` جواها — التحقق من الطول بقى بالكامل مسؤولية `PromptDialog`
نفسه (زرار الإرسال معطّل + رسالة حمراء واضحة تحت الحقل، مش alert منبثق منفصل).

**اتأكد حي end-to-end حقيقي بالكامل** (مش بس screenshot ثابت): اتحقن فني تجريبي + محفظة + طلب صرف
حقيقي (`payout_status='under_review'`) مباشرة بالقاعدة، Playwright فتح صفحة `/payouts`، ضغط "رفض"
ففتح الحوار، تأكّد إن زرار الإرسال **معطّل** والحقل فاضي، كتب حرف واحد (أقل من `minLength=2`) وتأكّد
إن الزرار **لسه معطّل** ورسالة "لازم 2 حروف على الأقل" ظهرت بالأحمر، كتب سبب صحيح وتأكّد إن الزرار
**بقى مفعّل**، ضغط الزرار ففعليًا نفّذ `POST /admin/payouts/:id/reject` حقيقي — اتأكد بـ`SELECT`
مباشر إن `payout_status` بقى `rejected` و`rejection_reason` اتسجّل بالنص الصحيح بالظبط، والصف
اختفى من فلتر "قيد المراجعة" في الواجهة. البيانات التجريبية اتمسحت فورًا بعد التأكد.

`tsc --noEmit` صفر أخطاء، `eslint src` نفس الـ16 خطأ/تحذيرين السابقين بالحرف (صفر جديد)، `next
build` نجح لكل الـ39 route.

**نطاق متبقٍ**: إعادة تصميم محتوى الجداول/الفلاتر نفسها بعمق أكبر من رأس الصفحة/حالة الفراغ/شريحة
الحالة/حوارات التأكيد — هيكل الجدول والفلاتر والتخطيط العام لسه زي ما كان قبل مرحلة UI/UX دي.

## دفعة سادسة — مكوّن `TableSkeleton` بديل نص "جاري التحميل…" الخام (نفس اليوم، استكمال بلا توقف)

مكوّن `TableSkeleton` جديد (`src/components/table-skeleton.tsx`) — يبني `Table`/`TableBody` فيها
عدد صفوف×أعمدة قابل للتخصيص، كل خلية `Skeleton` نابض (`animate-pulse`، من `ui/skeleton.tsx` اللي
كان مبني من الدفعة الأولى بس مستخدم بس في لوحة التحكم). الهدف: بديل بصري عن نص "جاري التحميل…"
الخام قبل أي جدول قايمة — بيحجز نفس شكل/مساحة الجدول الحقيقي الجاي فمفيش قفزة تخطيط (layout shift)
لحظة وصول البيانات، وبيدّي إحساس فوري بشكل المحتوى بدل ومضة نص رمادي.

اتطبّق عبر **20 موضع تحميل أساسي** (قايمة رئيسية قبل `<Table>` مباشرة، مش تحميل أقسام فرعية زي
المحفظة أو نماذج الفورم) في 19 صفحة (`geo/page.tsx` فيها 3 مواضع لثلاث جداول مختلفة: مدن/مناطق/
نطاقات خدمة): `support-tickets`, `employees`, `orders`, `domestic-workers`, `buildings`,
`customers`, `technician-companies`, `recurring-orders`, `audit-log`, `cancellation-reasons`,
`promotions`, `notification-routing`, `support-chat`, `technicians`, `support`, `internal-chat`,
`payouts`, `roles`, `feature-flags`, `geo` (×3). عدد الأعمدة لكل استخدام اتضبط يدويًا مطابق لعدد
`<TableHead>` الفعلي في كل صفحة (اتعدّ بدقة عبر `grep`، مش رقم افتراضي عشوائي).

**نطاق مستبعَد عمدًا من الدفعة دي**: مواضع تحميل فرعية داخل صفحات التفاصيل (محفظة الفني/العميل،
عناصر طلب الصرف، خيارات فورم الخدمات/المناطق) وصفحات فيها `Card` بدل `Table` (زي
`technician-levels`) — دي مش نفس الشكل، محتاجة معالجة مختلفة (skeleton كروت زي لوحة التحكم، مش
جدول) خارج نطاق هذه الدفعة الميكانيكية.

**اتأكد حي**: `tsc --noEmit` صفر أخطاء، `eslint src` نفس الـ16 خطأ/تحذيرين السابقين بالحرف (صفر
جديد)، `next build` نجح لكل الـ39 route. تحقق بصري حي عبر Playwright + إبطاء الشبكة فعليًا
(Chrome DevTools Protocol، 50KB/ث + 800ms latency) على `/orders` — أكّد ظهور 6 أعمدة skeleton
نابضة بنفس شكل الجدول الحقيقي (6 أعمدة: رقم الطلب/النوع/الحالة/الإجمالي/حالة الدفع/تاريخ الطلب)
قبل وصول البيانات الحقيقية.

## دفعة سابعة — مكوّن `Pagination` موحّد (نفس اليوم، استكمال بلا توقف)

مكوّن `Pagination` جديد (`src/components/pagination.tsx`) — كان نفس الـJSX بالحرف (نص "صفحة X من
Y (إجمالاً)" + زرار سابق/تالي بنفس منطق `disabled`) مكرر عبر **7 صفحات قايمة** مختلفة، فرق بينهم
بس اسم العنصر المعدود ("موظف"/"طلب"/"عميل"/"قالب"/"سجل"/"كود"/"فني"). المكوّن ياخد
`page`/`totalPages`/`total`/`itemLabel`/`onPageChange` — نفس المنطق حرفيًا (زرار "السابق" معطّل
لما `page <= 1`، "التالي" معطّل لما `page >= totalPages`)، مجرد استخراج (extraction) بدون أي
تغيير سلوكي.

اتطبّق في: `employees`, `orders`, `customers`, `recurring-orders`, `audit-log`, `promotions`,
`technicians`. بَقّة صغيرة اتلقطت أثناء التطبيق: `audit-log/page.tsx` بقى مستورد `Button` من غير
استخدام (كان آخر استخدام ليه هو زرار الـpagination اللي اتشال) — `eslint` طلّع تحذير
`no-unused-vars` فعليًا، اتصلح بحذف الاستيراد الزيادة.

`tsc --noEmit` صفر أخطاء، `eslint src` رجع لنفس الـ16 خطأ/تحذيرين السابقين بالحرف (صفر جديد بعد
إصلاح تحذير `audit-log`)، `next build` نجح لكل الـ39 route. اتأكد حي عبر Playwright إن الصفحات لسه
شغالة صفر console errors (401 المتوقع بس)، والـpagination بيختفي صح لما القايمة فاضية (نفس شرط
`X && X.length > 0` الأصلي) — تحقق سلوكي مباشر مش لقطة شاشة بس، لأن المكوّن استخراج حرفي من كود
مُختبر حي قبل كده في الدفعات السابقة (زرارات الفلاتر/الجداول نفسها).

## تسليم سابق — تسليم فوري للسيشن/الموديل التالي (2026-08-13، مؤرشف بعد استكمال الدفعة التامنة)

**السياق**: السيشن اللي كتبت الدفعات السبعة فوق (من "نظام تصميم مشترك" لحد "Pagination موحّد")
وصلت لحد الـlimit بتاعها ووقفت هنا عمدًا بطلب من المالك. **كل حاجة لحد دلوقتي commit + push على
الفرع `claude/home-repair-company-project-hgotr7`** — آخر commit هو `ebfe024` ("مكوّن Pagination
موحّد بدل التكرار عبر 7 صفحات"). `git status` نضيف تمامًا وقت التوقف — مفيش أي تعديل غير محفوظ.

### الدفعة التامنة (لسه ما بدأتش — بس البحث خلص بالكامل، جاهزة للتنفيذ المباشر)

الهدف: استكمال تطبيق `EmptyState` (نفس المكوّن من الدفعة التالتة) على **21 حالة فراغ إضافية**
عبر **10 صفحات تفاصيل/فرعية** ماكانتش جزء من الدفعة التالتة الأصلية (اللي كانت مقصورة على صفحات
القوايم الرئيسية بس، نمط `X && X.length === 0 && <p>`). الحالات دي بنمط تيرناري مختلف شويّة
(`!X ? <p>جاري التحميل…</p> : X.length === 0 ? <p>مفيش...</p> : <Table>...`) جوّه `Card` داخل
صفحة تفاصيل، مش أعلى قايمة كاملة — **اتفحصت واحدة واحدة يدويًا وكلها مؤكَّدة آمنة ومباشرة** (نفس
شكل الاستبدال البسيط، مفيش تعقيد إضافي). التنفيذ المطلوب لكل حالة: **تعديلين بالظبط** — (1) إضافة
`import { EmptyState } from '@/components/empty-state';` لو مش موجود في الملف أصلاً (اتأكد بـ
`grep -n "EmptyState" الملف` الأول — **ولا ملف من العشرة عنده الاستيراد ده لسه**)، (2) استبدال
`<p className="text-sm text-muted-foreground">مفيش ...</p>` بـ `<EmptyState title="مفيش ..." />`
بنفس النص العربي حرفيًا (زيرو تغيير صياغة، زي كل الدفعات السابقة).

**القايمة الكاملة (ملف: رقم السطر وقت التوقف — ممكن يتزحزح لو الملف اتعدّل، دوّر بالنص مش بالرقم)**:

1. `technicians/[id]/page.tsx:350` — "مفيش مستندات مرفوعة"
2. `technicians/[id]/page.tsx:427` — "مفيش شهادات مرفوعة"
3. `technicians/[id]/page.tsx:538` — "مفيش مناطق عمل معيّنة لسه"
4. `employees/[userId]/page.tsx:240` — "مفيش أدوار متعيّنة"
5. `employees/[userId]/page.tsx:305` — "مفيش سجل"
6. `employees/[userId]/page.tsx:335` — "مفيش نشاط مسجّل"
7. `technician-companies/[id]/page.tsx:75` — "مفيش فروع لسه"
8. `support/[id]/page.tsx:364` — "مفيش رسائل لسه" (تنبيه: الفرع التاني مش `<Table>`، هو
   `messages.map(...)` مباشر — الاستبدال البسيط لسه صحيح، بس EmptyState هيبقى بديل مباشر عن الـ`<p>`)
9. `roles/[id]/page.tsx:304` — "مفيش حد عنده الدور ده دلوقتي"
10. `roles/[id]/page.tsx:330` — "مفيش أي تعديلات مسجّلة لسه"
11. `catalog/page.tsx:267` — "مفيش فئات لسه"
12. `catalog/page.tsx:492` — "مفيش خدمات في الفئة دي"
13. `academy/page.tsx:179` — "مفيش كورسات لسه"
14. `academy/page.tsx:289` — "مفيش نتائج اختبارات مسجّلة للفني ده لسه"
15. `technician-referrals/page.tsx:106` — "مفيش سجلات بالفلتر ده"
16. `orders/[id]/page.tsx:512` — "مفيش سجل" (تاريخ الحالة)
17. `orders/[id]/page.tsx:624` — "مفيش بنود إضافية اتقترحت على الطلب ده"
18. `orders/[id]/page.tsx:665` — "مفيش صور اترفعت للطلب ده لسه"
19. `geo/page.tsx:283` — "مفيش مدن لسه"
20. `geo/page.tsx:353` — "مفيش مناطق للمدينة دي لسه"
21. `geo/page.tsx:412` — "مفيش نطاقات خدمة للمدينة دي لسه"

**نطاق مستبعَد عمدًا من الدفعة دي** (اتفحص وقُرّر إنه يحتاج قرار تصميمي مش استبدال ميكانيكي بسيط):
`catalog/services/[id]/page.tsx` و`catalog/services/[id]/pricing-builder.tsx` (ملفين كبيرين جدًا،
1000+ سطر، فيهم حالات فراغ بعضها نص توضيحي عن سلوك fallback مش "قايمة فاضية" حقيقية — محتاجين
قراءة كاملة للسياق قبل أي تعديل، مش grep سريع). `feature-flags/page.tsx:276,309` (تفاصيل فرعية
جوّه صف موسّع، صغيرة جدًا). `orders/[id]/page.tsx:340,437` (حقول حالة صغيرة سطر واحد، مش قايمة).
`technician-progression/page.tsx:285` و`technician-kpi/page.tsx:136` (النص فيه تعليمة فعل مدمجة
"دوس كذا" — محتاج زرار `action` جوّه EmptyState مش استبدال نصي بسيط). `reports/page.tsx` (بنية
معقدة، محتاجة قراءة كاملة أول).

**بعد التنفيذ، اتبع نفس نمط كل الدفعات السابقة بالظبط**:
1. `npx tsc --noEmit` (لازم صفر أخطاء).
2. `npx eslint src` (لازم نفس الـ16 خطأ/تحذيرين `react/no-unescaped-entities` بالحرف، صفر جديد —
   قارن بـ`git diff` على أي ملف فيه تحذير جديد للتأكد إنه مش من تعديلك).
3. `npx next build` (لازم كل الـ39 route تعدّي، production build حقيقي).
4. تحقق حي بـPlaywright (سكريبتات جاهزة كمرجع في `/tmp/claude-0/.../scratchpad/verify-*.js` من
   السيشن السابقة — نفس النمط: تسجيل دخول بـOTP من `/tmp/api-dev.log`، حقن بيانات تجريبية مباشرة
   بقاعدة `baytak` لو الصفحة فاضية أصلاً في الـdev DB، لقطة شاشة، مسح البيانات التجريبية فورًا).
5. تحديث `docs/12-ux-refinement-and-p0-audit-2026-08-13.md` (قسم "دفعة تامنة") و`apps/admin/README.md`
   بنفس أسلوب التوثيق المستخدم في الدفعات السبعة اللي فاتت بالظبط.
6. `git add`/`commit`/`push` لـ`claude/home-repair-company-project-hgotr7` (نفس صيغة الـcommit
   message المستخدمة في الدفعات السابقة، ينتهي بـ`Co-Authored-By`/`Claude-Session` trailer).

**بعد الدفعة التامنة**: النطاق المتبقي من "UI/UX: تطبيق نظام التصميم على باقي صفحات CRUD" (تاسك
#83 لسه `pending`) هو إعادة تصميم محتوى الجداول/الفلاتر نفسها بعمق أكبر — ده مفتوح النطاق ومحتاج
قرارات تصميمية أكتر مش استبدال ميكانيكي، فمن المتوقع إنه آخر حاجة في المرحلة دي أو يحتاج توجيه إضافي
من المالك عن الأولوية بالظبط.

## دفعة تامنة — استكمال EmptyState عبر 21 حالة تفاصيل/فرعية (سيشن/موديل تاني، بلا توقف)

**السياق**: المالك بعت الملخّص الكامل لسيشن سابقة (كانت شغالة على فرع `claude/home-services-app-plan-v13gb2`
منفصل على طلب `docs/11`) لسيشن/موديل تاني ليكمل شغل السيشن اللي وقفت هنا، بتوجيه صريح: "الحاجة اللي
تلاقيها موجودة ما تعملهاش تاني... تكمل عليها وتكبرها وتزودها، وتفكر زي ما هو كان بيفكر بالضبط". أول
خطوة: `git fetch`/تأكيد إن الفرع `claude/home-repair-company-project-hgotr7` عنده بالفعل كل حاجة من
`main` (بما فيها الأربع أجزاء المدموجة من `docs/11` — RBAC، ترشيح QR، KPI، المسار الوظيفي) — تأكّد
عبر `git merge-base --is-ancestor` إن الفرع فعلاً حاوي أحدث `main`، صفر تعارض متوقّع.

**التنفيذ**: البحث كان خلص بالكامل من السيشن السابقة (القايمة الكاملة بالأسطر فوق) — التنفيذ نفسه
كان مباشر: لكل موضع من الـ21، إضافة `import { EmptyState } from '@/components/empty-state';` (لو
مش موجود، اتأكد بـ`grep` قبل كل ملف) + استبدال `<p className="text-sm text-muted-foreground">مفيش
...</p>` بـ`<EmptyState title="مفيش ..." />` بنفس النص العربي حرفيًا. الملفات العشرة اتعدّلوا بالظبط
زي القايمة الموثّقة (`technicians/[id]` ×3، `employees/[userId]` ×3، `technician-companies/[id]` ×1،
`support/[id]` ×1، `roles/[id]` ×2، `catalog` ×2، `academy` ×2، `technician-referrals` ×1،
`orders/[id]` ×3، `geo` ×3 = 21 بالظبط). فحص شامل بعد التنفيذ أكّد صفر نص قديم متبقي من الـ21 وصفر
تكرار.

**اتأكد حي بالكامل عبر Playwright + Chromium حقيقيين ضد API/Postgres/Redis حقيقيين** (بيئة السيشن
دي كانت بايظة تمامًا وقت البدء — Postgres/Redis واقفين، و`node_modules` من الفرع الأصلي مكنش فيه
حزم `sonner`/`@radix-ui/*` اللي الدفعات السابقة ضافتها، `npm install` جذري لازم قبل أي حاجة):
- `geo`: مدينة اختبار فاضية جديدة اتحقنت مباشرة بالقاعدة (`cities` + `country_id` صحيح) — لقطة
  شاشة أكّدت صندوقي "مفيش مناطق للمدينة دي لسه" و"مفيش نطاقات خدمة للمدينة دي لسه" بشكلهم الصحيح
  (حدود متقطّعة، أيقونة، RTL) في نفس اللحظة.
- `roles/[id]` (دور `support_agent` الحقيقي): "مفيش أي تعديلات مسجّلة لسه" ظهرت صح (الدور ده معملوش
  تعديل قبل كده)، ومصفوفة الصلاحيات أكّدت وجود `technician_kpi.*`/`technician_progression.*` من
  أجزاء `docs/11` السابقة فعليًا في الكتالوج — تأكيد إضافي إن مفيش أي فقد بيانات بين الفرعين.
- `orders/[id]` (طلب حقيقي مكتمل): "مفيش بنود إضافية اتقترحت على الطلب ده" و"مفيش صور اترفعت للطلب
  ده لسه" ظهروا صح، جنب `StatusChip` لحالة الطلب/الدفع شغالة عادي.
- `academy`: "مفيش كورسات لسه" (صفر كورسات في القاعدة فعليًا).
- `employees/[userId]` (موظف اختبار قديم من سيشن سابقة): الثلاثة — "مفيش أدوار متعيّنة"، "مفيش سجل"،
  "مفيش نشاط مسجّل" — ظهروا صح في نفس الصفحة.

كونسول المتصفح: تحذير 401 واحد متوقّع (فحص جلسة أولي على `/login`، نفس نمط كل الدفعات السابقة) +
تحذيرين 403 ظهروا في الكونسول بس **بدون أي أثر في لوج الباك-إند ولا لوج `next dev`** (تأكّد بـ`grep`
مباشر على اللوجّين، صفر نتائج) — مش من `/api/v1/*` ولا من `apps/admin` نفسه، على الأرجح موارد فرعية
غير مؤثرة (نفس فئة الـ429 اللي ظهر في دفعة سابقة واتأكد إنه مش بَقّة حقيقية). كل الصفحات اشتغلت
ووظائفها سليمة بصريًا في اللقطات، فمتعتبرش regression بدون دليل إضافي.

البيانات التجريبية (مدينة `EmptyState-TEST`) اتمسحت فورًا بعد التأكيد.

**الفحوصات الثلاثة**: `npx tsc --noEmit` صفر أخطاء. `npx eslint src` نفس الـ16 خطأ/تحذيرين
`react/no-unescaped-entities` + `no-unused-vars` (`roles/[id]/page.tsx` — `TableHeader`/`TableHead`)
بالحرف من الدفعات السابقة (اتأكد بـ`git diff` على كل ملف فيه تحذير: صفر تغيير من تعديلات الدفعة دي).
`npx next build` (production) نجح لكل الـ39 route.

## دفعة تاسعة — استكمال الحالات المستبعدة من الدفعة التامنة + بَقّة بيئة حقيقية اتلقطت (بلا توقف)

استكمال مباشر بعد الدفعة التامنة، بنفس المنهجية: مراجعة كل حالة كانت مستبعدة عمدًا في الدفعة
التامنة لأنها "محتاجة قرار تصميمي مش استبدال ميكانيكي بسيط"، وتحديد أيها فعلاً قابلة للتحويل الآن.

**حالات بفعل مدمج (`action` prop في `EmptyState`)**: `technician-progression/page.tsx` (زرار
"احسب أهلية كل الفنيين") و`technician-kpi/page.tsx` (زرار "احسب الشهر ده") — النص الأصلي كان
بيوجّه المستخدم لزرار موجود بالفعل فوق في نفس الصفحة (`handleCalculate`/`isCalculating` في نفس
الـcomponent scope). بدل نص "دوس X"، الزرار الحقيقي نفسه بقى جوّه `EmptyState` (`action={<Button
onClick={handleCalculate}>...</Button>}`) — نفس الدالة، صفر تكرار منطق.

**`orders/[id]/page.tsx:437` (المساعدين)**: كان مصنّف مع `:340` كـ"حقل حالة سطر واحد" بس فعليًا
بنفس نمط `Card`+`Table`+ternary المطابق للـ21 حالة السابقة تمامًا — اتحوّل. `:340` (اختيار فني في
فورم إعادة التعيين، مش قايمة) فضل زي ما هو، والاستبعاد ده صحيح فعلاً — `EmptyState` الكبير هيبان
غريب جوّه حقل SelectNative مصغّر.

**`feature-flags/page.tsx:276,309`**: اتفحصت وأُكِّد الاستبعاد — نصوص صغيرة جوّه صف موسّع (Badge
chips جنب Input+Button)، مش قايمة في Card مستقلة. `EmptyState` (صندوق حدود متقطّعة + أيقونة +
`py-12`) هيكسر التخطيط المضغوط ده. **قرار تصميمي صحيح، مش سهو — فضل مستبعد عمدًا.**

**`reports/page.tsx`**: بعد قراءة كاملة، لقينا حالتين مش أربعة: `RevenueChart()` (سطر 96 — إرجاع
مبكر بديل عن الرسم البياني كله لو مفيش صفوف، اتحوّل لـ`EmptyState`) و`hasAnyValue` (سطر 156 —
نص صغير تحت رسم بياني ظاهر بالفعل بكل الأعمدة على صفر، **فضل مستبعد** لأن الرسم نفسه ظاهر فوقه،
تكرار بصري لو اتحوّل لصندوق كبير).

**`catalog/services/[id]/page.tsx` و`pricing-builder.tsx`**: بعد قراءة الملفين كاملين (1058 +
859 سطر)، طلع إن الحجم الكلي مش تعقيد فعلي — كل حالة فراغ فيهم هي نفس نمط `Card`+`Table`+ternary
المطابق تمامًا للدفعة التامنة، الملفات كبيرة بس لأنها عندها أقسام Card مستقلة كتير. **10 حالات
اتحوّلت**: `catalog/services/[id]` (6 — فنيين مؤهّلين، تسعير مناطق، تسعير مستويات، إضافات
اختيارية، بيانات قياسية، إنتاجية فعلية) و`pricing-builder.tsx` (4 — حقول تسعير، ثوابت، جداول
بحث، معاينة السعر "أضف حقول أول").

**بَقّة بيئة حقيقية اتلقطت واتصلحت أثناء الاختبار الحي**: أول محاولة لاختبار `reports/page.tsx`
حيًا فشلت — `super_admin` نفسه رجع 403 "دورك الإداري مش مديك صلاحية العملية دي" على
`/admin/reports/revenue`، رغم إن `GET /admin/me/permissions` رجع نجاح. تحقيق مباشر (`psql`) أكّد
إن جدول `permissions` فيه 33 صف بس، صفر صف فيه `report` — يعني **migration `0085`
(`reports.view`/`recurring_orders.view`، من نفس دفعات P0 اللي وثّقت "✅ خلص") ماكانتش متطبّقة
على قاعدة البيانات دي فعليًا**، رغم وجود ملف الـmigration في الريبو. السبب: قاعدة بيانات Postgres
دي من سيشن سابقة (بنت أجزاء `docs/11` لحد migration `0084`) واتعاد تشغيلها في السيشن دي من غير
تطبيق `0085`/`0086` الجداد. **الإصلاح**: تطبيق الاتنين مباشرة (`psql -f
infra/migrations/0085_....sql` و`0086_....sql`) — اتأكد بعدها إن `reports.view` بقى ضمن
الـ33+2=35 صلاحية، و`GET /admin/reports/revenue` رجع `200` بدل `403`. **ده مش بَقّة كود — الكود
والمigration نفسها صحيحين 100%، كانت فجوة تزامن بيئة تطوير محلية بس**، موثّقة هنا للشفافية.

**اتأكد حي بالكامل عبر Playwright + Chromium حقيقيين** (بعد إصلاح المigrations): خدمة formula
اختبارية جديدة اتحقنت (`services`) — لقطة شاشة واحدة أكّدت **كل** حالات الفراغ التسعة في
`catalog/services/[id]`+`pricing-builder` (فنيين مؤهّلين، تسعير مناطق/مستويات، إضافات، بيانات
قياسية، حقول/ثوابت/جداول بحث، معاينة السعر) ظاهرة صح في نفس اللحظة. `technician-kpi` بفلتر سنة
2027 (صفر بيانات فعليًا) أكّد الـ`EmptyState` بالوصف والزرار الوظيفي معًا. `reports` بفترة
2030 (صفر طلبات) أكّد الرسم البياني بيرجع `EmptyState` كامل بدل الرسم الفاضي. البيانات التجريبية
(الخدمة الوهمية) اتمسحت فورًا بعد التأكيد.

`tsc --noEmit` (`apps/api` و`apps/admin`) صفر أخطاء، `eslint src` تحسّن فعليًا لـ**16 مشكلة بس**
(كان 18) — تحويل نص `technician-kpi/page.tsx` لـ`EmptyState` شال سطرين كانا بيستخدموا علامات
تنصيص خام (`"احسب الشهر ده"`) بدل `&quot;`، فحلّهم `react/no-unescaped-entities` تلقائيًا كأثر
جانبي مفيد. `next build` نجح لكل الـ39 route. `apps/api`: `nest build` + `jest` (78 اختبار) عدّوا
نضيف بلا أي تغيير (الدفعة دي `apps/admin` بس، الباك-إند اتأكد سليم بعد إصلاح الـmigrations فقط).

## دفعة عاشرة — امتداد نظام التصميم من Admin Panel لـFlutter (customer-app + technician-app)، بلا توقف

بعد ما نظام التصميم (design system) اكتمل في `apps/admin` (الدفعات 1-9)، امتداد طبيعي لنفس
المبدأ الحاكم — اتساق بصري عبر المنتج **كله**، مش شاشات عرض قليلة — لـ`apps/customer-app` و
`apps/technician-app` (Flutter). نفس فلسفة `EmptyState`/التحميل الهيكلي (skeleton) اللي بُنيت
في Admin اتنقلت بمعادلها البصري في Material3، بدون افتراض إن Flutter محتاج حل مختلف من الأساس.

**قرار معماري متعمّد (مش سهو)**: `packages/shared-ui` موجود بالفعل كـplaceholder فاضي، بس
الـREADME بتاعه نفسه بيوضّح إنه لـweb/React بس. بدل إنشاء package Flutter مشترك جديد
(`packages/shared-flutter-ui` مثلاً) لمستهلِكَين اتنين بس (`customer-app`, `technician-app`)،
اتقرر نسخ مجلد `lib/design/` صغير بالحرف بين التطبيقين — تطبيق مباشر لمبدأ المشروع نفسه ("متضيفش
تجريد قبل ما يتاح فعلاً" من `CLAUDE.md`). قرار بوزن معماري أقل من RBAC/محرك التسعير، فمعملوش
ADR منفصل له — موثّق هنا بدل كده.

**`lib/design/` الجديد (مطابق حرفيًا في التطبيقين)**:
- `app_theme.dart` — `AppColors` (نفس القيم الدلالية لـ`globals.css` بس بـsRGB مش OKLCH، معادِلة
  بصريًا مش رقميًا)، `AppSpacing` (4/8/12/16/24/32 بدل أرقام متفرقة)، `AppTheme.light()`/`.dark()`
  (`ColorScheme.fromSeed` + `cardTheme`/`appBarTheme`/`filledButtonTheme`/`inputDecorationTheme`
  مخصّصة)، وextension `SemanticColors` على `BuildContext` (`successColor`/`warningColor`/
  `infoColor`/`dangerColor`) — Material3's `ColorScheme` معندهوش خانات success/warning/info
  جاهزة، الextension دي بتسدّ الفجوة بنفس منطق admin's `--success`/`--warning`/`--info` tokens.
- `empty_state.dart` — نفس فلسفة `apps/admin/src/components/empty-state.tsx` (أيقونة + عنوان +
  وصف اختياري + `action` widget اختياري)، بديل موحّد عن نص "مفيش ..."/"لسه ..." خام وسط الشاشة.
- `loading_list.dart` — بديل بصري لـ`CircularProgressIndicator` المفرد وسط الشاشة، بيحجز نفس
  شكل/مساحة القايمة الحقيقية الجاية (بطاقات نابضة بـ`AnimationController`+`FadeTransition`) —
  بيمنع قفزة تخطيط (layout shift) لحظة وصول البيانات، نفس فلسفة admin's `TableSkeleton`.
- `status_chip.dart`, `confirm_dialog.dart` — جاهزين للاستخدام في دفعات لاحقة (لسه ماتستخدمش في
  الشاشات المحوّلة في الدفعة دي، بس مبنيين ومختبرين تجميعيًا `flutter analyze`).

**`main.dart` (التطبيقين)**: `ThemeData` الافتراضية (بذرة `Colors.deepPurple`/`Colors.teal`
عشوائية من bootstrap أولي) اتستبدلت بـ`AppTheme.light()`/`AppTheme.dark()`.

**11 شاشة اتحوّلت في `apps/customer-app`** (نفس النمط الميكانيكي المتّبع في batches 8-9 —
`CircularProgressIndicator` مفرد وسط قايمة → `LoadingList`، نص "مفيش/لسه" خام → `EmptyState`
بأيقونة مناسبة للسياق):
- `orders/orders_screen.dart` — "لسه ماطلبتش أي حاجة" (أول شاشة اتحوّلت، بروفة قبل الباقي).
- `addresses/addresses_screen.dart` — "مفيش عناوين محفوظة" + وصف "ضيف عنوان عشان تقدر تطلب".
- `catalog/categories_screen.dart`, `catalog/services_screen.dart` — فئات/خدمات فاضية.
- `domestic_workers/domestic_workers_screen.dart`, `worker_bookings_screen.dart` — مقدّمين
  خدمة/حجوزات فاضية.
- `favorites/favorites_screen.dart` — "لسه مفيش فنيين في المفضّلة" + وصف.
- `loyalty/loyalty_screen.dart` — سجل المعاملات بس (رصيد النقاط نفسه فضل `CircularProgressIndicator`
  عادي عمدًا — تحميل بطاقة واحدة مش قايمة، مش نفس السياق).
- `notifications/notifications_screen.dart`, `recurring/recurring_orders_screen.dart`.
- `technicians/technician_selection_screen.dart` — قسم مدمج جوّه صفحة (مش شاشة كاملة)، مع وصف
  "استخدم 'اختار لي تلقائيًا' فوق" يوجّه لزرار موجود فعلاً في نفس الصفحة.

**حالات اتفحصت واتستبعدت عمدًا (قرار تصميمي، مش سهو)**:
- `tracking_screen.dart:137` ("مفيش إحداثيات كافية لعرض الخريطة لسه") — حالة انتقالية مؤقتة فوق
  مكان خريطة، مش قايمة فاضية. صندوق `EmptyState` الكبير هيبان غريب فوق مكان خريطة متوقّع.
  فضلت نص بسيط زي ما هي.
- كل الـ`CircularProgressIndicator` الصغيرة (20×20 أو 16×16 جوّه أزرار "جاري..." أثناء submit)
  — مش سياق قايمة/تحميل صفحة، فضلت زي ما هي (نفس مبدأ استبعاد Admin's inline spinners).
- شاشات تحميل سجل واحد كامل الصفحة (`order_detail_screen`, `technician_profile_screen`,
  `job_details_screen`, `address_form_screen`, `worker_detail_screen`,
  `notification_preferences_screen`, `chat_screen`) — `CircularProgressIndicator` مفرد هنا
  بيمثّل تحميل **سجل واحد** مش **قايمة**، فمش سياق `LoadingList` (اللي مصمم يحجز شكل قايمة
  بطاقات). فضلوا زي ما هما.

**بَقّة بيانات بيئة حقيقية اتلقطت واتصلحت أثناء الاختبار الحي**: أثناء التصفح الحي، فئة خدمة
اختبارية قديمة ("فئة اختبار Playwright") ظهرت **حقيقةً مرئية للعميل** في قايمة الفئات — بيانات
اختبار من دفعة سابقة (مش من السيشن دي) اتسابت من غير `deleted_at` بدل ما تتمسح فورًا بعد
التأكيد (خلاف القاعدة المتّبعة في كل الدفعات). **الإصلاح**: `UPDATE service_categories SET
deleted_at = now()` مباشرة على الصف ده. تذكير للسيشنز الجاية: أي صف تجريبي بيتحقن لازم يتمسح
(أو يتعمله soft-delete) **فورًا** بعد التأكد البصري، مهما كان الاختبار بسيط.

**اتأكد حي بالكامل** عبر `flutter build linux --debug` + `Xvfb`/`fluxbox` + `xdotool` (نفس
منهجية `apps/customer-app/README.md` الموثّقة من قبل) — تسجيل دخول OTP حقيقي كامل (رقم موبايل
حقيقي بصفر طلبات من القاعدة، كود OTP من `/tmp/api-dev.log` الحقيقي)، تصفح لشاشتين مختلفتين
اتحوّلتا فعليًا: `orders_screen` (فاضية) و`addresses_screen` (فاضية) — الاتنين ظهروا بالضبط
زي الكود الجديد (أيقونة + عنوان + وصف، بدون أي قفزة تخطيط). لقطات شاشة (`import -window root`)
بتثبت الرندر RTL/الألوان/الأيقونات صح.

`flutter analyze` (`apps/customer-app`): **27 info بالحرف** (نفس الأساس الموثّق قبل كده، صفر
مشاكل جديدة من تعديلات الدفعة دي).

**مراجعة إضافية لـ`apps/customer-app` (نفس الدفعة)**: `order_detail_screen.dart` (721 سطر) و
`technician_profile_screen.dart` (464 سطر) اتقروا كاملين بحثًا عن حالات فراغ زيادة — طلع إن
الاتنين **مفيهمش أي نص "مفيش/لسه" خام خالص**، كل قسم فيهم أصلاً بيتخفي بالكامل بـ`isNotEmpty`
guard بدل ما يعرض نص بديل. **صفر تحويل مطلوب فعليًا فيهم**، قرار مش سهو.

## دفعة حادية عشر — امتداد نظام التصميم لـ`apps/technician-app` (21 شاشة)، بلا توقف

استكمال مباشر بعد الدفعة العاشرة على نفس المبدأ ("الحاجة اللي تلاقيها موجودة ما تعملهاش تاني،
كمّل عليها"): نفس نمط `EmptyState`/`LoadingList` الميكانيكي اتطبّق على `apps/technician-app` —
21 شاشة موجودة، `lib/design/` كان جاهز من الدفعة العاشرة (نسخة مطابقة حرفيًا)، بس مفيش شاشة
كانت لسه بتستخدمه.

**18 موقع تحويل عبر 15 ملف**: `academy_screen.dart` (كورسات + نتائج اختبارات، حالتين)،
`assistant_offers_screen.dart`، `company_screen.dart` (فروع الشركة، قسم مدمج)،
`worker_home_screen.dart` (حجوزات الشغالة، قسم مدمج)، `payouts_screen.dart`, `wallet_screen.dart`
(حركات المحفظة، قسم مدمج)، `internal_chat_list_screen.dart`، `kpi_screen.dart` (تقييم شهري، قسم
مدمج)، `notifications_screen.dart`، `onboarding_screen.dart` (مستندات مرفوعة، قسم مدمج)،
`available_orders_screen.dart`، `portfolio_screen.dart` (لينكات + تحميلها، حالتين)،
`progression_screen.dart` (تقييم مسار وظيفي + سجل ترقيات، حالتين)، `referral_screen.dart`
(مكافآت، قسم مدمج)، `schedule_screen.dart`.

**نفس معايير الاستبعاد المتّبعة في الدفعة العاشرة، طُبّقت هنا بالحرف**:
- تحميل سجل واحد كامل الصفحة (`_loading`/`summary == null`/`wallet == null`/`me == null` بتاع
  `company_screen`, `progression_screen`, `referral_screen`, `kpi_screen`, `wallet_screen`,
  `worker_home_screen`, `onboarding_screen`) فضل `CircularProgressIndicator` عادي — مش سياق قايمة.
- `chat_screen.dart` و`internal_chat_detail_screen.dart` — تحميل خيط رسائل واحد (thread)، مفيش
  نص "مفيش رسائل" بديل أصلاً (قايمة رسائل فاضية بترجع بلا محتوى، نفس سلوك `customer-app`'s
  `chat_screen.dart` غير الملموس هناك برضه). فضلوا زي ما هما.
- `order_execution_screen.dart:744` ("مفيش أسباب إلغاء متاحة دلوقتي") — نص تحذيري أحمر جوّه خطوة
  Dialog إلغاء مضغوطة، مش قايمة مستقلة. فضل زي ما هو (نفس فلسفة استبعاد الحقول المضغوطة).
- `internal_chat_list_screen.dart:96` ("مفيش رسائل لسه") — subtitle نص جوّه `ListTile`، مش شاشة
  فراغ. فضل زي ما هو.
- `profile_screen.dart` — اتقرا كامل، **صفر نص "مفيش/لسه" خام فيه خالص**، صفر تحويل مطلوب.

**ملحوظة بيئة (مذكورة سابقًا، بتتكرر هنا للسياق)**: `CompromisedDeviceScreen` بيمنع أي اختبار حي
تفاعلي (Xvfb/xdotool) لـ`apps/technician-app` في بيئة السيشن دي تحديدًا — التحويل هنا اتعمل
بمراجعة كود دقيقة (قراءة كل ملف كامل قبل التعديل، مطابقة نفس نمط `customer-app` المؤكَّد حيًا حرفيًا)
+ `flutter analyze` بس، بدون لقطة شاشة حية تأكيدية.

`flutter analyze` (`apps/technician-app`): **10 info بالحرف** (نفس الأساس الموثّق قبل كده، صفر
مشاكل جديدة من تعديلات الدفعة دي).

**نطاق متبقٍ** (Flutter): كل حالات `EmptyState`/`LoadingList` الميكانيكية القابلة للتحويل في
التطبيقين الاتنين اتقفلت فعليًا (batches 10-11). الباقي المتبقي عمدًا: `status_chip.dart`/
`confirm_dialog.dart` جاهزين بس لسه ماتستخدموش (فرصة لدفعة مستقبلية لو ظهر سياق مناسب فعليًا —
مش استبدال قسري لحاجة شغالة أصلاً)، وشاشات تحميل السجل الواحد المستبعدة عمدًا فوق (مرشّحة لنمط
تاني تمامًا زي skeleton كامل الصفحة، مش `LoadingList`، لو المالك طلب ده صراحة لاحقًا).
