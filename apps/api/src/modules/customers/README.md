# modules/customers

ملفات العملاء والعناوين. جداول: customer_profiles, addresses (قاموس §3.2, §4.1).

**الحالة: شغال (S2).**
- `customer_profiles` بيتعمل تلقائياً لما فني/عميل يسجل (مستمع لحدث `user.registered` من `auth`، مفيش استدعاء مباشر بين الموديولين).
- `AddressesService`/`AddressesController`: CRUD كامل على `/addresses`، بيتحقق إن المنطقة (`area_id`) مُطلقة فعلاً قبل قبول العنوان (`ORDR_001` لو لأ)، وبيحدّث `customer_profiles.default_address_id` تلقائياً.
- إحداثيات العنوان بتتخزن كـ `geography(Point)` عبر GeoJSON (`{type:'Point', coordinates:[lng,lat]}`) — TypeORM بيحوّلها لـ `ST_GeomFromGeoJSON` تلقائياً.
- اتعمله اختبار end-to-end فعلي: تسجيل عميل → إنشاء بروفايل تلقائي → إضافة عنوان في منطقة مُطلقة (نجح) → إضافة عنوان في منطقة مش مُطلقة (اترفض بالكود الصح).

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
