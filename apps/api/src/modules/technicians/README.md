# modules/technicians

الفنيين، المستندات، المستويات (Bronze→Platinum)، التوافر. جداول: technician_profiles, technician_documents, technician_services, technician_zones, technician_level_history, technician_availability (قاموس §4.2-4.7).

**الحالة: شغال جزئياً (S2) — البروفايل الأساسي بس.**
- `technician_profiles` بيتعمل تلقائياً لما فني يسجل (مستمع لحدث `user.registered`)، مع `technician_code` مولّد من sequence في الداتابيز (`infra/migrations/0017`, صيغة `TECH-000123` من غير سنة).
- `national_id_encrypted` بيفضل NULL لحد ما الفني يكمّل مسار القبول (§9.3 في الماستر بلان) — اتعدّل الـ schema في `infra/migrations/0018` عشان يسمح بده.
- `GET /technician/me`, `GET /technician/level` — للفني بس (`@Roles(TECHNICIAN)`), جُرِّب فعلياً إن عميل بيتاخد 403 لو حاول يوصلهم.
- لسه من غير: رفع المستندات، فحصها، اختبار القبول، التوافر (`is_available`/الجدول الأسبوعي)، مناطق العمل — دول جزء من S4/S5 مش S2.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
