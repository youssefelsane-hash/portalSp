# ADR-0010: باني أدوار ديناميكي (Dynamic Role Builder) فوق نظام RBAC الموجود

**الحالة:** معتمد
**التاريخ:** 2026-08-13

## السياق

المالك حسم (`docs/11-qr-referral-kpi-career-rbac-2026-08-13.md`) إن باني الأدوار الديناميكي (بند 43
في `docs/10`) أولوية عالية، ولازم ADR قبل أي كود لأنه بيلمس بنية التفويض الأساسية — نفس القاعدة
المكتوبة في `CLAUDE.md`.

**فحص معماري شامل قبل أي قرار** (تفاصيل كاملة موثّقة في نتيجة البحث، ملخّصة هنا): النظام الحالي
**مش hardcoded enums زي ما كان متوقّع** — فيه بالفعل 4 جداول RBAC حقيقية شغالة من أول يوم
(`migration 0003_auth.sql`):

```
roles            (id, name UNIQUE, display_name, description, is_system, created_at, updated_at, deleted_at)
permissions      (id, name UNIQUE, resource, action, created_at, updated_at, deleted_at)
role_permissions (role_id, permission_id) — PK مركّب
user_roles       (user_id, role_id, assigned_by, assigned_at) — PK مركّب، many-to-many
```

طبقتين تفويض متوازيتين مسجّلتين كـ`APP_GUARD` عام:

| الطبقة | الآلية | مصدر الحقيقة | الدقة |
|---|---|---|---|
| **L1 — خشنة** | `@Roles(UserType.ADMIN)` + `RolesGuard` | **JWT payload** (`userType`) | نوع المستخدم بس (عميل/فني/أدمن/عامل منزلي) |
| **L2 — دقيقة** | `@RequirePermission('x.y')` + `PermissionsGuard` | **استعلام حي على القاعدة** كل طلب | 26 صلاحية حالياً |

**حقيقة معمارية حاسمة**: الـJWT (`JwtPayload = {sub, userType}`) **مايحتويش على أدوار ولا
صلاحيات خالص** — `PermissionsGuard` بيعمل استعلام حي (`getUserPermissionNames`) في كل طلب.
يعني **أي تغيير في الأدوار/الصلاحيات بياخد مفعوله فورًا في الطلب الجاي مباشرة، بلا أي حاجة
لإعادة تسجيل دخول أو انتظار انتهاء التوكن** — نقطة مطلوبة صراحة من المالك ("design a safe
strategy for role changes... or another secure architecture") محلولة بالفعل بالتصميم الموجود،
مفيش داعي لأي استراتيجية إضافية.

**الفجوة الحقيقية** مش في الـschema، هي في الطبقة اللي فوقه:
- مفيش CRUD للأدوار نفسها — الأدوار الخمسة (`super_admin`, `ops_manager`, `support_agent`,
  `finance`, `recruiter`) متزروعة بـmigration وبس، مفيش `POST/PATCH/DELETE /admin/roles`.
- مفيش endpoint يقرأ كتالوج الصلاحيات (`permissions` table) ولا يعدّل `role_permissions`
  (الكيان `RolePermission` موجود بس **مستخدمش في أي service خالص** — كود ميت جاهز بالظبط
  للميزة دي).
- مفيش واجهة أدمن للأدوار أصلاً — الشاشة الوحيدة الموجودة (`apps/admin/.../employees/[userId]`)
  بتعرض قايمة أسماء أدوار (dropdown) بس، مفيش أي عرض لصلاحيات الدور نفسه.
- كل صلاحية جديدة (26 صلاحية دلوقتي) بتتضاف عبر migration منفصلة — بالظبط العبء اللي المالك
  عايز يشيله.

**بَقّة كامنة حقيقية اتكشفت أثناء البحث** (موثّقة صراحة في `0038_feature_flags_manage_permission.sql`
نفسها): `0020_permissions_seed.sql` منح `super_admin` كل الصلاحيات وقتها بـ`CROSS JOIN` — دي
كانت **لقطة لحظية، مش قاعدة حية**. أي صلاحية جديدة اتضافت بعد كده (زي `academy.manage`،
`orders.assign_assistant`) لازم تتمنح لـ`super_admin` **صراحة** في نفس الـmigration، وإلا
`super_admin` بيفتقدها بصمت. ده بالظبط نوع الفشل اللي المالك حذّر منه ("Super Admin role cannot
be accidentally deleted or stripped of critical access") — القرار تحت بيقفلها جذريًا.

## القرار

### 1. تمديد schema الموجود، مش استبداله

مفيش إعادة بناء (breaking rewrite) — نفس الأربع جداول، إضافتين بس على `roles` (migration جديدة):

```sql
ALTER TABLE roles ADD COLUMN is_active      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE roles ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT false;
UPDATE roles SET is_super_admin = true WHERE name = 'super_admin';
```

- **`is_active`**: تفعيل/تعطيل مؤقت (عكسي) — دور معطّل يوقف يمنح صلاحياته فورًا (نفس فورية
  إلغاء الدور بالظبط، لأن الفحص حي أصلاً) من غير ما يُحذف تاريخه أو تعييناته. مختلف عن
  `deleted_at` (حذف نهائي، غير مسموح للأدوار النظامية — تحت).
- **`is_super_admin`**: **يقفل بَقّة الـCROSS JOIN جذريًا**. `PermissionsService.hasPermission()`
  بقت بتفحص الأول: لو المستخدم عنده أي دور `is_super_admin=true` (نشط، مش محذوف) → `true`
  فورًا بلا استعلام `role_permissions` خالص، بغض النظر عن أي صف مفقود. يعني `super_admin`
  بقى عنده **كل صلاحية موجودة أو هتتضاف مستقبلاً تلقائيًا وبنيويًا**، مش لأن حد فتكرش يمنحه
  إياها. العمود ده **مش متاح للتعديل من أي endpoint** — مقفول على الدور المزروع بس، مفيش
  `is_super_admin` في `CreateRoleDto`/`UpdateRoleDto` خالص (منع تصعيد صلاحيات بإنشاء دور
  "super_admin_2" وتفعيل العلم عليه يدويًا).

### 2. الأدوار الخمسة النظامية (`is_system=true`) محمية بالكامل من التعديل الهيكلي

`super_admin`, `ops_manager`, `support_agent`, `finance`, `recruiter` أسماؤها **مستخدمة
كـstring literals في كود شغال فعليًا** (قواعد `notification_routing_rules` الافتراضية بتوجّه
لـ`'ops_manager'`/`'finance'`/`'support_agent'` بالاسم — راجع `notifications/README.md`). لو
حد غيّر اسم الدور أو حذفه، التوجيه بيتكسر بصمت. القرار: `is_system=true` تمنع:
- الحذف (`DELETE`/soft-delete) نهائيًا.
- التعطيل (`is_active=false`) نهائيًا.
- تغيير `name` (الـ`display_name`/`description` قابلين للتعديل بحرية — التسمية المعروضة
  للمستخدم مش الـidentifier الداخلي).

الأدوار الجديدة اللي الأدمن هيعملها ("مدير عمليات إقليمي"، "مراجع مالية"، ...) `is_system=false`
افتراضيًا — قابلة للتعديل/التعطيل/الحذف بحرية، هي بالظبط الغرض من الميزة دي.

### 3. منع تصعيد الصلاحيات (Privilege Escalation)

قاعدة صريحة من المالك: "a user must not be able to grant permissions they do not themselves
have, unless explicitly allowed". التنفيذ: صلاحية جديدة `roles.grant_unrestricted` (تُمنح لـ
`super_admin` بس افتراضيًا، زي أي صلاحية تانية — قابلة للمنح لدور تاني لاحقًا عبر نفس الباني،
خاصية bootstrap لطيفة). `setRolePermissions()`/`grantPermissionToRole()`:
1. لو الفاعل (actor) عنده `roles.grant_unrestricted` (أو `is_super_admin` بيتخطاها تلقائيًا
   عبر البند 1) → مسموح يمنح أي صلاحية موجودة في الكتالوج.
2. غير كده → لازم الفاعل نفسه يكون عنده الصلاحية اللي بيحاول يمنحها لدور تاني (`hasPermission`
   على نفسه) — رفض واضح `403` لو حاول يمنح صلاحية مش عنده هو شخصيًا.

**ثغرة حقيقية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، بند P0-1 في `docs/12`)**: القاعدة فوق
كانت متطبّقة على `setRolePermissions()` بس. الملف ده نفسه كان بيقول صراحة (§6 تحت) "`assignRole`/
`revokeRole` الموجودين يفضلوا زي ما هم — مفيش تغيير في الـcontract" — قرار كان يبدو منطقي وقت
الكتابة (الدالتين دول قديمتين من قبل ADR-0010) لكن طلع فيه ثغرة تصعيد صلاحيات حقيقية: أدمن عنده
`roles.manage` بس (من غير `roles.grant_unrestricted`) كان يقدر:
1. `assignRole()` — يعيّن أي دور جاهز (بما فيه `super_admin` نفسه) لمستخدم تاني، من غير أي فحص
   إن صلاحيات الدور ده فعلاً ضمن صلاحيات الفاعل. أخطر مسار: تصعيد فوري لـ`super_admin` بلا أي مقاومة.
2. `cloneRole()` — ينسخ أي دور (بما فيه صلاحيات `finance`/`ops_manager` الكاملة) لدور جديد، من
   غير فحص إنه يملك الصلاحيات دي، وبعدين يعيّن الدور الجديد لنفسه عبر (1).
3. `revokeRole()` — يسحب دور `super_admin` من حساب تاني (طالما مش آخر واحد) بلا أي صلاحية خاصة.

**الإصلاح**: نفس قاعدة §3 اتطبّقت على الثلاثة:
- `assignRole()`/`cloneRole()`: لو الدور المستهدف `is_super_admin=true` → لازم الفاعل يكون
  Super Admin فعلاً (مش بس عنده `roles.grant_unrestricted` — الدور ده خاص لأن صلاحياته الفعلية
  "كل الكتالوج" عن طريق bypass بنيوي، مش قائمة `role_permissions` قابلة للمقارنة). غير كده،
  الفاعل لازم يملك كل صلاحيات الدور (المصدر في حالة `cloneRole`) إلا بـ`roles.grant_unrestricted`.
- `revokeRole()`: سحب دور `super_admin` تحديدًا من حساب تاني محتاج الفاعل يكون Super Admin فعلاً.

اختبار regression حي كامل (11 حالة، `apps/api/src/modules/admin/permissions.service.spec.ts`)
ضد Postgres حقيقي بيثبت: الحالة الأصلية الصحيحة لسه شغالة (فاعل عنده كل صلاحيات الدور بالظبط
ينجح)، الحالات التلاتة فوق بترفض `403`/`AUTH_001`، `roles.grant_unrestricted` بيتخطى الفحص العادي
بس مش فحص `is_super_admin` الخاص، وSuper Admin حقيقي يقدر يعمل كل حاجة.

### 4. حماية القفل الذاتي (Self-Lockout Prevention)

قاعدتين منفصلتين، الاتنين موجودتين جزئيًا (الأولى) أو جداد (التانية):
- **آخر super_admin في النظام** (موجودة بالفعل في `isLastSuperAdmin()`) — بتتوسّع لتغطي حذف/
  تعطيل **الدور نفسه** لو ده هيسيب النظام من غير `is_super_admin` نشط خالص (مغطاة تلقائيًا
  ببند 2 — `is_system` بيمنع حذف/تعطيل `super_admin` role نفسه أصلاً، فالسيناريو ده مستحيل
  بنيويًا، مش محتاج فحص إضافي منفصل).
- **آخر دور للفاعل نفسه** (جديدة): `revokeRole(actorUserId, targetUserId, roleName)` — لو
  `actorUserId === targetUserId` وده آخر دور للمستخدم، رفض واضح ("مينفعش تسحب آخر دور من
  نفسك — هتفقد وصولك للنظام بالكامل"). مختلف عن حالة "آخر super_admin" (دي عن الدور نفسه
  عبر كل المستخدمين، دي عن المستخدم الفاعل تحديدًا).

### 5. الفحص الحي بيفلتر `is_active` كمان

`getUserPermissionNames()`/`isLastSuperAdmin()`/أي استعلام تاني بيعدّي على `roles` لازم يضيف
`AND r.is_active = true` جنب `r.deleted_at IS NULL` الموجودة بالفعل — دور معطّل يوقف يمنح
صلاحياته **فورًا** (نفس ضمان الفورية الموجود من الأساس، الفحص حي أصلاً مفيش JWT staleness).

### 6. Endpoints جديدة (موديول `admin` الموجود، مفيش موديول جديد)

كل الـmutations تحت `roles.manage` (الصلاحية الموجودة بالفعل، بدل ما نخترع صلاحية منفصلة لكل
فعل — نفس دقة باقي الموديولات في المشروع). القراءة مفتوحة لأي أدمن (نفس فلسفة `GET /admin/roles`
الحالية — "أي أدمن يقدر يشوف، الأفعال الحساسة بس محمية"):

```
GET    /admin/permissions                    — الكتالوج كامل، مجمّع حسب resource (مفتوح)
GET    /admin/roles                          — موجود، هيترجع is_active/is_system كمان
GET    /admin/roles/:id                      — جديد: تفاصيل دور + صلاحياته + المستخدمين الحاملين له
POST   /admin/roles                          — جديد (roles.manage): إنشاء دور
PATCH  /admin/roles/:id                      — جديد (roles.manage): تعديل display_name/description/is_active
POST   /admin/roles/:id/clone                — جديد (roles.manage): نسخ دور بكل صلاحياته
DELETE /admin/roles/:id                      — جديد (roles.manage): soft-delete (مرفوض لو is_system)
PUT    /admin/roles/:id/permissions           — جديد (roles.manage [+ grant_unrestricted]): استبدال كامل لقايمة صلاحيات الدور (ذرّي، قفل صف)
GET    /admin/roles/:id/audit-history         — جديد: audit_logs المفلترة على entity_type='role', entity_id=:id
```

`assignRole`/`revokeRole`/`listUserRoles` الموجودين يفضلوا زي ما هم — مفيش تغيير في الـcontract
بتاعهم، بس بيستفيدوا تلقائيًا من فلتر `is_active` وحماية القفل الذاتي الجديدة.

### 7. كتالوج الصلاحيات — حقيقي، مش تخميني

المالك طلب صراحة: **"Do not replace backend authorization with UI hiding. Every protected
action must still be enforced server-side."** — يعني مينفعش نضيف صفوف `permissions` لموديولات
(matching, recurring_orders, reports, ...) مالهاش أي فعل محمي فعليًا دلوقتي، لأن ده هيوهم
الأدمن إن تفعيل/تعطيل الصلاحية دي بيغيّر حاجة حقيقية وهو مش بيغيّر أي حاجة. الكتالوج بيبقى:
- **الـ26 صلاحية الموجودة فعليًا ومفعّلة على endpoints حقيقية** — كلهم بيبانوا في الباني، قابلين
  للمنح/السحب من أي دور (بما فيهم الأدوار النظامية — نقدر نضيف/نشيل صلاحية من `ops_manager`
  مثلاً، الممنوع بس حذف/تعطيل/إعادة تسمية الدور نفسه).
- **صلاحيات جديدة تتضاف الأول وقت بناء الميزة اللي بتحميها فعليًا** — مطابق لنفس النمط بالحرف
  (migration زارعة الصلاحية + `@RequirePermission` على الـendpoint الفعلي في نفس الـPR). أجزاء
  QR referral/KPI/career progression الجاية في نفس المرحلة دي هتضيف `referrals.manage`،
  `kpi.manage`، `career.manage` بنفس الأسلوب.
- `resource` الموجود في `permissions` (customers, technicians, orders, catalog, payments, ...)
  هو التجميع حسب الموديول اللي المالك طلبه — مش محتاج عمود جديد.

### 8. تنظيف: حذف تكرار كيانات `Role`/`UserRole`

البحث كشف نسخة تانية من `Role`/`UserRole` entities في `apps/api/src/modules/auth/entities/`
(مسجّلة في `AuthModule` عبر `TypeOrmModule.forFeature` بس **مستخدمة صفر مرة** — لا
`@InjectRepository(Role)` ولا `@InjectRepository(UserRole)` في أي كود جوّه `auth`). النسخة
الفعلية المستخدمة في كل مكان هي نسخة `admin/entities/`. بما إني بضيف عمودين جداد (`is_active`,
`is_super_admin`) على `Role`، إبقاء نسخة تانية ناقصة العمودين دول (حتى لو مستخدمتش) مصدر لبس
مستقبلي حقيقي — اتشالت النسخة الميتة من `auth/entities/` و`auth.module.ts`.

### 9. مفيش كاش على فحص الصلاحيات — قرار واعي

`RedisCacheService` موجود ومستخدم في `SettingsModule` بس مش هنا. القرار: **نسيبه من غير كاش**
زي ما هو دلوقتي — أي كاش هيحتاج استراتيجية إبطال دقيقة (لحظة تعديل `role_permissions` أو
`user_roles`) وده تعقيد إضافي حقيقي مقابل فايدة أداء مش مطلوبة صراحة من المالك ولا فيها مشكلة
حقيقية على الحجم الحالي (استعلام join بسيط على 4 جداول صغيرة). لو الأداء بقى مشكلة حقيقية
مستقبلاً، دي تحسين منفصل بعده ADR خاص بيه، مش جزء من الميزة دي.

## البدائل اللي اتقيّمت

- **JWT يحمل الأدوار/الصلاحيات (claims-based)**: رُفض — يحتاج استراتيجية invalidation معقدة
  (short-lived tokens + version check أو session store) لضمان تغيير الصلاحيات ياخد مفعوله
  فورًا، بينما النظام الحالي عنده الضمان ده مجانًا من التصميم الأصلي. تغيير معماري بلا فايدة.
- **صلاحيات منفصلة لكل فعل جديد من الأفعال العشرة المطلوبة (create/edit/clone/...) بدل
  `roles.manage` واحدة**: رُفض — كسر لنمط الدقة الموجود في كل موديول تاني في المشروع (كل
  موديول عنده `.manage` واحدة تغطي كل أفعاله الحساسة)، تعقيد بلا فايدة حقيقية بما إن باني
  الأدوار نفسه فعل إداري واحد متكامل.
- **حذف `roles.manage` القديمة واستبدالها بمصفوفة صلاحيات جديدة بالكامل**: رُفض — breaking
  change على كل الأدوار الموجودة والتعيينات الحالية بلا داعي، القديمة تغطي المطلوب تمامًا.
- **إضافة كاش Redis لفحص الصلاحيات من الأول**: رُفض مؤقتًا (تفصيل في البند 9 فوق).

## الأثر

- Migration جديدة: `roles.is_active`, `roles.is_super_admin` + صلاحية `roles.grant_unrestricted`
  جديدة (تُمنح لـ`super_admin` صراحة، نفس درس `0038`).
- `PermissionsService`: `is_super_admin` bypass، فلتر `is_active` في كل الاستعلامات، منطق منع
  التصعيد، حماية القفل الذاتي، دوال CRUD جديدة للأدوار وصلاحياتها.
- `AdminUsersController` (أو controller جديد مخصوص `AdminRolesController` — قرار تنفيذي بسيط
  وقت الكود، مش معماري): endpoints جديدة من البند 6.
- `apps/admin`: شاشة `/roles` جديدة كاملة (قايمة، إنشاء/تعديل/نسخ/تفعيل-تعطيل، مصفوفة صلاحيات،
  المستخدمين الحاملين للدور، سجل تدقيق).
- حذف تكرار الكيانات الميتة من `auth/entities/` و`auth.module.ts`.
- كل الأفعال الجديدة audit-logged (`role.created`/`role.updated`/`role.deleted`/`role.activated`/
  `role.deactivated`/`role.cloned`/`role.permissions_changed`) — نفس نمط `role.assigned`/
  `role.revoked` الموجود.
