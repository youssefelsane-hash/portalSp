# modules/geo

المدن، المناطق، النطاقات الجغرافية (PostGIS). جداول: countries, cities, areas, service_zones (قاموس §3.1).

**الحالة: شغال جزئياً (S2) — قراءة بس.**
- `GET /cities` — المدن النشطة.
- `GET /cities/:cityId/areas` — المناطق المُطلقة (`is_launched=true`) في مدينة معينة.
- `GeoService.isAreaLaunched()` مُصدّرة لموديولات تانية (زي `customers`) تتحقق منها قبل قبول عنوان.
- لسه من غير: إدارة (CRUD) للمدن/المناطق من لوحة التحكم، ولا بحث جغرافي بالـ point-in-polygon (`ST_Contains`) — العميل دلوقتي بيختار المنطقة من قائمة بدل ما تتحدد تلقائياً من الإحداثيات.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
