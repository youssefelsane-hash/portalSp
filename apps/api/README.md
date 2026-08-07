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

**باقي الموديولات (`orders`, `matching`, `payments`, ...) لسه هياكل فاضية (README بس) — الخطوة الجاية.**

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
