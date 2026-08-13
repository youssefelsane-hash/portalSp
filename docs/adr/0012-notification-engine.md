# ADR-0012: محرك إشعارات حقيقي — أولوية/تكرار مُدار من الباك-إند

**الحالة:** معتمد (Phase 1 — الأساس العام + `action_required`)
**التاريخ:** 2026-08-13

## السياق

`docs/08` §15 سجّل طلب صريح من المالك: أربع مستويات أولوية واضحة للإشعارات (`critical_offer`,
`action_required`, `scheduled_job`, `informational`)، كل واحدة بصوت/تكرار/أفعال مختلفة تمامًا،
وأهم حاجة معماريًا: **التكرار لازم يكون backend-driven مش client-only** — لو التطبيق اتقفل أو
اتمسح من الذاكرة، منطق التذكير ميضيعش، لأنه أصلاً مش عايش على الجهاز.

النظام الحالي (`apps/api/src/modules/notifications/`) بيغطي جزء من الاحتياج فعلاً ومختبر حي من
قبل — `NotificationsService.notify()`/`notifyMultiChannel()` (إرسال فعلي متعدد القنوات)،
`NotificationRoutingService.routeToRole()` (توجيه لدور كامل، مش شخص بعينه)، جدول `notifications`
(سجل تسليم — صف واحد لكل محاولة إرسال فعلية، بحالة `queued/sent/delivered/failed/read`). ده **سجل
تسليم مش state machine** — مفيش فيه `priority`/`requires_action`/`next_reminder_at`/`reminder_count`
ولا أي مفهوم "الإشعار ده لسه محتاج رد". ده بالظبط الفجوة المطلوب سدّها.

**مهم**: أنماط التذكير/انتهاء الصلاحية التنافسية (offer expiry) **موجودة بالفعل ومختبرة** في
`MatchingService` (`order_assignments`) و`AssistantMatchingService` (`order_assistant_offers`) —
BullMQ delayed jobs + `jobId` حتمي + إلغاء صريح (`queue.remove()`) عند الحل المبكر. **`critical_offer`
مش كيان جديد يحتاج جدول جديد — هو غلاف تحسين UX/إشعارات فوق البنية دي الموجودة أصلاً**، مش تكرار لها.

## القرار

### 1. مفهومان منفصلان، مش جدول واحد يغطي كل حاجة

- **`critical_offer`** (عروض تنافسية قصيرة العمر — ثواني لدقائق): **مفيش جدول جديد**. البنية
  الموجودة (`order_assignments`/`order_assistant_offers` + BullMQ delayed expiry) كافية تمامًا
  لحفظ الحالة والمهلة. المطلوب فعليًا: (أ) إشعارات actionable حقيقية (أزرار قبول/رفض من داخل
  الإشعار نفسه، بدون فتح التطبيق)، (ب) صوت/قناة مميّزة قابلة للإعداد، (ج) تذكير محدود العدد **داخل
  نافذة العرض نفسها** (مش إشعارات متكررة كل ثواني — نفس تحذير FCM anti-abuse المسجّل في `docs/08`).
  التنفيذ = تحسين على `MatchingService.dispatchNextRound()`/`AssistantMatchingService.broadcastToPool()`
  الموجودين، مش موديول جديد.

- **`action_required` / `scheduled_job`**: **جدول عام جديد `notification_workflows`** — state
  machine حقيقي لأي "حاجة محتاجة تتحل" بشكل عام، مش مقصورة على offer تنافسي. ده اللي مفيش أي بنية
  تحتية له خالص دلوقتي (موافقة Quote، اختيار فني بديل، دفع معلّق، تأكيد شغل مستقبلي).

- **`informational`**: **مفيش جدول تتبّع خالص** — نداء واحد `NotificationsService.notify()` (زي
  ما هو موجود بالفعل)، صف `notifications` واحد، انتهى. مفيش `resolved_at`/`reminder` لأنه أصلاً
  مش محتاج فعل.

### 2. جدول جديد: `notification_type_configs` (إعداد لكل `notification_type`، صفر hardcode)

```sql
CREATE TABLE notification_type_configs (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  notification_type       VARCHAR(60) NOT NULL UNIQUE,
  priority_tier           VARCHAR(20) NOT NULL DEFAULT 'informational'
                           CHECK (priority_tier IN ('critical_offer','action_required','scheduled_job','informational')),
  default_channels        JSONB NOT NULL DEFAULT '["push","in_app"]',
  sound_key                VARCHAR(60) NULL,       -- مرجع صوت/قناة Android على مستوى العميل، مش ملف صوت مخزّن هنا
  is_actionable            BOOLEAN NOT NULL DEFAULT false,
  action_labels            JSONB NULL,              -- {"accept": "قبول", "reject": "رفض"}
  requires_acknowledgment  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

كل `notification_type` string موجود بالفعل في الكود (١٧+ listener، `order_accepted`،
`assistant_opportunity`، إلخ) بياخد صف افتراضي `priority_tier='informational'` وقت الـmigration —
**قرار آمن متعمّد**: مفيش نوع موجود يتحول تلقائيًا لسلوك تكرار/actionable جديد بدون قرار أدمن
صريح لاحقًا، تفاديًا لمفاجأة سلوكية على نظام شغال. الأدمن بعد كده يقدر يرقّي أي نوع لأولوية أعلى
من شاشة إعدادات (نطاق متبقٍ — راجع "الأثر" تحت).

**`NotificationsService`/`NotificationRoutingService` الموجودين بيقروا من الجدول ده وقت الإرسال**
عشان يحددوا القناة الافتراضية/الصوت/هل قابل لفعل مباشر — مفيش أي رقم/قناة hardcoded في الكود.

### 3. جدول جديد: `notification_workflows` (state machine عام لـ`action_required`/`scheduled_job`)

```sql
CREATE TABLE notification_workflows (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id           UUID NOT NULL REFERENCES users(id),
  notification_type VARCHAR(60) NOT NULL,   -- مرجع لـ notification_type_configs.notification_type (بلا FK صريح — نفس فلسفة notifications.notification_type الموجودة، نوع نصّي مفتوح)
  entity_type       VARCHAR(40) NULL,
  entity_id         UUID NULL,
  title_ar          VARCHAR(160) NOT NULL,
  body_ar           TEXT NOT NULL,
  deep_link         VARCHAR(255) NULL,
  requires_action   BOOLEAN NOT NULL DEFAULT true,
  action_type       VARCHAR(60) NULL,
  acknowledged_at   TIMESTAMPTZ NULL,   -- أول ما المستخدم يفتح/يشوف الإشعار (مختلف عن الحل الفعلي)
  resolved_at       TIMESTAMPTZ NULL,   -- أول ما الفعل المطلوب يتم فعليًا
  next_reminder_at  TIMESTAMPTZ NULL,
  reminder_count    INTEGER NOT NULL DEFAULT 0,
  max_reminders     INTEGER NULL,       -- snapshot من الإعداد وقت الإنشاء — تغيير الإعداد بعدين ميأثرش على workflows قايمة بالفعل
  expires_at        TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_workflows_pending_reminders
  ON notification_workflows (next_reminder_at)
  WHERE resolved_at IS NULL;   -- الفهرس اللي الـsweep الدوري (§4) هيعتمد عليه أساسًا

CREATE INDEX idx_notification_workflows_user_id ON notification_workflows (user_id, created_at DESC);
```

`notifications.workflow_id UUID NULL REFERENCES notification_workflows(id)` (عمود جديد على
الجدول الموجود) — كل صف تسليم فعلي (الإرسال الأول + أي تذكير) بيتربط بالـworkflow اللي ولّده،
عشان نقدر نتتبّع "كل مرة بعتنا للمستخدم ده بخصوص الحاجة دي" بدون ما نكرر بيانات العنوان/النص.

### 4. آلية التكرار — Sweep دوري هو الأساسي، مش BullMQ (قرار متعمّد، مبني على درس المشروع نفسه)

**السبب**: `OrderAutoCancelService` (`apps/api/src/modules/orders/order-auto-cancel.service.ts`)
موجود بالفعل ومُوثَّق صراحة في تعليق رأس الملف: بيستخدم `setInterval` (فحص دوري كل 60 ثانية على
Postgres) **بدل** BullMQ delayed job لكل صف، بالظبط عشان يعيش لو الـworker بتاع BullMQ ماعادش يرجع
يشتغل بعد انقطاع Redis طويل (بَقّة حقيقية موثّقة في `apps/api/src/modules/technicians/README.md`،
مطابقة لـGitHub issue #4479 في BullMQ نفسه). `action_required`/`scheduled_job` ممكن يمتدوا لساعات
أو أيام (عكس `critical_offer` اللي دقايق بس) — يعني احتمالية التصادم مع انقطاع Redis طويل أعلى
بكتير، فنفس الدرس ينطبق هنا **بقوة أكبر**.

**القرار**: `NotificationWorkflowReminderService` (نفس نمط `OrderAutoCancelService` بالحرف —
`OnModuleInit`/`OnModuleDestroy`، `setInterval` كل دقيقة، `pessimistic_write` لكل صف وقت المعالجة):
يفحص `notification_workflows WHERE resolved_at IS NULL AND next_reminder_at <= now() AND
(expires_at IS NULL OR expires_at > now())`، يبعت تذكير حقيقي (`NotificationsService.notify()`
بنفس `title_ar`/`body_ar`/`deep_link`، صف `notifications` جديد مربوط بـ`workflow_id`)، يزوّد
`reminder_count`، ويحسب `next_reminder_at` الجديد (أو `null` لو `reminder_count >= max_reminders`
— يبقى الـworkflow "ساكت" بس مش `resolved` حتى ينتهي أو يتحل فعليًا). لو `expires_at` عدّى ومفيش
حل → `resolved_at` بتتحدد تلقائيًا بسبب `expired` (مش نجاح فعل، بس بيوقف التكرار).

**BullMQ لسه مستخدم، بس للحالات قصيرة العمر بس** (`critical_offer` — نفس البنية الموجودة، مفيش
تغيير معماري هنا) — مش لـ`notification_workflows`. قرار غير متماثل عمدًا، مش نسيان.

### 5. عقد التكامل — إزاي فلو موجود "يحل" workflow

`NotificationWorkflowService.resolve(entityType, entityId, actionType)` — idempotent، بترجع
فورًا من غير أي أثر لو مفيش workflow مفتوح مطابق (safe no-op، نفس فلسفة `routeToRole()` اللي
مابترميش استثناء أبدًا). بتتنادى من نقطة اكتمال الفعل الفعلية في الكود الموجود (مثلاً
`OrdersService.approveQuote()`/`declineQuote()`) — سطر واحد إضافي، مش إعادة هيكلة. `acknowledge()`
مشابهة، بتتنادى لما العميل/الفني يفتح تفاصيل الإشعار (`PATCH /notifications/:id/read` الموجود
ينادي عليها لو الصف مرتبط بـworkflow).

### 6. إعدادات جديدة (`settings`, `group_name='notification_engine'`)

- `notification_engine.action_required_reminder_interval_minutes` (افتراضي `60`)
- `notification_engine.action_required_max_reminders` (افتراضي `24`)
- `notification_engine.quiet_hours_start` / `notification_engine.quiet_hours_end` (نص `"HH:MM"`، افتراضي `"22:00"`/`"08:00"`)
- `notification_engine.critical_offer_bypasses_quiet_hours` (bool، افتراضي `true`)

`quiet_hours` بتتفحص جوّه `NotificationWorkflowReminderService` قبل أي إرسال تذكير فعلي (مش عند
الإنشاء) — لو الوقت الحالي جوّه ساعات الهدوء والنوع مش `critical_offer`، التذكير بيتأجل لأول
لحظة بعد نهاية الهدوء (`next_reminder_at` بتتحدث بدل ما تتبعت فورًا)، مش يتلغى بالكامل.

## البدائل اللي اتقيّمت

- **جدول واحد يغطي الأربع أنواع كلهم (بما فيهم `critical_offer`)**: رُفض — كان هيكرر بيانات موجودة
  بالفعل ومختبرة (`order_assignments`/`order_assistant_offers`)، وهيحتاج توفيق حالة بين جدولين
  لنفس العرض (الأصلي + الجديد). التفرقة الحالية أوضح: `critical_offer` = تحسين UX فوق بنية موجودة،
  الباقي = بنية جديدة فعلاً لأنها مش موجودة أصلاً.
- **BullMQ delayed jobs لكل `notification_workflow`** (زي `matching-rounds`): رُفض كآلية أساسية —
  نفس درس `OrderAutoCancelService` بالحرف، مخاطرة أعلى لمدد أطول. ممكن يتضاف لاحقًا **كطبقة تحسين
  دقة فوق الـsweep** (تذكير فوري بدل ما يستنى لحد أقرب دورة sweep)، مش بديل عنه — مؤجّل، مش مطلوب
  للـPhase الأولى.
- **عمود `priority` على جدول `notifications` نفسه**: رُفض — التسليم الفعلي (صف `notifications`)
  مايحتاجش يعرف أولويته بمعزل، هو بيوريث الإعداد من `notification_type_configs` وقت الإرسال. تكرار
  بيانات بلا داعي.
- **`notification_type` كـenum مقفول بدل نص حر**: رُفض — نفس فلسفة الجدول الموجود من قبل (نوع نصّي
  مفتوح)، ولأن `notification_type_configs` نفسه جدول بيانات مش enum، إضافة نوع جديد = صف جديد،
  مش migration.

## الأثر

- Migration جديدة (`0087_notification_engine.sql`): `notification_type_configs` (كامل + seed لكل
  الـ`notification_type` الموجودة بأولوية `informational` افتراضية)، `notification_workflows`
  (كامل)، `notifications.workflow_id` (عمود إضافي)، صفوف `settings` تحت `notification_engine`.
- موديول موجود يتوسّع (`apps/api/src/modules/notifications/`) — `NotificationWorkflowService`
  جديد (create/resolve/acknowledge)، `NotificationWorkflowReminderService` جديد (الـsweep الدوري)،
  entities جديدة (`NotificationTypeConfig`, `NotificationWorkflow`). **مفيش موديول موازٍ جديد** —
  نفس التحذير الموثّق في `docs/08` نفسه ("يوسّع نفس الموديول مش يبني موديول موازي").
- **نطاق Phase 1 (هذا الـADR)**: الأساس العام (schema + service + sweep) + توصيل حالة استخدام
  حقيقية واحدة end-to-end (موافقة Quote — `awaiting_quote_approval`، أنسب مرشّح لأنه موجود بالفعل
  ومختبر، `action_required` نموذجي بالضبط).
- **نطاق متبقٍ صريح، مؤجّل لـPhase لاحقة (مش سهو)**:
  - توصيل `scheduled_job` (تذكيرات ذكية للشغل المستقبلي المؤكَّد — منطق جدولة مختلف عن الفاصل
    الثابت لـ`action_required`، محتاج تصميم إضافي لجدول التذكيرات "فورًا، بعد ساعة، صبح اليوم
    اللي قبله، قبل الموعد بفترة").
  - توصيل باقي حالات `action_required` (اختيار فني بديل، دفع معلّق، رفع مستند، رد الدعم).
  - `critical_offer` actionable push (أزرار قبول/رفض من الإشعار نفسه بدون فتح التطبيق) —
    `Notification Action Buttons`/`UNNotificationAction` محتاجين تغيير في `fcm-push-dispatcher.service.ts`
    + معالج فعل خلفي منفصل، ومحتاجين اختبار على جهاز/إيموليتور حقيقي مش متاح في بيئة السيشن دي.
  - واجهة أدمن لـ`notification_type_configs` (ترقية نوع لأولوية أعلى، تعديل الصوت/القناة) — دلوقتي
    عبر migration/psql بس، زي أي جدول جديد قبل ما تُبنى واجهته.
  - `local_auth`/Face ID للعميل/الفني (مذكور في نفس رسالة المالك بس خارج نطاق محرك الإشعارات —
    غير ذي صلة بالـADR ده، مسجّل في `docs/08` §14 المصاحب).
