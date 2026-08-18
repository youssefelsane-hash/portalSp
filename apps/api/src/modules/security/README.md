# modules/security

Script 5 (`SONNA3_Admin_Workforce_Security_Operations.md`) — نموذج Security Event المركزي +
نشاط/جلسات الموظفين. القرار المعماري الكامل (ليه موديول مستقل، ليه صف واحد لكل موظف/يوم بدل
heartbeats بلا حدود، ليه `audit_logs` مش كافي وحده) في `docs/adr/0016-security-events-and-employee-activity.md`.
خريطة "إيه اللي موجود فعلاً" قبل أي كود في `docs/19-workforce-security-audit-matrix.md`.

## `security_events` — نموذج الحدث الأمني (Part 5/18/19)

جدول جديد (migration `0135`) — تصنيف (`event_type` enum)، خطورة (`severity`: info/warning/high/
critical)، دورة حياة (`status`: open→acknowledged→investigating→resolved|false_positive)،
تجميع/dedup (`occurrence_count`). **مش بديل عن `audit_logs`** — `audit_logs` فاضل مصدر الحقيقة
التفصيلي الثابت (immutable بتصميمه، `REVOKE UPDATE/DELETE`)، `security_events` تصنيف/lifecycle
فوقه بس. كل استدعاء لـ`recordDenial()` بيسجّل صف `audit_logs` (`action='security.access_denied'`)
**زائد** تجميع/إنشاء صف `security_events` — الاتنين مش أحدهم.

**Dedup (Part 5 §13)**: نفس `(actor_user_id, event_type, action)` جوّه نافذة زمنية قابلة للتعديل
(`security.dedup_window_seconds`، افتراضي 300، عبر `SettingsService` الموجود) → تحديث
`occurrence_count`/`last_occurred_at` بدل صف جديد. تنبيه لحظي (تحت) بيتطلق أول مرة الحدث يتخلق
بس، مش على كل تجميع.

### بَقّة حقيقية اتلقطت واتصلحت وقت الاختبار الحي: `dataSource.query()` بيرجّع tuple لـUPDATE/DELETE

`PostgresQueryRunner.query()` في TypeORM (نسخة `^0.3.20`، `node_modules/typeorm/driver/postgres/
PostgresQueryRunner.js`) بيرجّع `[rows, affectedCount]` — **tuple من عنصرين**، مش مصفوفة الصفوف
مباشرة — لأي استعلام `UPDATE`/`DELETE` (حتى مع `RETURNING`)، بعكس `SELECT`/`INSERT` اللي بترجّع
`rows` مباشرة. الكود الأول كان بيكتب `const existingRows = await manager.query(UPDATE...RETURNING);
if (existingRows.length > 0) return;` — بما إن `existingRows` فعليًا `[rows_array, count]`،
`.length` كانت دايمًا `2` (`> 0`)، يعني **كل استدعاء لـ`recordDenial()` كان بيدخل مسار "already
exists" ويرجع فورًا من غير ما ينشئ أي صف `security_events` خالص** — صفر خطأ ظاهر (الترانزاكشن
بتنجح عادي)، بس صفر أحداث أمنية بتتسجّل فعليًا. نفس البَقّة بالظبط كانت في `resolve()` (`result.length
=== 0` دايمًا `false` لأن الطول دايمًا 2) — يعني **محاولة حل حدث مُقفل بالفعل كانت هتعدّي بصمت
بدل ما ترفض بـ409**، عكس الحماية المطلوبة صراحة في Part 20 اختبار E ("Two admins acknowledge/resolve
same security alert... no silent lost update"). الإصلاح: `const [rows] = await ...query(...)`
(destructure الـtuple) في الاتنين. **اتأكدت حيًا**: `security-events-privilege-escalation.spec.ts`
كان بيفشل بـ`expect(event).toBeDefined() → Received: undefined` قبل الإصلاح، وعدّى 4/4 بعده.

## `employee_daily_activity` — نشاط/جلسات الموظفين (Part 2/4/16)

جدول جديد (migration `0136`) — **صف واحد لكل `(user_id, activity_date)`**، مش صف لكل heartbeat
(نمو محدود = موظفين × أيام، Part 21 "bounded"). `refresh_tokens` (موجود، ADR-0011) فاضل نموذج
"الجلسة" الوحيد — عمود جديد وحيد `last_activity_at` عليه (heartbeat، مختلف عن `last_seen_at`
الموجودة اللي بتتحدّث بس وقت تدوير access token كل ~15 دقيقة).

**حالة الجلسة الحية (ACTIVE/IDLE/OFFLINE)** محسوبة وقت القراءة، مش مخزّنة (`WorkforceActivityService.
getPresence()`):
- **OFFLINE**: صفر `refresh_tokens` نشط للمستخدم.
- **ACTIVE**: فيه جلسة نشطة و`last_activity_at` جوّه العتبة (`workforce.idle_threshold_seconds`،
  افتراضي 300 ثانية، `SettingsService`).
- **IDLE**: فيه جلسة نشطة بس `last_activity_at` أقدم من العتبة (أو مفيش heartbeat لسه).

**خوارزمية وقت العمل الفعلي** (`heartbeat()`): `gap = now - last_activity_at`. لو `gap ≤ العتبة`:
`active_seconds += gap` (نشاط فعلي متصل). لو `gap > العتبة`: الفجوة اتجاهلت (idle حقيقي) — بالظبط
مثال السكريبت (`09:00–10:10 active, 10:10–12:00 idle, 12:00–13:20 active → 2h30m مش 4h20m`).

**فرق متعمّد بين `active_seconds` و`actions_count`**: الأول heartbeat (استخدام عام للنظام، أي
صفحة)، الثاني عدد الأفعال الحساسة (audit-logged) بس — Part 16 بيطلب صراحة التفرقة بين "login
duration / active system time / case work time" بدل ما نسميهم كلهم "ساعات عمل" بلا تمييز.

**ملاحظة معمارية صريحة عن heartbeat وتعدد الأجهزة**: الـaccess token (JWT) مبيحملش session/
refresh-token id — إضافة claim جديد كانت هتلمس إصدار/تحقق التوكن في كل التطبيق (نطاق أكبر من
المطلوب هنا). فـ`refresh_tokens.last_activity_at` بيتحدّث لكل جلسات المستخدم النشطة مع كل heartbeat
(تقريب معقول لو فاتح جهازين، مش دقة مثالية لكل جلسة على حدة) — مصدر الحقيقة الفعلي لحالة
ACTIVE/IDLE/وقت العمل هو `employee_daily_activity` (مستوى المستخدم) اللي دقيق 100%.

## إلغاء جلسة موظف بعينها (Part 6 §16، Part 24 test #15)

كانت فجوة حقيقية: الإلغاء الموجود (`AuthService.revokeSession`) self-service بس (المستخدم بيلغي
جلسته هو)، و`AdminEmployeesService.block()/delete()` بيلغوا **كل** جلسات الموظف دفعة واحدة —
مفيش مسار لأدمن يلغي جلسة واحدة بعينها لموظف تاني. `WorkforceActivityService.revokeEmployeeSession()`
جديدة (نفس نمط `revokeSession` بالضبط، بس `revokedReason='admin_revoked_session'` توضيحي)، محمية
بصلاحية جديدة `security.sessions.revoke`.

## تنبيهات Super Admin اللحظية (Part 6) — إعادة استخدام محرك الإشعارات الموجود

`SecurityEventRoutingListener` (في `notifications/listeners/`، **مش هنا** — نفس مكان كل
الـrouting listeners التانية زي `emergency-order-routing.listener.ts`) بيسمع
`SECURITY_EVENT_CREATED_EVENT` وبينادي `NotificationRoutingService.routeToRole()` الموجودة —
صفر قناة إشعارات جديدة. صف توجيه جديد بس (`security.critical_event → super_admin`، migration
`0137`) في `notification_routing_rules` الموجود، قابل للتعديل من `/admin/notification-routing-rules`
بلا أي كود إضافي. HIGH/CRITICAL بس بيوصل تنبيه — INFO/WARNING بيتسجّلوا في `security_events`
للمراجعة بس صفر إزعاج (Part 5 §11: "مش كل رفض محتاج تنبيه").

## ربط نقاط الرفض — الـGuards الموجودة، صفر Guard جديد

`PermissionsGuard`/`StepUpGuard` (`common/guards/`، global، موجودين) بياخدوا حقن اختياري
لـ`SecurityEventsService` — عند الرفض، بيسجّلوا الحدث **قبل** ما يرموا نفس `ApiException` زي ما
هي بالظبط (صفر تغيير في رسالة/سلوك الـ403 الحالي، صفر خطر على الاختبارات الموجودة). تصنيف الخطورة:

- `PermissionsGuard`: لو الصلاحية المطلوبة `roles.manage`/`roles.grant_unrestricted` **والهدف
  (`params.userId`) هو الفاعل نفسه** → `PRIVILEGE_ESCALATION_ATTEMPT`/CRITICAL (السيناريو
  المحوري في Part 24 test #1 — "Call Center attempts to assign self Super Admin"). لو الهدف مستخدم
  تاني → `UNAUTHORIZED_ROLE_CHANGE`/HIGH. لو الصلاحية من `MFA_REQUIRED_PERMISSIONS` (فلوس/أمان) →
  `SENSITIVE_ACTION_DENIED`/HIGH. غير كده → INFO.
- `StepUpGuard`: `SENSITIVE_ACTION_DENIED`/WARNING (مش تصعيد بالضرورة — ممكن مستخدم شرعي لسه
  مبعتش step-up، التكرار بيتصعّد أهميته أوتوماتيك عن طريق الـdedup).
- `PermissionsService.assertActorIsSuperAdminOrThrow`/`assertActorCanGrantPermissions` — نفس
  التصنيف (self=CRITICAL، غير كده=HIGH) لكن للحالة الأعمق: الفاعل عنده `roles.manage` فعلاً
  (عدّى الـGuard) بس بيحاول يمنح/ينسخ دور/صلاحية فوق نطاقه (Part 24 test #3 — "Manager tries
  granting permission above allowed grant scope").

## اختبار حي (`security-events-privilege-escalation.spec.ts`)

ضد Postgres حقيقي — 4 سيناريوهات: (1) تصعيد ذاتي حرفي لـ`super_admin` → 403 + صفر تغيير دور +
حدث CRITICAL. (2) نفس المحاولة تاني جوّه نافذة الـdedup → نفس الصف بيتجمّع (`occurrence_count=2`)
مش صف جديد. (3) تصعيد لمستخدم تاني → حدث HIGH (مش CRITICAL). (4) دورة حياة acknowledge→resolve،
ومحاولة تحل حدث مُقفل بالفعل بترفض 409. الأربعة عدّوا 4/4 بعد إصلاح بَقّة الـtuple فوق.

**اتأكد كمان حي curl مباشر** ضد dev server شغال فعليًا (الجزء اللي مسؤول عنه محرك التوجيه/الإشعارات
الكامل، Part 25) — تفاصيل في `orders/README.md`... **لسه مطلوب، شوف task القادمة**.

## صلاحيات جديدة (migration `0137`)

`security.alerts.view`, `security.alerts.manage`, `security.sessions.revoke`,
`employees.activity.view`, `employees.sessions.view` — كلهم `super_admin` بس افتراضيًا (نفس نمط
`employees.manage`)، قابلين للتوسيع لاحقًا عبر باني الأدوار الديناميكي (ADR-0010) بلا كود جديد.

## فجوات موثّقة صراحة (باقي عمل Script 5)

- **Retention/archival (Part 22)**: صفر حذف تلقائي — قرار عمل محتاج تأكيد المالك (احتفاظ قانوني/
  تجاري)، موثّق في ADR-0016 كفجوة مؤجلة عمدًا، مش هيُخترع.
- **Repeated-denial detection السياقي (Part 8 §18، Part 17)**: الـdedup الحالي بيجمّع أي تكرار
  مطابق، بس صفر "كشف نمط" واعي بالسياق (زي "Call Center بيشوف بروفايلات كتير طبيعي، لكن يحاول
  يعتمد صرف مش طبيعي") — لسه مطلوب بناؤه.
- **Security Center UI + Workforce UI extensions (Part 7/8/11/12)**: لسه مطلوب في `apps/admin`.
- **Concurrency tests صريحة (Part 20 A-E)**: dedup/resolve اتأكدوا منطقيًا (اختبار #2/#4 فوق)، بس
  صفر اختبار `Promise.allSettled` صريح لسباق حقيقي على `resolve()`/`recordDenial()` لسه.
