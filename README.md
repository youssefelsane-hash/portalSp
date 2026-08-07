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

## 🚦 حالة المشروع

**المرحلة الحالية: P0 — التأسيس.** لسه في خطوة تجهيز البنية التحتية (§5 — السبرنت 0.3).
راجع [أول 14 يوم](docs/01-master-plan.md#13-أول-14-يوم--خطوة-بخطوة-ابدأ-من-هنا) في الماستر بلان للخطوة الجاية بالظبط.
