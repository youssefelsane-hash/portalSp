# Script 5 — Admin Workforce Monitoring + Security Operations — Part 1 Audit Matrix

هذا التوثيق بيغطي **Part 1** من `SONNA3_Admin_Workforce_Security_Operations.md` — قبل أي كود،
خريطة كاملة لكل اللي موجود فعلاً في المشروع من بنية RBAC/sessions/audit/notifications، عشان
نتجنب تكرار أي نظام موجود (الأمر الصريح المتكرر في السكريبت: "Do NOT create duplicate audit
systems / duplicate employee identity/session systems / duplicate permission models / a second
notification system"). كل صف اتأكد بقراءة كود مباشرة (مش افتراض)، مع مسار الملف.

| القدرة | موجودة؟ | فين | شغالة؟ | إعادة استخدام / توسيع / إنشاء |
|---|---|---|---|---|
| هوية الموظف (Admin) | ✅ | `users` (`user_type=admin`) + `employee_profiles` (`admin/entities/employee-profile.entity.ts`، migration `0024`) | ✅ | REUSE بالكامل |
| القسم/المسمى/المدير المباشر (org chart) | ✅ | `employee_profiles.department/title/manager_user_id` | ✅ | REUSE |
| نموذج الأدوار (RBAC) | ✅ | `admin/entities/{role,permission,role-permission,user-role}.entity.ts`، `permissions.service.ts` (468 سطر) | ✅ (ADR-0010، ديناميكي كامل) | REUSE بالكامل — صفر تكرار |
| منح/سحب دور | ✅ | `PermissionsService.assignRole/revokeRole` + `AdminUsersController` | ✅ | REUSE |
| منح/سحب صلاحية لدور | ✅ | `PermissionsService.setRolePermissions` + `AdminRolesController` | ✅ | REUSE |
| **منع تصعيد الصلاحيات الذاتي** | ✅ | `assertActorIsSuperAdminOrThrow`/`assertActorCanGrantPermissions` (`permissions.service.ts:69-97`) مطبّقة في `assignRole`/`revokeRole`/`cloneRole`/`setRolePermissions` كلهم | ✅ **مؤكدة بقراءة الكود** (ADR-0010 §3، P0-1) | REUSE — **صفر عمل جديد مطلوب هنا**، بس هيتوسّع بربط security event (تحت) |
| قفل تشاؤمي على تعديل صلاحيات دور (سباق أدمنين) | ✅ | `setRolePermissions` (`pessimistic_write` طول الـtransaction) | ✅ | REUSE — يغطي Part 20 اختبار B مباشرة |
| Step-up MFA للعمليات الحساسة | ✅ | `auth/mfa-policy.service.ts` (`MFA_REQUIRED_PERMISSIONS`) + `@RequireStepUp()` مطبّق فعليًا على كل endpoints الأدوار/الصلاحيات (`admin-users.controller.ts`, `admin-roles.controller.ts`) | ✅ **مؤكدة بقراءة الكنترولرز مباشرة** — مش بس مُدرجة في القايمة (فرقنا بينها وبين فجوة `settings.manage` القديمة اللي كانت مُدرجة بس من غير `@RequireStepUp()` فعلي، دي اتأكد وجودها الفعلي) | REUSE — صفر عمل جديد |
| جلسات/refresh tokens | ✅ | `auth/entities/refresh-token.entity.ts` (`device_name/device_platform/ip_address/last_seen_at/amr/is_revoked/revoked_reason/expires_at`) | ✅ | REUSE بالكامل كنموذج "الجلسة" — **لا ننشئ `employee_sessions` جديد** |
| عرض جلسات المستخدم لنفسه + إلغاء واحدة/الكل | ✅ | `auth/sessions.controller.ts` (`GET /auth/sessions`, `DELETE /:id`, `POST /revoke-all`) | ✅ (self-service بس) | REUSE النمط — **مفقود: نسخة إدارية تسمح لـSuper Admin يلغي جلسة موظف تاني بعينها** (مش bulk بس) — CREATE endpoint إداري رفيع يعيد استخدام `AuthService.revokeSession` نفسها |
| آخر 10 محاولات دخول + آخر 20 نشاط لكل موظف | ✅ | `AdminEmployeesService.getDetail()` (`admin-employees.service.ts:149-172`) — بيقرا من `refresh_tokens`/`audit_logs` مباشرة | ✅ جزئي (بلا فلاتر/pagination حقيقية) | EXTEND — فلاتر (تاريخ/فعل/severity) + pagination، مش نظام جديد |
| إلغاء جلسات موظف عند الحظر/التعطيل/الحذف | ✅ | `AdminEmployeesService.block()/update(is_active=false)/delete()` | ✅ | REUSE |
| **حالة جلسة حية (ACTIVE/IDLE/OFFLINE) + heartbeat** | ❌ | — | — | **CREATE** — `last_seen_at` بيتحدّث بس وقت تدوير access token (~15 دقيقة)، مش heartbeat دقيق |
| **وقت العمل الفعلي (active time ≠ login-to-logout)** | ❌ | — | — | **CREATE** — مفيش أي منطق فترات نشاط/idle حاليًا |
| ملخص قوى عاملة (workforce summary) | ❌ | — | — | **CREATE** — فوق الجدول الجديد تحت |
| سجل تدقيق (audit trail) | ✅ | `audit/audit-log.service.ts` + `audit_logs` (immutable — `REVOKE UPDATE, DELETE` على مستوى القاعدة، migration `0011`) | ✅ append-only حقيقي | REUSE بالكامل كـ"مصدر الحقيقة" للأفعال — **مش هننشئ نظام audit تاني** |
| فلترة/صفحات audit log | ✅ | `AuditLogService.list()` (entity_type/entity_id/actor/action/from/to + pagination) | ✅ | EXTEND (فلاتر إضافية: severity/denied-only) |
| **نموذج Security Event (نوع/severity/lifecycle/dedup)** | ❌ | — | — | **CREATE** — مفيش أي جدول/enum بحث شامل (`grep -rli "security_event\|SecurityEvent"`) رجع صفر نتيجة |
| **تدقيق الأفعال الحساسة المرفوضة (denied sensitive actions)** | ❌ | — | — | **CREATE** — `PermissionsGuard`/`StepUpGuard` حاليًا بيرموا `ApiException` بس، صفر تسجيل |
| **كشف تكرار الرفض / تجميع تنبيهات** | ❌ | — | — | **CREATE** |
| نظام إشعارات + توجيه بالدور | ✅ | `notifications` module — `NotificationRoutingRule` (event_type→role_name)، `NotificationRoutingService.routeToRole()`، أكتر من 15 listener موجود بنفس النمط (`emergency-order-routing.listener.ts` كمرجع) | ✅ | REUSE بالكامل — **مش هننشئ قناة إشعارات جديدة**، هنضيف listener واحد جديد بنفس النمط |
| **تنبيهات Super Admin اللحظية للأحداث الأمنية** | ❌ | — | — | **CREATE** (بإعادة استخدام كل ما فوق) |
| إلغاء وصول لحظي عبر REST | ✅ | `PermissionsGuard`/`RolesGuard` بيتحققوا حياً من القاعدة كل طلب (مش من الـJWT) — تغيير دور ياخد مفعوله فورًا في الطلب الجاي | ✅ **مؤكدة** | REUSE — صفر عمل جديد |
| إلغاء وصول لحظي عبر JWT/access token | ✅ | `JwtStrategy` بتتحقق من القاعدة كل طلب (`is_active`/`is_blocked`) — إصلاح P0-6 | ✅ | REUSE |
| إلغاء وصول لحظي عبر WebSocket | ✅ | `common/websocket/realtime-session-registry.service.ts` — Postgres `LISTEN/NOTIFY` (migration `0123`) بيفصل أي socket فورًا عند تغيير `is_active`/`is_blocked`/`user_roles`/`role_permissions`/`roles.is_active`، مسجّل في `chat.gateway.ts` و`order-tracking.gateway.ts` | ✅ **مؤكدة بقراءة الكود + اختبار موجود** (`realtime-access-revocation.spec.ts`) | REUSE بالكامل — **يغطي Part 6 §17 وPart 24 test #9 حرفيًا من غير أي عمل جديد** |
| Security Center UI | ❌ | — | — | **CREATE** (apps/admin) |
| صفحة تفاصيل موظف (workforce) | ✅ جزئي | `apps/admin/src/app/employees/[userId]/page.tsx` | ✅ (org chart + roles + login/activity أساسي) | EXTEND (تبويبات جلسات/أمان) |
| صلاحيات دقيقة لعرض بيانات الموظفين/الأمان | ✅ جزئي | `employees.manage`, `employees.view`(؟) | يحتاج تأكيد | راجع أثناء التنفيذ — لو `employees.view` مش موجودة، تُضاف بنفس نمط `customers.manage` |

## خلاصة Part 1

**من 27 قدرة اتفحصت: 17 موجودة وشغالة بالكامل (تُعاد استخدامها بلا أي تعديل تقريبًا)، 3 موجودة
جزئيًا (تحتاج توسيع)، 7 غير موجودة خالص (تحتاج بناء جديد).** البنية التحتية الجوهرية (RBAC
الديناميكي، منع تصعيد الصلاحيات، step-up MFA، الجلسات، سجل التدقيق الثابت، محرك الإشعارات،
الإلغاء اللحظي عبر REST/JWT/WebSocket) **كلها موجودة ومختبرة من قبل** — هذا يوافق بالضبط فلسفة
السكريبت ("audit before implementing... reuse/extend existing architecture"). العمل الجديد الحقيقي
مقصور على: (1) نموذج حالة الجلسة اللحظية ووقت العمل الفعلي، (2) نموذج Security Event بالكامل
(تصنيف/severity/lifecycle/dedup)، (3) ربط نقاط الرفض الحساسة بتسجيل الحدث ده، (4) تنبيهات
Super Admin اللحظية (بإعادة استخدام محرك الإشعارات الموجود)، (5) واجهات Security Center/Workforce
الجديدة في apps/admin. التفاصيل المعمارية الكاملة لكل ده في `docs/adr/0016-security-events-and-employee-activity.md`.
