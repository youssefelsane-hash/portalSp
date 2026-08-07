# modules/admin

عمليات لوحة التحكم — endpoints مسبوقة بـ /admin (قاموس §13.7).

**الحالة: شغال جزئياً (S9 — التقارير).**

القاموس §13.7 بيعرّف مجموعة endpoints واسعة تحت `/admin` — جزء كبير منها اتبنى فعلاً بس **موزّع على الموديولات المسؤولة عنه** بدل ما يتلمّ هنا (نفس فلسفة `AdminPaymentsController` جوّه `payments` و`AdminSupportController` جوّه `support`)، عشان كل موديول يفضل صاحب منطقه. الموديول ده (`admin`) بيحتوي بس اللي بيعدّي على أكتر من موديول فعلياً (التقارير).

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

- **`roles`/`permissions`/`role_permissions`/`user_roles`** (موجودين من `infra/migrations/0003` بس فاضيين) اتفعّلوا عبر migration جديدة (`infra/migrations/0020_permissions_seed.sql`، **مش تعديل على 0003** — طبقاً لحوكمة الـ migrations) زرعت 10 صلاحيات دقيقة (`orders.cancel`, `orders.reassign`, `technicians.approve`, `technicians.review_documents`, `payouts.approve`, `refunds.issue`, `complaints.resolve`, `promotions.manage`, `loyalty.manage`, `roles.manage`) ووزّعتها على الأدوار الخمسة الأساسية حسب منطقها (مثلاً `finance` عنده `payouts.approve`/`refunds.issue` بس، `support_agent` عنده `complaints.resolve` بس).
- **`PermissionsGuard`** مسجّل global زي `RolesGuard` بالظبط (نفس فلسفة no-op لو مفيش `@RequirePermission` على الـ endpoint) — بيتحقق حياً من القاعدة (`user_roles→role_permissions→permissions`) في كل طلب، مش من الـ JWT. اتطبّق على الأفعال الحساسة بس (فلوس، قرارات نهائية) مش على أي `GET` — أي أدمن (حتى من غير أي دور معيّن) يقدر **يشوف** كل حاجة، بس الفعل (إلغاء، اعتماد، حل شكوى، صرف فلوس) محتاج الدور الصح.
- **`AdminUsersController`** (هنا): `GET /admin/roles` (قائمة الأدوار المتاحة)، `GET /admin/users/:userId/roles`، و`POST`/`DELETE /admin/users/:userId/roles` (منح/سحب دور — محتاجين `roles.manage` بنفسهم، يعني `super_admin` بس فعلياً حسب البذر الحالي).
- **بوتستراب الأدمن الأول**: مفيش endpoint عام يقدر يمنح أول `super_admin` لنفسه (ده مقصود، مش قصور) — لازم `INSERT INTO user_roles` مباشر وقت التجهيز الأولي للبيئة، بالظبط زي ما اتعمل هنا وقت الاختبار. بعد كده كل تعيين تاني بيعدّي من الـ API.
- **اتعمله اختبار end-to-end فعلي شامل**: أدمن من غير أي دور قدر **يشوف** الطلبات والفنيين لكن اترفض (403) من إلغاء طلب وموافقة صرف؛ `ops_manager` قدر يلغي طلب (اترفض بعدها بـ"غير موجود" مش بصلاحية، يعني عدّى فحص الصلاحية فعلاً) بس اترفض من صرف الفلوس؛ `finance` عكسه بالظبط؛ `super_admin` عدّى الاتنين؛ منح دور لأدمن من واحد مالوش `roles.manage` اترفض؛ `super_admin` منح دور فعلاً ونفس الأدمن (بنفس التوكن القديم من غير أي re-login) بقى يقدر يعمل الفعل المرتبط فوراً — إثبات إن الفحص حي من القاعدة مش متخزّن في التوكن؛ سحب الدور رجّع المنع فوراً برضه؛ منح نفس الدور مرتين أو دور غير موجود اترفضوا بوضوح؛ ومنح دور لمستخدم مش أدمن اترفض.
- **فجوة موثّقة متبقية**: مفيش حماية ضد سحب آخر `super_admin` في النظام (ممكن يحصل قفل كامل لحد ما حد يصلحها بـ SQL مباشر).

## سجل التدقيق (`GET /admin/audit-logs`)

اتقفلت فجوة تانية كانت هنا: مفيش endpoint ولا كتابة تلقائية للأحداث الإدارية. دلوقتي موصولة فعلياً — 10 أفعال إدارية حساسة عبر 5 موديولات بتسجّل مين عمل إيه وإمتى وقبل/بعد التعديل، مقصورة على `super_admin` بس (`audit.view`). التفاصيل الكاملة والاختبار في `../audit/README.md`.

## إعدادات النظام (`GET/PATCH /admin/settings`)

فجوة تالتة اتقفلت: `GET/PATCH /admin/settings` بقت شغالة فعلياً وموصولة بمستهلك حقيقي (`PayoutsService`) مش مجرد CRUD شكلي — تغيير حد أدنى الصرف عبر الـ API أثّر فوراً على قرار حقيقي من غير أي تعديل كود. التفاصيل الكاملة والاختبار في `../settings/README.md`.

**لسه من غير من §13.7** (فجوة موثّقة، مش سهو):
- `GET /admin/customers` + `/:id/block`
- `PATCH /admin/orders/:id/adjust-price`
- `POST /admin/technicians/:id/suspend`, `PATCH /admin/technicians/:id/level`
- `GET /admin/reports/technicians`, `GET /admin/reports/zones`.

مرجع كامل: `../../../../docs/02-data-dictionary.md` §13.7 و `../../../../docs/01-master-plan.md` §2.4.
