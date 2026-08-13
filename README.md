# baytak — منصة الخدمات المنزلية

> **الاسم الكودي الرسمي في كل الكود والملفات: `baytak`**

منصة خدمات منزلية متكاملة (زي أوبر بس للخدمات المنزلية) — تبدأ بسباكة/كهرباء/تكييف/تنظيف في حيّين بالقاهرة، وتتوسع على 5 سنين لمغاسل، شركات B2B، ذكاء اصطناعي، Marketplace، اشتراكات، وإدارة منزلية كاملة.

هذا المستودع هو نقطة البداية الرسمية للمشروع. أي عمل — تصميم، كود، قرار — لازم يرجع لملفين المرجع في `docs/` قبل أي حاجة تانية.

---

## 📚 المستندات المرجعية (لازم تتقرأ الأول)

| الملف | المحتوى |
|---|---|
| [`docs/01-master-plan.md`](docs/01-master-plan.md) | **الخطة الرئيسية** — السكربت الحرفي لدورة العمل، قواعد التسمية، المعمارية، خط النشر، تفصيل كل مرحلة من P0 لـ P9، الأمان، الاستقرار (SRE)، نظام الجودة، المخاطر، أول 14 يوم |
| [`docs/02-data-dictionary.md`](docs/02-data-dictionary.md) | **قاموس البيانات وعقد الـ API** — كل جدول وكل عمود وكل نوع بيانات، عقد REST كامل، أحداث WebSocket، أكواد الأخطاء |

⚠️ **قاعدة حاكمة:** بعد اعتماد `02-data-dictionary.md`، أي تغيير في اسم جدول أو عمود لازم migration موثّق + رقم نسخة جديد.

---

## 🔁 بطاقة استعادة السياق

انسخ الكارت ده وابعته لأي محادثة جديدة لو الموديل نسي السياق:

```
السياق: مشروع baytak — منصة خدمات منزلية في مصر.
نشتغل بملفين مرجعيين: docs/01-master-plan.md (الخطة) و docs/02-data-dictionary.md (قاموس البيانات والـ API).
الستاك: NestJS + PostgreSQL + Redis + Flutter + Next.js.
إحنا حالياً في: المرحلة __ / السبرنت __ / الخطوة رقم __.
آخر حاجة خلصناها: ____.
المطلوب دلوقتي: ____.
قواعد ثابتة: أسماء الجداول والأعمدة snake_case، الكود camelCase، الـ API routes kebab-case،
كل الأسعار بالقرش (integer)، كل الأوقات UTC، كل جدول فيه id, created_at, updated_at, deleted_at.
```

---

## 🏗️ بنية المستودع (Monorepo)

```
baytak/
├── apps/
│   ├── api/              # NestJS backend — Modular Monolith
│   ├── admin/            # Next.js لوحة الإدارة
│   ├── customer-app/     # Flutter تطبيق العميل
│   └── technician-app/   # Flutter تطبيق الفني
├── packages/
│   ├── shared-types/     # أنواع TypeScript مشتركة بين api/admin
│   ├── shared-ui/        # مكوّنات واجهة مشتركة
│   └── config/           # eslint / tsconfig مشترك
├── infra/
│   ├── docker/           # docker-compose للتطوير المحلي
│   ├── terraform/        # البنية التحتية ككود
│   └── migrations/       # migrations قاعدة البيانات (SQL)
├── docs/
│   ├── 01-master-plan.md
│   ├── 02-data-dictionary.md
│   ├── adr/              # قرارات معمارية موثقة (ADR)
│   └── runbooks/         # خطوات التعامل مع الأعطال
└── README.md
```

كل مجلد فيه `README.md` بيشرح دوره ويرجّع لقسم الماستر بلان المرتبط بيه.

---

## 📛 قواعد التسمية الثابتة (ملخص — التفاصيل في الماستر بلان §1.3)

| العنصر | القاعدة | مثال |
|---|---|---|
| اسم الجدول | `snake_case` جمع | `service_orders` |
| اسم العمود | `snake_case` مفرد | `total_amount_cents` |
| المفتاح الأجنبي | `<جدول مفرد>_id` | `technician_id` |
| Boolean | `is_` / `has_` | `is_active` |
| التواريخ | `_at` | `accepted_at` |
| المبالغ | `_cents` (integer دايماً) | `commission_amount_cents` |
| كود الكود (TS) | `camelCase` | `totalAmountCents` |
| الكلاس | `PascalCase` | `ServiceOrderService` |
| ملف الكود | `kebab-case` | `service-order.service.ts` |
| API route | `kebab-case` جمع | `/api/v1/service-orders` |
| Git branch | `type/ticket-desc` | `feat/BYT-102-order-create` |
| رقم التذكرة | `BYT-<رقم>` | `BYT-102` |

---

## 🚦 حالة المشروع (2026-08-13)

**مش P0 خالص — كود شغال ومختبر حي، قريب من جاهزية الإطلاق.** الملف ده كان فاضل موثّق بحالة قديمة
(P0/التأسيس) رغم إن المشروع فعليًا وصل لأكتر من 20 موديول باك-إند، لوحة أدمن كاملة، وتطبيقي Flutter
شغالين. الحالة الحقيقية دلوقتي:

- **`apps/api`** (NestJS + PostgreSQL/PostGIS + Redis + BullMQ) — ~20 موديول شغالة ومختبرة حيًا
  ضد Postgres/Redis حقيقيين (مش mocks): auth بالـOTP، الكتالوج + محرك تسعير ديناميكي + بيانات
  قياسية للإنتاجية، المطابقة (فني رئيسي + مساعد بالبث التنافسي الذرّي)، سياسة إلغاء فني كاملة
  قابلة للإعداد، مستويات الفنيين + مضاعف سعر حسب المستوى، الفرق/الشركات، المحفظة والدفع
  (Paymob/كاش/محفظة داخلية)، الإشعارات (توجيه حسب الدور)، القطاع المنزلي (شغالات)، العمائر
  (QR + خصم)، الأكاديمية (base)، مراقبة تشغيلية (queue watchdog + supervisor)، تحصين أمني
  (helmet + CORS allowlist + رفض أسرار افتراضية في الإنتاج + إصلاح ثغرات تبعيات — تفاصيل كاملة في
  `apps/api/README.md` §الأمان). تفاصيل كل موديول في `README.md` بتاعه.
- **`apps/admin`** (Next.js 16 + shadcn/ui) — شاشات كاملة ومختبرة (Playwright ضد الباك-إند
  الحقيقي): موظفين، فنيين، طلبات، كتالوج، تسعير، إعدادات، تقارير، سجل نشاط.
- **`apps/customer-app`, `apps/technician-app`** (Flutter) — كود شغال حقيقي (مش placeholder):
  auth، طلبات كاملة الدورة، دفع، شات وتتبع لحظي، اختيار فني + سعر نهائي قبل التأكيد، جدولة،
  مساعد. اختبارات حية حقيقية في `test_live/` لكل تطبيق، ورندر UI فعلي مُتحقق منه عبر Linux
  desktop build (تفاصيل في `apps/customer-app/README.md`).

**الفجوة الوحيدة الحقيقية قبل الإطلاق الفعلي: بيانات اعتماد الخدمات الخارجية الحقيقية** (بوابة
دفع Paymob، SMS/WhatsApp عبر Twilio، إيميل SMTP، Google Maps، S3/تخزين سحابي حقيقي) — الكود جاهز
100% لكل واحدة فيهم ومختبر بمحاكاة كاملة، بس محتاج القيم الحقيقية (API keys/secrets) تتحط في
`.env`. **الدليل الكامل لكل خدمة ومنين تجيب كل قيمة**: [`docs/03-external-integrations.md`](docs/03-external-integrations.md).

---

## 🚀 تشغيل محلي كامل (Quickstart)

للتجربة الكاملة على جهازك (Docker للبنية التحتية + Flutter للتطبيقات):

```bash
# 1) البنية التحتية (Postgres/PostGIS + Redis + MinIO كتخزين S3 محلي)
cd infra/docker && docker compose up -d

# 2) الباك-إند
cd apps/api
cp .env.example .env   # القيم الافتراضية بتشتغل مع docker-compose فوق من غير أي تعديل
npm install
node ../../infra/migrations/migrate.js   # يطبّق كل الـmigrations بالترتيب (DATABASE_URL من .env)
npm run start:dev      # http://localhost:3000/api/v1 — يحتاج Postgres+Redis شغالين من خطوة 1

# 3) لوحة الأدمن (تيرمنال تاني)
cd apps/admin
cp .env.example .env.local   # لو موجود، وإلا راجع apps/admin/README.md للقيم المطلوبة
npm install
npm run dev             # http://localhost:3001

# 4) تطبيقات Flutter (تيرمنال تالت لكل تطبيق)
cd apps/customer-app     # أو apps/technician-app
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1
# Android emulator بيوصل للـhost عن طريق 10.0.2.2 مش localhost — القيمة الافتراضية already كده
```

**بيانات دخول تجريبية**: بعد أول `migrate.js`، القاعدة فاضية من المستخدمين — سجّل حساب جديد من أي
تطبيق (OTP بيتسجّل في لوج الباك-إند نفسه لو `TWILIO_*` مش متظبطة — مفيش SMS حقيقي محتاج للتجربة
المحلية). لأول حساب `super_admin` (لا يوجد UI عمدًا لمنح أول أدمن — قرار أمان واعي، نفس مبدأ أي
نظام حقيقي)، بعد ما تسجّل حساب عادي من `apps/admin`/عبر `POST /auth/register`، امنحه الدور مباشرة:
```sql
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE u.phone_number = '+20xxxxxxxxxx' AND r.name = 'super_admin';
```
(الدور نفسه وكل صلاحياته متسجّلين بالفعل من migration `0020` — الخطوة دي بس بتربطه بحسابك).

**تشغيل الفحوصات قبل أي تعديل**: `cd apps/api && npx tsc --noEmit && npx nest build && npx jest`
(الثلاثة لازم يعدّوا نضيف). لـFlutter: `flutter analyze` في كل تطبيق.

---
راجع [أول 14 يوم](docs/01-master-plan.md#13-أول-14-يوم--خطوة-بخطوة-ابدأ-من-هنا) في الماستر بلان للخطوة الجاية بالظبط.
