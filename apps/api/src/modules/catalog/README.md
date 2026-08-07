# modules/catalog

التصنيفات والخدمات والتسعير. جداول: service_categories, services, service_zone_pricing, service_level_pricing, service_addons (قاموس §5).

**الحالة: شغال جزئياً (S2) — قراءة + تسعير تقديري.**
- `GET /service-categories`, `GET /services?category_id=`, `GET /services/:id` — endpoints عامة (`@Public()`).
- `POST /services/:id/estimate?zone_id=` — بيرجّع سعر تقديري: بياخد `service_zone_pricing` لو فيه override نشط للمنطقة، وإلا بيرجع لسعر الخدمة الأساسي × `surge_multiplier`.
- اتعمله اختبار end-to-end فعلي مع خدمة وتصنيف حقيقيين في قاعدة بيانات فعلية.
- لسه من غير: `service_level_pricing` (فرق السعر حسب مستوى الفني)، `service_addons`، وإدارة CRUD من لوحة التحكم.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
