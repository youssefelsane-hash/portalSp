# modules/admin

عمليات لوحة التحكم — endpoints مسبوقة بـ /admin (قاموس §13.7).

**الحالة: شغال جزئياً (S10 — الهيكل التنظيمي للموظفين).**

القاموس §13.7 بيعرّف مجموعة endpoints واسعة تحت `/admin` — جزء كبير منها اتبنى فعلاً بس **موزّع على الموديولات المسؤولة عنه** بدل ما يتلمّ هنا (نفس فلسفة `AdminPaymentsController` جوّه `payments` و`AdminSupportController` جوّه `support`)، عشان كل موديول يفضل صاحب منطقه. الموديول ده (`admin`) بيحتوي بس اللي بيعدّي على أكتر من موديول فعلياً (التقارير، الهيكل التنظيمي).

**اللي شغال من القاموس دلوقتي (موزّع):**
- `GET/POST /admin/orders/...` (`orders/admin-orders.controller.ts`) — list, detail, cancel, reassign.
- `GET/POST /admin/technicians/...` (`technicians/admin-technicians.controller.ts`) — list, detail, approve, reject, مراجعة مستندات.
- `GET/POST /admin/payouts/...`, `POST /admin/orders/:id/refund` (`payments/admin-payments.controller.ts`).
- `GET/POST /admin/complaints/...` (`support/admin-support.controller.ts`).
- **`GET /admin/dashboard/stats`** (هنا): لقطة سريعة — طلبات النهاردة (كله/مكتمل/فعّال/ملغي)، إيراد وعمولة النهاردة، حالة الفنيين (معتمد/تحت المراجعة/متاح دلوقتي)، شكاوى مفتوحة، ومتوسط التقييم العام.
- **`GET /admin/reports/revenue?from=&to=&group_by=day|week|month`** (هنا): تجميع الإيراد/العمولة/أرباح الفنيين لكل فترة زمنية، محسوب من `orders.paid_at` مباشرة (مش تقدير) — تجميع بـ `date_trunc` مع القيمة ممرّرة كـ bind parameter (مش string concatenation) عشان الأمان.
- اتعمله اختبار end-to-end فعلي: `dashboard/stats` قبل أي طلبات (كله أصفار)، دورة كاش كاملة حقيقية (طلب → قبول → اكتمال → تحصيل كاش)، وبعدها الإحصائيات والتقرير طابقوا الأرقام الحقيقية في القاعدة بالظبط (إيراد 200 جنيه، عمولة 30 جنيه = 15%)، تقييم وشكوى حقيقيين ظهروا في `average_rating`/`complaints_open`، فلترة تاريخ فاضية رجّعت مصفوفة فاضية مش خطأ، `group_by` غلط اترفض بوضوح، وعميل/فني اتمنعوا من كل مسارات التقرير (403).

## الصلاحيات الدقيقة (`PermissionsGuard`) — كانت فجوة موثّقة، اتقفلت

الفجوة اللي كانت متكررة في `support/README.md` و`payments/README.md` و`apps/api/README.md` ("أي `user_type=admin` يقدر يعمل أي عملية إدارية") اتقفلت فعلياً:

- **`roles`/`permissions`/`role_permissions`/`user_roles`** (موجودين من `infra/migrations/0003` بس فاضيين) اتفعّلوا عبر migration جديدة (`infra/migrations/0020_permissions_seed.sql`، **مش تعديل على 0003** — طبقاً لحوكمة الـ migrations) زرعت 10 صلاحيات دقيقة ووزّعتها على الأدوار الخمسة الأساسية حسب منطقها.
- **`PermissionsGuard`** مسجّل global زي `RolesGuard` بالظبط (نفس فلسفة no-op لو مفيش `@RequirePermission` على الـ endpoint) — بيتحقق حياً من القاعدة (`user_roles→role_permissions→permissions`) في كل طلب، مش من الـ JWT. اتطبّق على الأفعال الحساسة بس (فلوس، قرارات نهائية) مش على أي `GET` — أي أدمن (حتى من غير أي دور معيّن) يقدر **يشوف** كل حاجة، بس الفعل (إلغاء، اعتماد، حل شكوى، صرف فلوس) محتاج الدور الصح.
- **`AdminUsersController`** (هنا): `GET /admin/roles` (قائمة الأدوار المتاحة)، `GET /admin/users/:userId/roles`، و`POST`/`DELETE /admin/users/:userId/roles` (منح/سحب دور — محتاجين `roles.manage` بنفسهم، يعني `super_admin` بس فعلياً حسب البذر الحالي).
- **بوتستراب الأدمن الأول**: مفيش endpoint عام يقدر يمنح أول `super_admin` لنفسه (ده مقصود، مش قصور) — لازم `INSERT INTO user_roles` مباشر وقت التجهيز الأولي للبيئة. بعد كده كل تعيين تاني (وأي حساب أدمن جديد كمان) بيعدّي من الـ API.
- **فجوة موثّقة متبقية**: مفيش حماية ضد سحب آخر `super_admin` في النظام (ممكن يحصل قفل كامل لحد ما حد يصلحها بـ SQL مباشر).

## سجل التدقيق (`GET /admin/audit-logs`)

مفصّل في `../audit/README.md`. 10+ أفعال إدارية حساسة عبر أكتر من موديول بتسجّل مين عمل إيه وإمتى وقبل/بعد التعديل، مقصورة على `super_admin` بس (`audit.view`).

## إعدادات النظام (`GET/PATCH /admin/settings`)

مفصّل في `../settings/README.md`. `GET/PATCH /admin/settings` شغالة فعلياً وموصولة بمستهلك حقيقي (`PayoutsService`) مش مجرد CRUD شكلي.

## الهيكل التنظيمي للموظفين (`/admin/employees`) — جديد

أول مرة بيبقى فيه طريقة حقيقية عبر الـ API لإنشاء حساب أدمن (كانت `INSERT` مباشر في القاعدة بس، دلوقتي استخدام تأسيسي لأول `super_admin` فقط). جدول جديد `employee_profiles` (`infra/migrations/0024`) منفصل عمداً عن `roles`/`permissions`: **القسم والمدير المباشر هيكل تنظيمي (org chart)**، بينما **الأدوار/الصلاحيات وصول للنظام** — نفس الموظف ممكن يتنقل قسم أو مدير من غير أي تغيير في صلاحياته، والعكس.

- **`POST /admin/employees`** (`employees.manage` — `infra/migrations/0025`، `super_admin` بس حالياً): بيعمل transaction واحدة (`users` جديد بـ`user_type=admin` + `employee_profiles`)، وبيولّد `employee_code` فريد (`EMP-YYYY-NNNNNN`) عبر نفس دالة `next_human_readable_number` المستخدمة في `ORD`/`PYT`/`CMP`. `phone_verified_at` بتتحط فوراً (أدمن موثوق بيضيفه، عكس تسجيل العميل/الفني الذاتي اللي بيتطلب OTP). منح دور أول (`initial_role_name`) اختياري ومنفصل عن المعاملة نفسها عمداً — فشله مايلغيش وجود الحساب، بالظبط زي حدث `user.registered` في `auth.service.ts`.
- **`GET /admin/employees?department=&manager_user_id=&is_active=`** + **`GET /admin/employees/:userId`**: مفتوحة لأي أدمن (قراءة مش حساسة). التفاصيل بترجّع البروفايل + الأدوار الحالية (نفس `PermissionsService.listUserRoles`) + **آخر 10 محاولات دخول حقيقية** (بإعادة استخدام جدول `refresh_tokens` الموجود أصلاً — عنده `device_name`/`device_platform`/`ip_address`/`created_at`/`is_revoked` بالفعل، مفيش داعي لجدول "سجل دخول" منفصل) + **آخر 20 نشاط** (بإعادة استخدام `audit_logs` عبر `actor_user_id`، نفس `AuditLogService.list`).
- **`PATCH /admin/employees/:userId`**: تعديل القسم/المسمى/المدير المباشر/تاريخ التعيين/الحالة. بيرفض جعل الموظف مديره المباشر لنفسه، وبيتحقق إن أي `manager_user_id` جديد فعلاً حساب `user_type=admin`.
- **`POST /admin/employees/:userId/block`** / **`.../unblock`**: بيستخدم آلية `users.is_blocked`/`blocked_reason` **الموجودة أصلاً** (مش آلية جديدة) — `auth.service.ts` بيتحقق منها فعلاً وقت الدخول وتدوير الـ refresh token. الحظر كمان بيسحب كل `user_roles` وبيلغي كل `refresh_tokens` النشطة فوراً — تعطيل فعلي مو مجرد علم في القاعدة.
- **فجوة معمارية موثّقة (مش جديدة، ومش اتصلحت هنا)**: `JwtStrategy` بيتحقق من التوقيع والانتهاء بس (لا يوجد فحص قاعدة بيانات لكل طلب) — يعني حظر موظف عنده access token لسه ساري (أقصى مدة 15 دقيقة) هيفضل يقدر يستخدمه لحد ما ينتهي أو يحاول refresh، حتى لو الأدوار اتسحبت واتلغى الـ refresh token بتاعه فوراً. `PermissionsGuard` بيتحقق حياً من القاعدة، فأي فعل محتاج صلاحية (`@RequirePermission`) هيترفض فوراً حتى بالتوكن القديم — بس أي فعل مفتوح لأي أدمن (زي `GET`) هيفضل شغال لحد انتهاء التوكن.
- **اتعمله اختبار end-to-end فعلي شامل**: إنشاء `ops_manager` بمنح دور مباشر وقت الإنشاء، ثبت الدور فعلاً في `GET /admin/users/:id/roles`، إنشاء موظف تاني تحته كـ`manager_user_id` وظهر صح في فلترة `manager_user_id`/`department`؛ الموظف الجديد سجّل دخول فعلي بنفس رقم الهاتف من غير أي تدخل إضافي (إثبات إن حساب اتضاف يدوياً بيشتغل بنفس مسار OTP العادي)؛ `GET /admin/employees/:id` رجّع الدور الحقيقي + IP دخول حقيقي (`127.0.0.1`) + نشاط فاضي (مفيش أفعال بعد)؛ تعديل قسم/مسمى نجح واتسجّل في سجل التدقيق قبل/بعد بالظبط؛ الحظر سحب الدور وألغى الـ refresh token فعلياً في القاعدة (اتأكد بـ`psql` مباشر)، ومحاولة فعل محتاج صلاحية بنفس التوكن القديم اترفضت 403 فوراً، ومحاولة دخول جديدة اترفضت بالسبب بالظبط؛ فك الحظر رجّع الحساب طبيعي؛ رقم هاتف مكرر، موظف كمديره المباشر لنفسه، ومدير مباشر مش حساب أدمن (عميل) اترفضوا كلهم بوضوح؛ عميل اترفض تماماً من كل `/admin/employees/*` (403)؛ أدمن من غير أي دور قدر **يشوف** القائمة والتفاصيل لكن اترفض من الإنشاء (403، `employees.manage`)؛ `super_admin` اترفض من حظر حسابه هو نفسه، ومن حظر id مش موجود (404)؛ فلترة `is_active=true/false` اتأكد إنها بترجع النتيجة الصح بعد إصلاح باگ حقيقي (تحت).
- **باگ حقيقي اتلقط واتصلح وقت الاختبار الحي**: فلتر `is_active` كان بيستخدم `@Type(() => Boolean)` من `class-transformer`، واللي بيحوّل أي قيمة query string (زي `"false"`) لـ `Boolean("false")` = `true` لأنها string غير فاضية — يعني `?is_active=false` كانت بترجع نفس نتيجة `?is_active=true` غلط. اتصلحت باستخدام نفس الـ pattern الموجود فعلاً في `promotions/dto/list-promo-codes-query.dto.ts` (`@Transform(({ value }) => value === true || value === 'true')`)، واتأكد الإصلاح حياً: `is_active=true` رجّعت الموظف النشط بس، و`is_active=false` رجّعت الموظف المعطّل بس.

## مستويات الفنيين وترقية يدوية (`PATCH /admin/technicians/:id/level`, `/admin/technician-levels`)

فجوة كانت هنا في القائمة تحت اتقفلت: ترقية/تخفيض مستوى الفني بقت فعل حقيقي (`technicians.approve`)، وسياسة كل مستوى (عمولة/أولوية/حد قرار/أهلية قيادة فريق) بقت قابلة للتعديل بالكامل عبر `technician_levels.manage`. التفاصيل الكاملة والاختبار في `../technicians/README.md`.

**لسه من غير من §13.7** (فجوة موثّقة، مش سهو):
- `GET /admin/customers` + `/:id/block`
- `PATCH /admin/orders/:id/adjust-price`
- `POST /admin/technicians/:id/suspend`
- `GET /admin/reports/technicians`, `GET /admin/reports/zones`.
- حذف حساب موظف (soft-delete) — دلوقتي الأداة الوحيدة هي `block` (تعطيل)، مفيش `DELETE` endpoint حقيقي.

مرجع كامل: `../../../../docs/02-data-dictionary.md` §13.7 و `../../../../docs/01-master-plan.md` §2.4.
