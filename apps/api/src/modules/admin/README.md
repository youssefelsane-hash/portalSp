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

**لسه من غير من §13.7** (فجوة موثّقة، مش سهو):
- `GET /admin/customers` + `/:id/block`
- `PATCH /admin/orders/:id/adjust-price`
- `POST /admin/technicians/:id/suspend`, `PATCH /admin/technicians/:id/level`
- `GET/POST /admin/promo-codes` (CRUD) — `promotions` لسه هيكل فاضي.
- `GET/POST /admin/services` (CRUD)
- `GET/PATCH /admin/settings` — جدول `settings` موجود من `infra/migrations/0011` بس مفيش endpoints.
- `GET /admin/audit-logs` — جدول `audit_logs` موجود بس مفيش endpoint ولا كتابة تلقائية للأحداث الإدارية لسه.
- `GET /admin/reports/technicians`, `GET /admin/reports/zones`.
- فجوة الصلاحيات الدقيقة (`support_agent`/`finance`/`super_admin`) لسه موجودة برضه — موثّقة بالتفصيل في `support/README.md`.

مرجع كامل: `../../../../docs/02-data-dictionary.md` §13.7 و `../../../../docs/01-master-plan.md` §2.4.
