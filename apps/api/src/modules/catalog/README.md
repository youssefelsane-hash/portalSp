# modules/catalog

التصنيفات والخدمات والتسعير. جداول: service_categories, services, service_zone_pricing, service_level_pricing, service_addons, technician_services (قاموس §5).

**الحالة: شغال — قراءة عامة + إدارة أدمن ديناميكية كاملة.**

- `GET /service-categories`, `GET /services?category_id=`, `GET /services/:id` — endpoints عامة (`@Public()`).
- `POST /services/:id/estimate?zone_id=` — بيرجّع سعر تقديري: بياخد `service_zone_pricing` لو فيه override نشط للمنطقة، وإلا بيرجع لسعر الخدمة الأساسي × `surge_multiplier`.

## إدارة الأدمن الديناميكية (`AdminCatalogController`, `@RequirePermission('catalog.manage')`)

الهدف: الأدمن يقدر يضيف/يعدّل/يمسح أي فئة أو خدمة **من غير أي تعديل كود** — بالظبط زي المطلوب (Category → sub-category → service، بهيكلية شجرية حرة عن طريق `parent_category_id`).

- **`/admin/service-categories`**: `POST` (إنشاء، بيرفض `slug` مكرر ويتحقق إن الأب موجود لو محدد)، `PATCH` (تعديل أي حقل، بيرفض إن الفئة تبقى أب لنفسها)، `DELETE` (soft-delete — بيرفض لو فيه خدمات لسه مرتبطة بالفئة، لازم تتعطّل أو تتنقل الأول).
- **`/admin/services`**: نفس النمط — `POST`/`PATCH`/`DELETE`. أي تغيير سعر (`base_price_cents`) بيتطبّق فوراً على `POST /services/:id/estimate` من غير أي إعادة نشر أو تعديل كود.
- **`/admin/services/:id/zone-pricing`**: `PUT` upsert (سعر مختلف لمنطقة معيّنة + `surge_multiplier`) و `DELETE .../zone-pricing/:pricingId` (تعطيل). الـ upsert بيدوّر على صف نشط موجود لنفس (خدمة، منطقة) بدل ما يكرّر صفوف.
- **`/admin/services/:id/technicians`**: تحديد الفنيين المؤهلين لخدمة معيّنة (`technician_services`) — `POST` (تعيين بمستوى مهارة، بيرفض تكرار وفني غير موجود)، `DELETE .../technicians/:technicianId`.
- **كل عملية بتتسجّل في سجل التدقيق** (`../audit/README.md`) — `service.created`/`updated`/`deleted`, `service_category.*`, `service_zone_pricing.*`, `technician_service.assigned`/`removed`.
- اتعمله اختبار end-to-end فعلي شامل مطابق لمثال المستخدم بالحرف: فئة "خدمات منزلية" ← فئة فرعية "تنظيف" (بإعادة ربط فئة موجودة بأب جديد) ← خدمة "تنظيف كنب" — ظهرت فوراً في `GET /services` العام. تعديل السعر (من 250 لـ 300 جنيه) اتطبّق فوراً على `estimate`. تعطيل الخدمة خفاها من القائمة العامة فوراً. تسعير منطقة مخصص (350 جنيه + surge 1.2) اتطبّق صح على `estimate` وقفل السطر الأول لما اتعدّل تاني بدل ما يكرّره. تعيين فني كمستوى "خبير" نجح، تكراره اترفض، فني وهمي اترفض بـ404، وشيله نجح. حذف فئة فيها خدمة لسه اترفض بوضوح، وبعد حذف الخدمة الحذف نجح (soft-delete حقيقي — اختفت من قائمة الأدمن). عميل عادي اترفض بالكامل من كل مسارات الإدارة (403 من `RolesGuard` قبل حتى `PermissionsGuard`).
- **`catalog.manage`** صلاحية جديدة (`infra/migrations/0022_catalog_manage_permission.sql`) — `super_admin` و`ops_manager` بس.
- لسه من غير: `service_level_pricing` (فرق السعر حسب مستوى الفني)، `service_addons`.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
