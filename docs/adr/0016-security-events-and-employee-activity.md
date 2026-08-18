# ADR-0016: Security Events + Employee Session/Activity Model

**الحالة:** معتمد
**التاريخ:** 2026-08-18

## السياق

`SONNA3_Admin_Workforce_Security_Operations.md` بيطلب: (1) رؤية تشغيلية لجلسات/نشاط الموظفين
(حالة حية ACTIVE/IDLE/OFFLINE، وقت عمل فعلي مش login-to-logout خام)، (2) نموذج "Security Event"
مصنّف بـseverity/lifecycle قابل للتجميع (dedup) لمنع تصعيد الصلاحيات والأفعال الحساسة المرفوضة،
(3) تنبيهات لحظية لـSuper Admin عند حدث حرج، (4) Security Center UI.

**Part 1 من السكريبت نفسه بيفرض تدقيق شامل قبل أي كود** (تفاصيل كاملة في
`docs/19-workforce-security-audit-matrix.md`) — الخلاصة: **17 من 27 قدرة مطلوبة موجودة ومختبرة
بالفعل** (RBAC الديناميكي ADR-0010، منع تصعيد الصلاحيات، step-up MFA، الجلسات عبر
`refresh_tokens`، سجل تدقيق append-only، محرك إشعارات بالتوجيه بالدور، إلغاء وصول لحظي عبر
REST/JWT/**WebSocket** (migration `0123` + `RealtimeSessionRegistry` — موجود ومختبر بالفعل، بيغطي
Part 6 §17 وPart 24 test #9 من غير أي عمل جديد)). **7 قدرات مفقودة فعليًا**: حالة جلسة حية +
وقت عمل، نموذج Security Event كامل، ربط نقاط الرفض به، تنبيهات لحظية، Security Center UI.

هذا ADR بيغطي الـschema الجوهري الجديد بس (القرار المعماري) — تفاصيل الـUI/الاختبارات في
READMEs الموديولات وقت التنفيذ.

## القرار

### 1. مفيش `employee_sessions` جديد — `refresh_tokens` هو نموذج الجلسة الوحيد

السكريبت نفسه بيحذّر صراحة: "Do NOT automatically create `employee_sessions`... without first
verifying equivalents." `refresh_tokens` (موجود من `0003_auth.sql`، مُوسّع بـ`last_seen_at`/`amr`
في ADR-0011) **هو** نموذج الجلسة — صف واحد لكل جلسة دخول، فيه `device_name`/`device_platform`/
`ip_address`/`amr`/`is_revoked`/`revoked_reason`/`expires_at`/`created_at`. كل ما هيتضاف: عمود
واحد جديد `last_activity_at` (heartbeat، مختلف عن `last_seen_at` الموجود اللي بيتحدّث بس وقت
تدوير access token كل ~15 دقيقة — heartbeat هيتحدّث كل دقيقة أثناء الاستخدام الفعلي من apps/admin).

### 2. حالة الجلسة (ACTIVE/IDLE/OFFLINE) — محسوبة، مش مخزّنة

صفر عمود "status" في القاعدة. الحالة بتتحسب وقت القراءة من `last_activity_at` مقابل عتبة
idle قابلة للتعديل (`SettingsService`، مفتاح `workforce.idle_threshold_seconds`، افتراضي 300 —
نفس نمط `orders.no_show_visit_fee_cents` الموجود):
- **OFFLINE**: صفر `refresh_tokens` نشط (`is_revoked=false AND expires_at > now()`) للمستخدم.
- **ACTIVE**: فيه جلسة نشطة و`last_activity_at` جوّه العتبة.
- **IDLE**: فيه جلسة نشطة بس `last_activity_at` أقدم من العتبة (أو `null` — سجّل دخول بس لسه
  مبعتش heartbeat).

قرار واعي: **مفيش state machine مخزّنة ولا جدول transitions** — الحالة مشتقة دايمًا من `now()`،
زي فلسفة `PermissionsGuard` بالظبط (فحص حي مش snapshot). أبسط وأصح، صفر خطر عدم اتساق.

### 3. جدول جديد وحيد: `employee_daily_activity` (وقت العمل الفعلي + ملخص يومي)

**البديل المرفوض**: تسجيل كل heartbeat كصف منفصل (`employee_heartbeats`) — السكريبت نفسه بيحذّر
صراحة ("Do not create excessive write traffic") وبيطلب "bounded aggregation" (Part 21). صف لكل
heartbeat يعني ملايين الصفوف بسرعة (موظف واحد شغال 8 ساعات بheartbeat كل دقيقة = 480 صف/يوم).

**القرار**: صف واحد بس لكل `(user_id, activity_date)` — `UNIQUE(user_id, activity_date)`،
`UPSERT` (`ON CONFLICT DO UPDATE`) على كل heartbeat/فعل حساس. الأعمدة:

```
id, user_id, activity_date (date)
first_login_at, last_login_at, last_activity_at, last_logout_at   -- timestamptz nullable
active_seconds        integer default 0   -- متراكم من heartbeat gaps
sessions_count        integer default 0   -- جلسات جديدة بدأت النهاردة
actions_count         integer default 0   -- أفعال حساسة (audit-logged) النهاردة
denied_sensitive_count integer default 0  -- رفض فعل حساس النهاردة
created_at, updated_at
```

**خوارزمية وقت العمل الفعلي**: عند كل heartbeat (`POST /admin/workforce/heartbeat`، مرة كل دقيقة
من `apps/admin` أثناء الـtab نشط بس — `document.visibilitychange`/`Page Visibility API`، مش
setInterval أعمى حتى لو التاب في الخلفية): `gap = now - last_activity_at`. لو `gap <= idle
threshold`: `active_seconds += gap` (تراكم الفجوة كنشاط فعلي). لو `gap > threshold`: الفجوة دي
idle، ماتتضافش. ده بالظبط مثال السكريبت (`09:00–10:10 active, 10:10–12:00 idle, 12:00–13:20
active → 2h30m مش 4h20m`) — الـidle gap ببساطة معندهوش مساهمة، صفر جدول intervals منفصل مطلوب.

**عدد الكتابات**: heartbeat واحد بالكتير كل دقيقة لكل موظف نشط فعليًا (مش كل ثانية)، UPSERT صف
واحد (indexed بـPK مركّب) — مش استعلام تجميعي ثقيل. يوميًا صف واحد جديد لكل موظف (مش لكل جلسة) —
نمو الجدول = عدد الموظفين × عدد الأيام، **محدود وقابل للتنبؤ** (Part 21 "bounded").

### 4. جدول جديد: `security_events` (النموذج المركزي المطلوب في Part 5)

```
id, event_type (enum), severity (enum: info/warning/high/critical)
status (enum: open/acknowledged/investigating/resolved/false_positive)
actor_user_id, actor_role, target_user_id (nullable), target_type/target_id (nullable, generic)
session_id (refresh_token id, nullable), ip_address (inet, nullable)
action (varchar — اسم الصلاحية/الفعل المحاول، زي 'roles.assign')
attempted_value (jsonb, صغير، بلا أسرار — زي {attempted_role: 'super_admin'})
occurrence_count integer default 1        -- تجميع (Part 5 §13)
first_occurred_at, last_occurred_at timestamptz
acknowledged_by_user_id/at, resolved_by_user_id/at, resolution_note
created_at, updated_at
```

**Event types** (enum Postgres، قابل للتوسيع بـmigration لاحقة زي أي enum تاني في المشروع):
`privilege_escalation_attempt`, `unauthorized_role_change`, `unauthorized_permission_grant`,
`repeated_permission_denial`, `mfa_failure_burst`, `sensitive_action_denied` (catch-all عام لأي
`@RequirePermission` مرفوض مش داخل تحت نوع أدق)، `session_reuse_after_revoke`,
`blocked_account_access_attempt`, `security_setting_change`.

**Dedup/aggregation (Part 5 §13)**: نفس `(actor_user_id, event_type, action, target_user_id)`
جوّه نافذة زمنية قابلة للتعديل (`security.dedup_window_seconds`، افتراضي 300) → `UPDATE
security_events SET occurrence_count = occurrence_count + 1, last_occurred_at = now() WHERE ...
AND status='open' AND last_occurred_at > now() - interval` بدل صف جديد. **السجل التفصيلي الكامل
فاضل في `audit_logs`** (append-only، صفر فقدان تفاصيل) — `security_events` تجميع/تصنيف بس، مش
بديل عن audit trail، بالظبط زي ما Part 5 §13 بيطلب صراحة ("Keep detailed underlying audit
events, but aggregate/dedupe security alerts").

**Lifecycle** (Part 19): `open → acknowledged → investigating → resolved|false_positive`،
انتقالات بتتسجّل بـ`acknowledged_by/at`/`resolved_by/at` — تاريخ الحالة الكامل مش مطلوب في جدول
منفصل، الحقول دي كافية (نفس مستوى تفصيل موجود في نماذج حالة تانية بالمشروع، زي `complaints`).

**جدول ملاحظات منفصل**: `security_event_notes (id, security_event_id, author_user_id, note,
created_at)` — append-only (Part 18: "Do not overwrite prior investigation notes").

### 5. تنبيهات Super Admin — إعادة استخدام `notification_routing_rules` بلا أي تعديل بنيوي

Listener جديد (`security-event-routing.listener.ts`) بنفس نمط `emergency-order-routing.listener.ts`
بالحرف — بيسمع `SECURITY_EVENT_CREATED_EVENT` (EventEmitter2، مُطلَق بس أول مرة الحدث يتخلق أو
severity بيتصعّد، مش على كل increment تجميع) وبينادي `NotificationRoutingService.routeToRole()`
الموجودة. Migration seed جديدة بتضيف صف `('security.critical_event', 'super_admin', '["in_app"]')`
في `notification_routing_rules` — **مش قناة إشعارات جديدة**، صف بيانات إضافي في الجدول الموجود،
قابل للتعديل من `/admin/notification-routing-rules` الموجودة أصلاً بلا أي كود إضافي.

### 6. صلاحيات جديدة (نمط `X.manage`/`X.view` الموجود، صفر ابتكار)

`security.alerts.view`, `security.alerts.manage` (acknowledge/resolve/assign/note/revoke-from-alert)،
`security.sessions.revoke` (إلغاء جلسة موظف تاني بعينها — endpoint إداري جديد يعيد استخدام
`AuthService.revokeSession`)، `employees.activity.view`, `employees.sessions.view` (الفصل ده
مقصود — مدير يقدر يشوف نشاط بلا تفاصيل جلسات حساسة، أو العكس، حسب الدور). كلهم `super_admin` بس
افتراضيًا في البذر (نفس نمط `employees.manage`)، قابلين للتوسيع لاحقًا عبر باني الأدوار
الموجود بلا أي كود جديد.

### 7. ربط نقاط الرفض — الـGuards الموجودة، صفر Guard جديد

`PermissionsGuard`/`StepUpGuard` (global، موجودين) بياخدوا حقن `SecurityEventsService` اختياري
(constructor injection عادي) — عند الرفض، بينادوا `recordDenial(...)` (try/catch، فشل تسجيل
الحدث الأمني **مايمنعش** الـ403 الأصلي من الحدوث، نفس فلسفة `AuditLogService.record()` non-blocking
الموجودة) قبل ما يرموا نفس `ApiException` زي ما هي بالظبط — **صفر تغيير في سلوك الـ403 الحالي
ولا رسالته**، فصفر خطر على مئات الاختبارات الموجودة اللي بتتأكد من رسائل 403 بالحرف.
`PermissionsService.assertActorIsSuperAdminOrThrow`/`assertActorCanGrantPermissions` بياخدوا نفس
الحقن، بيسجّلوا `privilege_escalation_attempt` (CRITICAL لو الهدف الفاعل نفسه، وإلا
`unauthorized_role_change`/`unauthorized_permission_grant` بـHIGH) قبل ما يرموا.

## البدائل اللي اتقيّمت

- **جدول `employee_heartbeats` (صف لكل نبضة)**: رُفض — نمو غير محدود، السكريبت بيحذّر صراحة منه.
- **حساب وقت العمل من `audit_logs` فقط (بلا heartbeat)**: رُفض — `audit_logs` بيسجّل بس أفعال
  حساسة صريحة، موظف بيشتغل بصفحات قراءة عادية (مراجعة طلبات، شات) مالوش أي أثر فيه — "وقت العمل"
  هيبقى صفر كذب لموظف شغال فعليًا. الـheartbeat مطلوب لقياس "استخدام حقيقي" مش "فعل حساس بس".
  فرّقنا بينهم عمدًا: `active_seconds` (heartbeat، وقت استخدام عام) مقابل `actions_count`
  (audit، أفعال حساسة تحديدًا) — عمودين منفصلين لمعنيين مختلفين، بالظبط زي Part 16 بيطلب
  ("Differentiate: LOGIN DURATION / ACTIVE SYSTEM TIME / CASE WORK TIME / SHIFT HOURS").
- **استخدام `refresh_tokens` نفسها لتخزين `active_seconds`/عداد يومي**: رُفض — الجلسة الواحدة
  (`refresh_token` row) ممكن تمتد لأيام (توكن صالح لمدة طويلة قبل التدوير)، بينما "وقت العمل
  اليومي" مفهوم **يومي** بطبيعته يمتد عبر جلسات متعددة أو يوم واحد بجلسة واحدة — عمود على مستوى
  الجلسة مش هيعبّر عن المفهوم صح. جدول منفصل `(user_id, activity_date)` هو التمثيل الصحيح.
- **security_events كجزء من `audit_logs` نفسه (عمود severity/status إضافي)**: رُفض —
  `audit_logs` immutable بتصميمه (REVOKE UPDATE/DELETE على مستوى القاعدة، migration `0011`) —
  الـlifecycle (`acknowledged`→`resolved`) يحتاج UPDATE بطبيعته. خلط الاتنين كان هيكسر الضمان
  الأساسي لـ`audit_logs` (append-only حقيقي) أو يمنع الـlifecycle المطلوب. جدول منفصل + ربط
  منطقي (نفس `actor_user_id`/`action`/الوقت) هو الفصل الصح.
- **كاش/جدول منفصل لحالة ACTIVE/IDLE/OFFLINE**: رُفض — الحالة محسوبة من بيانات موجودة (`refresh_
  tokens` + `employee_daily_activity.last_activity_at`)، تخزينها منفصل يعني احتمال عدم اتساق
  (نفس القرار المتخذ في ADR-0010 §9 لصالح "فحص حي بدل snapshot مخزّن").

## الأثر

- Migrations جديدة (تبدأ من `0135`): enum types (`security_event_type`, `security_event_severity`,
  `security_event_status`)، `security_events`، `security_event_notes`، `employee_daily_activity`،
  `refresh_tokens.last_activity_at` (عمود إضافي)، صلاحيات `security.*`/`employees.activity.view`/
  `employees.sessions.view`، seed routing rule.
- موديول جديد `modules/security` (أو امتداد `modules/audit` — قرار تنفيذي وقت الكود، الأقرب
  معماريًا موديول مستقل بما إنه بيغطي domain مختلف عن audit البسيط): `SecurityEventsService`،
  `WorkforceActivityService`، controllers جديدة تحت `/admin/security/*` و`/admin/workforce/*`.
- `PermissionsGuard`/`StepUpGuard`/`PermissionsService`: حقن اختياري جديد، صفر تغيير في التوقيع
  العام أو سلوك الرفض الحالي.
- `apps/admin`: صفحة Security Center جديدة + تبويبات إضافية في صفحة تفاصيل الموظف.
- **Retention (Part 22)**: مفيش حذف تلقائي — قرار عمل محتاج تأكيد المالك (احتفاظ قانوني/تجاري)،
  موثّق صراحة كفجوة مؤجلة عمدًا، مش هيُخترع.
