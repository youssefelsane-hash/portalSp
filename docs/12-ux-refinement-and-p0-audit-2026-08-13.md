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
