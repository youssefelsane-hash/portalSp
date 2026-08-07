# apps/api — NestJS Backend

الـ Backend الأساسي (Modular Monolith). كل موديول جوّه `src/modules/*` وله حدود مستقلة (راجع §2.4 في الماستر بلان).

الستاك: NestJS + PostgreSQL 16 + PostGIS + Redis (لسه) + TypeORM (query layer بس — الـ schema مصدره `infra/migrations` الوحيد، `synchronize: false` دايماً).

## الحالة

**موديول `auth` كامل وشغال (S1 من المرحلة 1 — MVP):**

- تسجيل ودخول برقم موبايل + OTP (`otp_codes` مُشفّرة بـ bcrypt، 5 محاولات كحد أقصى)
- JWT access token (15 دقيقة) + refresh token بتدوير كامل (كل استخدام يبطّل القديم، وإعادة استخدام توكن مُلغى تقفل كل توكنات المستخدم فوراً)
- RBAC على مستوى `user_type` عبر `@Roles()` + `RolesGuard`، وكل الـ endpoints محمية افتراضياً إلا اللي معلّم عليها `@Public()`
- Rate limiting: 60 طلب/دقيقة عام، 5/دقيقة على `POST /auth/otp/request`
- عقد استجابة موحّد `{success, data, meta, error, request_id}` عبر `ResponseInterceptor` + `AllExceptionsFilter`، وأكواد الأخطاء مطابقة لـ `docs/02-data-dictionary.md` §13.9
- اختبار end-to-end فعلي تم على قاعدة بيانات PostgreSQL+PostGIS حقيقية (مش mock) — كل الـ endpoints شغالة ومطابقة للعقد المُوثّق

**موديولات `geo`, `customers`, `technicians`, `catalog` شغالة جزئياً (S2):**

- `geo`: `GET /cities`, `GET /cities/:id/areas` (قراءة بس)
- `customers`: `customer_profiles` بتتعمل تلقائياً وقت التسجيل (حدث `user.registered` — لا استدعاء مباشر من `auth`)، و CRUD كامل على `/addresses` مع التحقق من تغطية المنطقة
- `technicians`: `technician_profiles` بتتعمل تلقائياً برضه، مع `technician_code` مولّد من DB sequence، و`GET /technician/me`, `GET /technician/level` محميين بـ RBAC
- `catalog`: `GET /service-categories`, `GET /services`, `GET /services/:id`, `POST /services/:id/estimate`

كل ده اتعمله اختبار end-to-end فعلي: تسجيل عميل/فني حقيقي → إنشاء بروفايل تلقائي → عنوان في منطقة مُطلقة (نجح) وفي منطقة مش مُطلقة (اترفض بالكود الصح ORDR_001) → تسعير تقديري لخدمة حقيقية → RBAC بيمنع عميل من مسارات الفني (403).

**موديول `orders` شغال جزئياً (S3) — الإنشاء والإلغاء:**

- `order-state-machine.ts`: state machine مقفولة كاملة (كل الـ 18 حالة من القاموس §6.2) — انتقال مش معرّف = `ORDR_003`.
- `POST /orders`: يتحقق من ملكية العنوان، الخدمة، نطاق التغطية، يحسب السعر التقديري، ويولّد `order_number` تسلسلي — كل ده جوّه transaction واحدة مع أول صف تاريخ حالة.
- `POST /orders/:id/cancel`: بيحترم الـ state machine، وبيرفض إلغاء طلب اتلغى قبل كده.
- اتعمله اختبار end-to-end فعلي كامل: إنشاء طلب → ظهوره فوراً في القايمة والتفاصيل → صف في `order_status_history` → إلغاء → رفض إلغاء تاني (409) → RBAC بيمنع الفني من مسار العميل.

**باقي الموديولات (`matching`, `payments`, ...) لسه هياكل فاضية (README بس) — الخطوة الجاية.**

## التشغيل محلياً

```bash
cp .env.example .env   # عدّل الأسرار
npm install
npm run start:dev
```

محتاج قاعدة بيانات مطبّق عليها كل الـ migrations (راجع `../../infra/migrations`).

## الاختبارات

```bash
npm test
```

مرجع كامل: `../../docs/01-master-plan.md`, `../../docs/02-data-dictionary.md` §13
