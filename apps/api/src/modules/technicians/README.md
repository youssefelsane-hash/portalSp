# modules/technicians

الفنيين، المستندات، المستويات (Bronze→Platinum)، التوافر. جداول: technician_profiles, technician_documents, technician_services, technician_zones, technician_level_history, technician_availability (قاموس §4.2-4.7).

**الحالة: شغال جزئياً (S2 + S4 + بداية S9 — اعتماد الفنيين).**
- `technician_profiles` بيتعمل تلقائياً لما فني يسجل (مستمع لحدث `user.registered`)، مع `technician_code` مولّد من sequence في الداتابيز (`infra/migrations/0017`, صيغة `TECH-000123` من غير سنة).
- `national_id_encrypted` بيفضل NULL لحد ما الفني يكمّل مسار القبول (§9.3 في الماستر بلان) — اتعدّل الـ schema في `infra/migrations/0018` عشان يسمح بده.
- `GET /technician/me`, `GET /technician/level` — للفني بس (`@Roles(TECHNICIAN)`), جُرِّب فعلياً إن عميل بيتاخد 403 لو حاول يوصلهم.
- `PATCH /technician/availability` (`is_available`, `is_on_duty`), `POST /technician/location` (`latitude`/`longitude` → بيتخزن كـ `geography(Point)`) — أضيفوا عشان `matching` (S4) محتاجهم فعلياً يشتغل، اتعمله اختبار حقيقي مع 5 فنيين وإحداثيات مختلفة والمسافة اتحسبت صح بـ PostGIS.
- **رفع المستندات (`POST/GET /technician/documents`)**: الفني بيرفع مستنداته (بطاقة، سجل جنائي، شهادة مهنية، ...) بنفس نمط `orders/order-media.service.ts` (multipart عبر `StorageService`)، وكل مستند بيبدأ `pending` لحد ما الأدمن يراجعه.
- **`technician-verification-state-machine.ts`**: state machine مقفولة لـ `verification_status`. ملحوظة تصميم صريحة: القاموس بيعرّف حالات وسيطة (`documents_submitted`, `under_review`, `interview_scheduled`, `test_passed`) بس مفيش endpoints بنتها لسه تنقل الفني بينهم يدوياً (جدولة مقابلة، رصد نتيجة اختبار) — فالـ state machine بتسمح بالانتقال المباشر لـ `approved`/`rejected` من أي حالة وسيطة، عشان القرارين المتاحين فعلياً (موافقة/رفض) يشتغلوا من أي نقطة. **بَقّة حقيقية اتصلحت قبل ما توصل للاختبار**: النسخة الأولى من الـ state machine كانت بترفض `pending→approved` مباشرة (بتطلب `under_review` الأول) مع إن مفيش endpoint أصلاً ينقل لـ `under_review` — يعني فني جديد ماكانش هيتوافق عليه أبداً. اتصلحت بجعل `approved`/`rejected` متاحين من كل حالة وسيطة.
- **`AdminTechniciansController`** (`/admin/technicians`, `@Roles(ADMIN)`): `GET` (قائمة مفلترة بـ `verification_status`/`level` + صفحات)، `GET /:id` (تفاصيل + كل المستندات)، `POST /:id/approve`, `POST /:id/reject` (سبب إلزامي 5-500 حرف)، `POST /:id/documents/:documentId/review` (approve/reject لمستند واحد، `rejection_reason` إلزامي لو `rejected`، ومستند اتراجع قبل كده يترفض تاني مراجعة — قرار نهائي مش قابل للتراجع، الفني يرفع نسخة جديدة لو محتاج).
- حدث `technician.verification_changed` بيتصدر بعد كل قرار approve/reject — `notifications` بيسمعه ويبعت للفني نفسه (تهنئة أو سبب الرفض).
- اتعمله اختبار end-to-end فعلي شامل: فني رفع مستندين حقيقيين (وترفض نوع ملف غير مسموح)، أدمن راجع واحد approved وواحد rejected بسبب، حاول يراجع المُوافَق عليه تاني فاترفض (409)، وافق على الفني (`pending→approved` نجح بعد التصحيح) والإشعار وصله فوراً بمحتوى صحيح، حاول يوافق تاني فاترفض (مفيش self-loop)، رفض فني تاني بسبب ووصله إشعار فيه نص السبب بالظبط، عميل حاول يوصل لمسارات الأدمن فاترفض 403، وفلترة/صفحات القائمة اتأكد منها.
- **فجوة موثّقة**: مفيش endpoints للحالات الوسيطة (`documents_submitted`/`under_review`/`interview_scheduled`/`test_passed`) ولا لـ `suspend` (تعليق فني معتمد) — القرار الوحيد المتاح دلوقتي approve/reject مباشر. تعيين `technician_services`/`technician_zones` لسه يدوي عبر SQL. باقي S9 (متابعة الطلبات لحظياً + تدخل يدوي، والتقارير) لسه الخطوة الجاية.

## شركات/فرق الفنيين (`/technician/company`) — جديد (S10)

بتغطي الطلب الأصلي بمفهوم واحد: **فني مستقل** (الوضع الافتراضي، `team_role=independent`) أو **عضو في فريق/شركة**. مفيش تفرقة بين "فريق" و"شركة" في الـ schema عمداً — الفريق ببساطة شركة من غير سجل تجاري رسمي أو فروع، فمفهوم واحد (`technician_companies` + `technician_company_branches`) كافي لمثال شركة النظافة (Manager/Supervisors/Workers) في الطلب. `infra/migrations/0026`.

- **`team_role`**: `independent | owner | manager | supervisor | worker` على `technician_profiles` — منفصل تماماً عن `roles`/`permissions` الإدارية (0003/0020)، ده سلطة داخل الشركة نفسها مش صلاحية على نظام baytak.
- **ذاتية الإدارة بالكامل** — مفيش تدخل أدمن مطلوب لإنشاء/إدارة شركة:
  - `POST /technician/company` — أي فني (مش عضو في شركة بالفعل) بينشئ شركة ويبقى `owner` تلقائياً.
  - `GET /technician/company` — أي عضو (أي دور) يشوف الشركة + الفروع + الفريق كامل.
  - `PATCH /technician/company`, `POST/PATCH /technician/company/branches[/:branchId]` — `owner`/`manager` بس.
  - `POST /technician/company/staff` (بـ`technician_code`، مش UUID — أسهل للفني يعرفه) و`PATCH`/`DELETE /technician/company/staff/:userId` — `owner`/`manager` بس، وممنوع يلمسوا الـ`owner` نفسه من المسارات دي (نقل الملكية خارج النطاق دلوقتي، فجوة موثّقة).
- **إشراف الأدمن (`/admin/technician-companies`) read-only بالكامل عمداً** — `GET` (قائمة بعدد الفروع/الأعضاء) و`GET /:id` (تفاصيل + الفريق كامل)، مفتوحة لأي أدمن زي باقي الـ`GET`s، مفيش `@RequirePermission` لأن مفيش فعل بيتغيّر.
- **اتعمله اختبار end-to-end فعلي كامل** بـ 3 فنيين حقيقيين مسجّلين فعلاً: فني أنشأ شركة وبقى owner، عمل فرع، ضاف فني تاني كـ`manager` على الفرع ده — وبعدين الـ**manager نفسه** (مش الـowner) ضاف فني ثالث كـ`worker`، إثبات إن السلطة المفوّضة شغالة فعلياً مش owner بس. `worker` اترفض (403) من إضافة عضو لكن قدر **يشوف** الفريق كامل؛ owner اترفض من إنشاء شركة تانية (409، عنده واحدة بالفعل)؛ إضافة نفس الفني تاني اترفضت ("عضو بالفعل")؛ owner اترفض من إضافة نفسه؛ كود فني مش موجود اترفض بوضوح (404)؛ manager عدّل دور الـworker لـ`supervisor` ثم شاله من الشركة، ورجع الفني `independent` فعلاً (اترفض تاني `GET /technician/company` بـ404 "مش عضو")؛ محاولة الـmanager يشيل الـowner اترفضت (403)؛ الأدمن شاف قائمة الشركات بعدد فروع/أعضاء صحيح والتفاصيل الكاملة؛ وكل عملية (إنشاء شركة، فرع، إضافة/تعديل/إزالة عضو) اتسجّلت في سجل التدقيق بـ`actor_role=technician`.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
