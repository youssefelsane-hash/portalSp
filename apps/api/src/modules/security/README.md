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

**اتأكد كمان حي curl مباشر ضد dev server شغال فعليًا** (السلسلة الكاملة، Part 25 — مش بس
`PermissionsService`/`SecurityEventsService` بمعزل زي الاختبار فوق): موظف حقيقي بدور `support_agent`
(أقرب دور نظامي لـ"Call Center") حاول يمنح نفسه `super_admin` عبر `POST /admin/users/:userId/roles`
فعلي. النتيجة: `403` (رسالة نضيفة، مش stack trace)، الدور فضل `support_agent` زي ما هو في القاعدة
(اتأكد بـ`psql` مباشر)، صف `security_events` واحد اتخلق فعليًا (`privilege_escalation_attempt`،
`critical`، `open`، `actor_user_id = target_user_id`)، **و`notifications` عندها صف حقيقي جديد
لحساب `super_admin` الحقيقي** (`notification_type='security_critical_event'`، `deep_link` بيشاور
على `/security-center/:id`) — يعني السلسلة الكاملة `PermissionsGuard.recordDenial() →
SecurityEventsService (INSERT + emit SECURITY_EVENT_CREATED_EVENT) → SecurityEventRoutingListener
→ NotificationRoutingService.routeToRole('super_admin') → NotificationsService` شغالة حرفيًا من
غير أي mock. بيانات الاختبار اتنضّفت بالكامل بعدها (موظف، صف الحدث، الإشعار، عداد النشاط اليومي).

**بَقّة تشغيلية اتلقطت وقت التحقق ده (مش في كود Script 5)**: أول محاولة استخدمت `dist/main.js`
مبني قديم كان لسه شغال من سيشن سابقة (عملية `node dist/main` منفصلة عن `nest start --watch`،
مامتطبقش عليها `pkill -f "nest start"`) — يعني الطلبات كانت بتتخدم فعليًا بكود من قبل تغييرات
Script 5 كلها، فالحدث الأمني ما كانش بيتسجّل خالص رغم إن الـ403 نفسه رجع صح (نفس المنطق القديم).
اتكشفت لما `security_events` فضلت فاضية بعد الطلب — لازم تتأكد إن `ss -ltnp | grep 3000` بيوريك
عملية `nest start --watch` (مش `node dist/main`) قبل أي تحقق حي، مش بس إن port 3000 بيرد.

## صلاحيات جديدة (migration `0137`)

`security.alerts.view`, `security.alerts.manage`, `security.sessions.revoke`,
`employees.activity.view`, `employees.sessions.view` — كلهم `super_admin` بس افتراضيًا (نفس نمط
`employees.manage`)، قابلين للتوسيع لاحقًا عبر باني الأدوار الديناميكي (ADR-0010) بلا كود جديد.

## لوحة القوى العاملة (Part 2/9، `apps/admin/src/app/employees/workforce/page.tsx`)

استهلاك عرض بس فوق `GET /admin/workforce/summary` الموجود (`getWorkforceSummary()` فوق) —
صفر منطق جديد في الباك-إند لده. جدول واحد: كل موظف عنده `employee_profiles` + حالة حضوره + وقت
عمله الفعلي اليوم + عدد أفعاله + أفعاله الحساسة المرفوضة + تنبيهاته المفتوحة (رابط مباشر لـ
`/security-center?actor_user_id=...`). كارت مختصر في `/employees` (خلف `employees.activity.view`).

## كشف رفض متكرر / تجميع تنبيهات (Part 10) — تصعيدين منفصلين

الـdedup الأساسي فوق (نفس `actor+event_type+action`) بيجمّع الصف بس، مبيصعّدش severity ولا بيبعت
تنبيه تاني. ده كان فجوة حقيقية: موظف بيحاول نفس الفعل الممنوع 20 مرة كان بيولّد صف واحد بـseverity
ثابتة زي أول مرة بالظبط — إشارة "بيصر" مفقودة بالكامل. اتحل بتصعيدين مختلفين في
`SecurityEventsService.recordDenial()`:

1. **تصعيد نفس الحدث** — أول مرة `occurrence_count` يوصل لعتبة (`security.repeated_denial_escalate_
   threshold`، افتراضي 5) والـseverity لسه INFO/WARNING → بيتصعّد لـHIGH، وبيتبعت
   `SECURITY_EVENT_CREATED_EVENT` تاني (مش بس أول إنشاء) عشان Super Admin ياخد تنبيه فعلي، مش
   بس يشوفه لو فتح Security Center بنفسه.
2. **تجميع عبر أفعال مختلفة** (`checkRepeatedDenialBurst()`، method خاصة جديدة) — نفس الفاعل عنده
   N حدث أمني *مفتوح* (أي `event_type`/`action`، مش لازم نفس الفعل) خلال نافذة قصيرة
   (`security.repeated_denial_burst_threshold`/`_window_seconds`، افتراضي 5/900) → حدث
   `REPEATED_PERMISSION_DENIAL` CRITICAL جديد تجميعي (مستبعد من عدّ نفسه — منعاً لحلقة).

**القرار السياقي (Part 10 — "Call Center's high customer-profile access ≠ suspicious")**: الكشف
كله denial-based (403 حقيقي بس)، مش access-volume-based. موظف Call Center بيعمل مئات "عرض
بروفايل عميل" ناجحة (200) يوميًا — دي مصرّح بيها أصلاً، مش هتوصل لـ`recordDenial()` خالص. مفيش
allow-list لأدوار بعينها لازم نصممها/نصونها — التصنيف نفسه هو الحماية من false-positive.

اختبار حي كامل (`security-events-repeated-denial.spec.ts`، 2 سيناريو ضد Postgres حقيقي): (أ) نفس
الفعل يترفض 5 مرات → صف واحد، severity WARNING→HIGH عند العتبة بالظبط. (ب) 5 أفعال مختلفة لنفس
الفاعل خلال النافذة → حدث `REPEATED_PERMISSION_DENIAL` CRITICAL واحد (مش 5).

## اختبارات سباق صريحة (Part 20 A-E، `security-concurrency.spec.ts`)

5 سيناريوهات، كل واحد `Promise.allSettled` حقيقي (مش تتابع) ضد Postgres حي:

- **A — heartbeat متزامن** (5 نداء بالتوازي لنفس المستخدم): `ON CONFLICT (user_id, activity_date)
  DO UPDATE` بيحمي من duplicate rows — اتأكد: صف واحد بس بعد الـ5 نداءات.
- **B — recordDenial متزامن** لنفس `(actor+event_type+action)`: فجوة موثّقة صراحة (سباق نادر ممكن
  يخلّي صفين بدل واحد لو الاتنين نداء وصلوا قبل ما أول UPDATE يتسجّل) — **الضمان الفعلي مش "صف
  واحد دايمًا" لكن "صفر فقدان بيانات"**: مجموع `occurrence_count` عبر كل الصفوف اتأكد = 5 بالظبط
  في كل تشغيلة، بصرف النظر عن عدد الصفوف.
- **C — إلغاء نفس الجلسة بالتوازي** (3 نداء): `UPDATE...WHERE is_revoked=false` شرطي — واحد بس
  بينجح (`affected=1`)، الباقي بيترفض 404 صريح (مش "double revoke" صامت).
- **D — أدمنين مختلفين بيحلّوا نفس التنبيه بالتوازي** (نفس Part 20 اختبار E الأصلي): واحد بس بينجح،
  الباقي 409 — الحماية اللي اتصلحت أصلاً وقت بَقّة الـtuple فوق.
- **E — محاولات تصعيد ذاتي متزامنة** (5 نداء بالتوازي): الضمان الأمني الحرج مش عدد الأحداث بالظبط
  — **صفر نجاح مهما كان السباق**. الاختبار بيتحقق من الـ5 كلهم اترفضوا 403 وصفر تغيير دور نهائي،
  مش من عدد صفوف `security_events` (نفس منطق B — ممكن صف أو أكتر، الحماية الجوهرية مكانها تاني).

## مراجعة أداء (Part 21) — indexes وbounded queries

- `idx_security_events_dedup_lookup (actor_user_id, event_type, action, status, last_occurred_at
  DESC)` (migration `0135`) كافي لـ`recordDenial()` (dedup) **و**`checkRepeatedDenialBurst()`
  (الاستعلامين بادئين بـ`actor_user_id =`) رغم إن كشف التجميع بيستخدم `event_type != ...` (مش
  قابل لتضييق بالإندكس مباشرة) — العمود الأول (`actor_user_id`) كافي لتحديد نطاق صفوف الفاعل
  الواحد بس، وعدد الأحداث المفتوحة لأي فاعل واحد محدود بطبيعته (لو وصل لآلاف يبقى ده نفسه مؤشر
  أخطر بكتير من أي مشكلة أداء). `EXPLAIN ANALYZE` اتأكد محليًا: تكلفة تنفيذ <1ms.
- `getWorkforceSummary()` bounded بعدد موظفي الأدمن (`WHERE u.user_type='admin'`) مش أي جدول
  ضخم — الـsubqueries المرتبطة (`refresh_tokens`/`security_events` لكل صف) بتستخدم
  `idx_refresh_tokens_user_id`/`idx_security_events_target_user` الموجودين أصلاً.
- **صفر query جديد على كل heartbeat غير اللي موجود بالفعل** (نفس فحص Script 2 Part O) —
  `heartbeat()` استعلامين بس (SELECT + UPDATE/INSERT واحد)، مفيش N+1.

## مراجعة خصوصية (Part 3/9) — تأكيد الالتزام بالقيود الصريحة

الالتزام اتفحص عبر كل كود الموديول ده (`recordDenial`, `heartbeat`, `getWorkforceSummary`, DTOs):
**صفر** تسجيل keystroke/screenshot/محتوى شاشة/محتوى شات — `attempted_value` بيسجّل بس قيمة
توضيحية صغيرة (زي `{"attempted_role": "super_admin"}` أو `{"distinct_denials_in_window": 5}`)،
صفر أسرار/توكنات خام فيها. `active_seconds`/`actions_count` أرقام تجميعية بس — مفيش تسجيل *أي*
فعل بعينه بتفاصيله في `employee_daily_activity` (التفاصيل الكاملة في `audit_logs` الموجود
بالفعل، تحت نفس ضوابط الوصول القديمة، مش جدول جديد هنا).

## Script 6 Part 23 — تدقيق حي كامل لكل مسارات الأمان في apps/admin (بعد الشك المعلن إن الشغل "مش شغال فعليًا")

طلب صريح: "لا تفترض إن الـSecurity backend كامل لمجرد إن الـmigrations/services/tests موجودة —
لازم تتأكد من الـAdmin UI نفسه حي." الفحص اتعمل بمتصفح Chromium حقيقي (Playwright) + تسجيل دخول
OTP حقيقي (دور مؤقت `sec_center_tester_tmp` بصلاحيات `audit.view`/`security.*`/`employees.activity.
view`/`employees.sessions.view` بس — **بلا** أي صلاحية من `MFA_REQUIRED_PERMISSIONS`، فتسجيل الدخول
عدّى بـOTP بس من غير WebAuthn، غير super_admin الحقيقي اللي دايمًا محتاج Passkey) — كل بيانات
الاختبار (المستخدم/الدور/الأحداث/الجلسات) اتنضّفت بالكامل بعد الفحص.

| المسار | الحالة | ملاحظات |
|---|---|---|
| `/audit-log` | ✅ شغال | فلترة/pagination شغالين، بيانات حقيقية ظاهرة. |
| `/security` (الأمان والأجهزة) | ✅ شغال | جلسات حقيقية + Passkeys، إلغاء جلسة شغال. |
| `/security-center` (القايمة) | ❌ كان معطوب → ✅ اتصلح | **بَقّة حقيقية**: الصفحة كانت بتكسر بالكامل (شاشة بيضاء تقريبًا، `PAGEERROR: Cannot read properties of undefined (reading 'length')`) — راجع التفصيل تحت. |
| `/security-center/:id` (تفاصيل) | ✅ شغال | acknowledge/investigate/resolve/notes الأربعة اتأكدوا حي (curl + متصفح)، حالة الـ403 (صلاحية ناقصة) بترجع رسالة عربية نضيفة مش كراش. |
| `/employees` | ✅ شغال | |
| `/employees/:userId` (تفاصيل موظف) | ⚠️ بادچ التنبيهات كان مكسور بصمت → ✅ اتصلح | راجع التفصيل تحت — الصفحة نفسها ما كانتش بتكسر، بس البادچ الأحمر "X تنبيه أمني مفتوح" ما كانش بيظهر أبداً حتى لو فيه تنبيهات حقيقية مفتوحة. |
| `/employees/workforce` | ✅ شغال | heartbeat حي من `auth-context.tsx` بيتحدّث فعليًا (اتأكد بمتصفح: "وقت العمل الفعلي" زاد من دقيقة لدقيقة أثناء التصفح). |
| deep link موظف → مركز الأمان (`?actor_user_id=`) | ✅ شغال بعد الإصلاح | اتأكد بالنقر الفعلي على البادچ في متصفح حي — بيوصل للقايمة مفلترة صح. |
| deep link إشعار → `/security-center/:id` | ✅ شغال | اتأكد من صف `notifications` الحقيقي وقت اختبار Script 5 نفسه، وأعيد التأكيد هنا. |

### البَقّة الأولى (الأخطر): `/security-center` بتكسر بالكامل — DTO mismatch

**السبب الجذري**: `GET /admin/security/events` مُقسّم صفحات — `ResponseInterceptor` في `apps/api`
بيكتشف شكل `{items, meta}` اللي بيرجّعه `SecurityEventsService.list()` تلقائيًا وبيفكّه: `envelope.
data` بيبقى الـarray مباشرة، و`envelope.meta` بيتصعّد لمستوى الـenvelope (نفس نمط كل endpoint
مُقسّم صفحات تاني في المشروع، زي `/admin/employees`). الصفحة كانت بتستخدم `authedFetch<{ items:
SecurityEventDto[] }>(...)` (بيرجّع `envelope.data` زي ما هي — array خام) بدل `authedFetchPaginated
<SecurityEventDto>(...)` (بيركّب `{items, meta}` صح من الاتنين) — يعني `res.items` كانت دايمًا
`undefined`، و`events.length` بعدها بيرمي `TypeError` غير ممسوك، فـNext.js بيعرض شاشة خطأ فارغة
تقريبًا. **اتلقطت بمتصفح حي بس** — الـcurl لوحده ما كانش يكشفها (الـAPI response نفسه سليم 100%،
المشكلة في طريقة استهلاكه في الفرونت). الإصلاح: `apps/admin/src/app/security-center/page.tsx`
يستخدم `authedFetchPaginated` دلوقتي.

### البَقّة التانية: بادچ "تنبيه أمني مفتوح" في تفاصيل الموظف بيفشل بصمت

نفس فئة البَقّة بالظبط، بس في `apps/admin/src/app/employees/[userId]/page.tsx` — `authedFetch<{
meta: { total: number } }>(...)` على نفس الـendpoint المُقسّم صفحات. الفرق إن هنا الاستدعاء
داخل `.then()` جوّه `Promise` بـ`.catch(() => setOpenAlertsCount(null))` — فالـ`TypeError` (`res.
meta` = `undefined`) اتبلع بصمت بدل ما يكسر الصفحة، والنتيجة كانت **صمت مش كراش**: البادچ الأحمر
ما كان بيظهرش أبداً حتى لو فيه تنبيهات أمنية حقيقية مفتوحة على الموظف ده — بالظبط النوع من
"blank/missing state من غير أي سبب ظاهر" اللي Part 23 بيحذّر منه. الإصلاح: نفس التبديل لـ
`authedFetchPaginated`. اتأكد حي: البادچ ظهر صح وربط لـ`/security-center?actor_user_id=...` نجح.

### بَقّة أمنية حقيقية إضافية: تسريب `tokenHash` من `GET /admin/workforce/employees/:userId/sessions`

اكتُشفت أثناء نفس الفحص (مش عن طريق المتصفح، عن طريق مقارنة استجابة الـcurl الخام بـ`EmployeeSessionDto`
في `@baytak/shared-types`): `AdminWorkforceController.listSessions()` كان بيرجّع كيان `RefreshToken`
الخام مباشرة — بما فيه `tokenHash` (مُجزّأ، مش التوكن الخام نفسه، لكن برضه مفيش داعي يوصل الواجهة
خالص) وأعمدة داخلية زيادة (`userId`, `deviceId`, `userAgent`, `expiresAt`) مش في الـDTO المُعلن أصلاً.
الإصلاح: `dto/employee-session-response.dto.ts` جديد (`toEmployeeSessionResponseDto()`) بيرجّع
بالظبط شكل `EmployeeSessionDto` — نفس نمط `toAuditLogResponseDto()` الموجود.

**كل الإصلاحات التلاتة اتأكدت حيًا** (curl + Playwright ضد dev server + Postgres حقيقيين، مش
mocks) — لقطات شاشة من الفحص الحي متاحة وقت التنفيذ، مش محفوظة في الـrepo (بيانات اختبار مؤقتة).

## فجوات موثّقة صراحة (باقي عمل Script 5)

- **Retention/archival (Part 22)**: صفر حذف تلقائي — قرار عمل محتاج تأكيد المالك (احتفاظ قانوني/
  تجاري)، موثّق في ADR-0016 كفجوة مؤجلة عمدًا، مش هيُخترع.
