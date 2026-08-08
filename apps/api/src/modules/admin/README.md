# modules/admin

عمليات لوحة التحكم — endpoints مسبوقة بـ /admin (قاموس §13.7).

**الحالة: شغال جزئياً (S10 — الهيكل التنظيمي للموظفين).**

القاموس §13.7 بيعرّف مجموعة endpoints واسعة تحت `/admin` — جزء كبير منها اتبنى فعلاً بس **موزّع على الموديولات المسؤولة عنه** بدل ما يتلمّ هنا (نفس فلسفة `AdminPaymentsController` جوّه `payments` و`AdminSupportController` جوّه `support`)، عشان كل موديول يفضل صاحب منطقه. الموديول ده (`admin`) بيحتوي بس اللي بيعدّي على أكتر من موديول فعلياً (التقارير، الهيكل التنظيمي).

**اللي شغال من القاموس دلوقتي (موزّع):**
- `GET/POST /admin/orders/...` (`orders/admin-orders.controller.ts`) — list, detail, cancel, reassign.
- `GET/POST /admin/technicians/...` (`technicians/admin-technicians.controller.ts`) — list, detail, approve, reject, مراجعة مستندات.
- `GET/POST /admin/payouts/...`, `POST /admin/orders/:id/refund` (`payments/admin-payments.controller.ts`).
- `GET/POST /admin/complaints/...` (`support/admin-support.controller.ts`).
- **`GET /admin/dashboard/stats`** (هنا): طلبات النهاردة (كله/مكتمل/فعّال/ملغي)، إيراد وعمولة النهاردة، حالة الفنيين (معتمد/تحت المراجعة/متاح دلوقتي)، شكاوى مفتوحة، متوسط التقييم العام، **+ (S10، نقطة 8) `users`** (إجمالي، تسجيلات النهاردة، تقسيم حسب `user_type`) **و`financial.pending_payouts`** (عدد وقيمة طلبات الصرف تحت المراجعة).
- **`GET /admin/reports/revenue?from=&to=&group_by=day|week|month`** (هنا): تجميع الإيراد/العمولة/أرباح الفنيين لكل فترة زمنية، محسوب من `orders.paid_at` مباشرة (مش تقدير) — تجميع بـ `date_trunc` مع القيمة ممرّرة كـ bind parameter (مش string concatenation) عشان الأمان.
- **`GET /admin/reports/technicians?sort_by=&order=&page=&per_page=`** (هنا، جديد S10 — فجوة كانت موثّقة "لسه من غير" اتقفلت): ترتيب أداء الفنيين — طلبات مكتملة/ملغاة، متوسط تقييم، `quality_score`، **متوسط زمن رد حقيقي** محسوب من `order_assignments.sent_at→responded_at` (عروض اتردّ عليها صراحة، قبول أو رفض — مش `timeout`)، وعدد الشكاوى المفتوحة ضد الفني كـ"issues". الترتيب (`sort_by`) بيتحدد من خريطة أعمدة ثابتة (whitelist) بعد ما `@IsIn` في الـ DTO يتأكد من القيمة — مش أي مدخل خام بيوصل لـ`ORDER BY` مباشرة.
- **`GET /admin/reports/zones?from=&to=`** (هنا — كانت فجوة موثّقة §13.7، اتقفلت): أداء كل `service_zone` — عدد الطلبات/المكتمل، الإيراد وعمولة المنصة (بس للمدفوع `payment_status='paid'`)، وعدد الفنيين النشطين فعلياً فيه (`technician_zones.is_active=true` **و** `technician_profiles.verification_status='approved'` — مش مجرد صف موجود). فترة `from`/`to` اختيارية بالكامل (`LEFT JOIN` مع شرط `$1 IS NULL OR ...`) — لو من غيرهم بيرجع كل الوقت؛ النطاقات نفسها بترجع دايماً حتى لو مفيش طلبات في الفترة (صفر مش اختفاء)، عكس تقرير الفنيين معندوش صفحات لأن عدد النطاقات صغير عادةً (عشرات مش آلاف).
- اتعمله اختبار end-to-end فعلي: `dashboard/stats` قبل أي طلبات (كله أصفار)، دورة كاش كاملة حقيقية (طلب → قبول → اكتمال → تحصيل كاش)، وبعدها الإحصائيات والتقرير طابقوا الأرقام الحقيقية في القاعدة بالظبط (إيراد 200 جنيه، عمولة 30 جنيه = 15%)، تقييم وشكوى حقيقيين ظهروا في `average_rating`/`complaints_open`، فلترة تاريخ فاضية رجّعت مصفوفة فاضية مش خطأ، `group_by` غلط اترفض بوضوح، وعميل/فني اتمنعوا من كل مسارات التقرير (403). `users`/`financial.pending_payouts` اتأكدوا حياً مطابقين لعدّ مباشر بـ`psql` بالظبط (14 مستخدم: 9 أدمن/4 فني/1 عميل، صرف واحد تحت المراجعة بقيمة 1500 جنيه). `reports/technicians` اتأكد إن متوسط زمن الرد (`9.78474` ثانية لفني حقيقي) طابق حساب يدوي بالظبط لصفّين `accepted` بس (18.55 و1.02 ثانية) وتجاهل صف `timeout` (30 ثانية) عن قصد، وإن الترتيب بـ`sort_by` غلط اترفض بوضوح (`VAL_001`) بدل ما يوصل لأي SQL خام. `reports/zones` اتأكد إن أرقامه (نطاقين حقيقيين) طابقوا استعلام `psql` يدوي منفصل بالظبط (3 طلبات/طلب مكتمل واحد/30000 قرش إيراد/4500 قرش عمولة لأول نطاق)، وإن فترة مستقبلية رجّعت نفس النطاقات بأصفار (مش قائمة فاضية)، وتاريخ غلط اترفض (`VAL_001`)، وعميل اترفض 403.

## الصلاحيات الدقيقة (`PermissionsGuard`) — كانت فجوة موثّقة، اتقفلت

الفجوة اللي كانت متكررة في `support/README.md` و`payments/README.md` و`apps/api/README.md` ("أي `user_type=admin` يقدر يعمل أي عملية إدارية") اتقفلت فعلياً:

- **`roles`/`permissions`/`role_permissions`/`user_roles`** (موجودين من `infra/migrations/0003` بس فاضيين) اتفعّلوا عبر migration جديدة (`infra/migrations/0020_permissions_seed.sql`، **مش تعديل على 0003** — طبقاً لحوكمة الـ migrations) زرعت 10 صلاحيات دقيقة ووزّعتها على الأدوار الخمسة الأساسية حسب منطقها.
- **`PermissionsGuard`** مسجّل global زي `RolesGuard` بالظبط (نفس فلسفة no-op لو مفيش `@RequirePermission` على الـ endpoint) — بيتحقق حياً من القاعدة (`user_roles→role_permissions→permissions`) في كل طلب، مش من الـ JWT. اتطبّق على الأفعال الحساسة بس (فلوس، قرارات نهائية) مش على أي `GET` — أي أدمن (حتى من غير أي دور معيّن) يقدر **يشوف** كل حاجة، بس الفعل (إلغاء، اعتماد، حل شكوى، صرف فلوس) محتاج الدور الصح.
- **`AdminUsersController`** (هنا): `GET /admin/roles` (قائمة الأدوار المتاحة)، `GET /admin/users/:userId/roles`، و`POST`/`DELETE /admin/users/:userId/roles` (منح/سحب دور — محتاجين `roles.manage` بنفسهم، يعني `super_admin` بس فعلياً حسب البذر الحالي).
- **بوتستراب الأدمن الأول**: مفيش endpoint عام يقدر يمنح أول `super_admin` لنفسه (ده مقصود، مش قصور) — لازم `INSERT INTO user_roles` مباشر وقت التجهيز الأولي للبيئة. بعد كده كل تعيين تاني (وأي حساب أدمن جديد كمان) بيعدّي من الـ API.
- **حماية آخر `super_admin` — كانت فجوة موثّقة، اتقفلت (S10)**: `PermissionsService.isLastSuperAdmin(userId)` بتتنادى في مكانين — `revokeRole()` (لو الدور المسحوب `super_admin` والمستخدم هو آخر واحد عنده) و`AdminEmployeesService.block()` (لو حظر الموظف هيسحب دور `super_admin` الأخير معاه، بما إن الحظر بيسحب كل الأدوار). اتعمله اختبار حي حاسم: مدير عام حاول يسحب دوره من نفسه وهو آخر واحد فاترفض (409)، وبعد ما اتضاف مدير عام تاني نجحت نفس العملية عادي (مش آخر واحد بقى). **ملاحظة صراحة**: فحص `block()` مش قابل للوصول فعلياً في نموذج الصلاحيات الحالي (`employees.manage` مقصورة على `super_admin` بس، ومينفعش تحظر نفسك أصلاً — فأي `super_admin` تاني قادر يستدعي الحظر يبقى معناه فيه أكتر من واحد أصلاً) — بس اتسابت كطبقة حماية دفاعية زيادة تفيد لو الصلاحية اتوسّعت مستقبلاً.

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
- حذف حساب موظف (soft-delete) — دلوقتي الأداة الوحيدة هي `block` (تعطيل)، مفيش `DELETE` endpoint حقيقي.

~~`POST /admin/technicians/:id/suspend`~~ — كانت فجوة موثّقة هنا، اتقفلت. التفاصيل الكاملة والاختبار الحي في `../technicians/README.md`.

~~`PATCH /admin/orders/:id/adjust-price`~~ — كانت فجوة موثّقة هنا، اتقفلت. التفاصيل الكاملة والاختبار الحي في `../orders/README.md`.

~~`GET /admin/reports/zones`~~ — كانت فجوة موثّقة هنا، اتقفلت (تفاصيل فوق في "لوحة التحكم الموسّعة").

## إدارة العملاء (`GET /admin/customers`, `/:userId`, `/:userId/block`, `/:userId/unblock`) — كانت فجوة موثّقة، اتقفلت

كانت §13.7 موثّقة إن مفيش أي endpoint إداري لعرض/حظر العملاء رغم إن `customer_profiles` (إحصائيات طلبات/إنفاق/نقاط ولاء/تصنيف/high-risk، من `0016_phase8_home_management.sql` أو قبلها) كانت موجودة أصلاً بس مش معروضة لحد. اتضافت صلاحية جديدة `customers.manage` (`infra/migrations/0033_customers_manage_permission.sql`، `super_admin` بس حالياً — بالظبط نفس نمط `0025_employees_manage_permission.sql`) وبنية `AdminCustomersController`/`AdminCustomersService` بتتبع نفس نمط `AdminEmployeesController`:

- **`GET /admin/customers?customer_tier=&is_high_risk=&is_blocked=&phone_number=`** + **`GET /admin/customers/:userId`**: مفتوحة لأي أدمن (قراءة مش حساسة زي باقي كنترولرز الإدارة). بترجّع بروفايل العميل كامل (المستوى، عدد الطلبات الكلي/المكتمل/الملغي، إجمالي الإنفاق، رصيد نقاط الولاء، متوسط التقييم اللي العميل ديه، علم high-risk، تواريخ أول/آخر طلب).
- **`POST /admin/customers/:userId/block`** / **`.../unblock`** (`customers.manage`): بيستخدم نفس آلية `users.is_blocked`/`blocked_reason` الموجودة أصلاً — نفس الحقول اللي `auth.service.ts` بيتحقق منها وقت الدخول وتدوير الـ refresh token. **فرق مقصود عن حظر الموظفين**: العملاء مالهمش أي صف في `user_roles` أصلاً (RBAC للأدمن بس)، فالحظر هنا بيلغي `refresh_tokens` النشطة فقط (`revoked_reason='admin_block'`) من غير أي محاولة حذف أدوار مش موجودة. بيرفض حظر عميل محظور بالفعل (409).
- **اتعمله اختبار حي فعلي كامل بعد التشغيل الحقيقي**: `GET /admin/customers` رجّع العميل التجريبي الحقيقي؛ حظر بسبب قصير (أقل من 3 حروف) اترفض بالتحقق (`VAL_001`)؛ حظر بسبب صحيح نجح وظهر `is_blocked=true`/`blocked_reason` صح فوراً في الرد وفي `psql` مباشرة؛ محاولة حظر تاني لنفس العميل اترفضت 409؛ فلتر `?is_blocked=true` رجّع نفس العميل بس؛ `audit_logs` سجّلت `customer.blocked` بالسبب الصح؛ فك الحظر رجّع الحساب لحالته الأصلية (اتأكد بـ`psql`)؛ وأهم اختبار — أدمن `ops_manager` (عنده أدوار تانية بس مش `customers.manage`) حاول يحظر عميل فاترفض 403 (`AUTH_001`، "دورك الإداري مش مديك صلاحية العملية دي") — يثبت إن `PermissionsGuard` شغالة صح على الكنترولر الجديد.
- **حاجات لسه ناقصة عمداً**: مفيش `PATCH /admin/customers/:userId` لتعديل البيانات (مفيش حقل واضح المفروض الأدمن يعدله غير الحظر نفسه — الاسم/الهاتف بييجوا من مسار OTP الذاتي)، ومفيش `DELETE`/soft-delete (نفس فجوة الموظفين بالظبط). حظر العميل هنا بيمنعه يدخل بس **مش** بيلغي طلباته الحالية (السلوك ده متعمد — لو فيه طلب شغال، الإلغاء له مسار تاني `admin-orders.service.ts`).

مرجع كامل: `../../../../docs/02-data-dictionary.md` §13.7 و `../../../../docs/01-master-plan.md` §2.4.
