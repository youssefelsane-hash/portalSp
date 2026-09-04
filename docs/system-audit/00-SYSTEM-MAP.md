# 00 — خريطة النظام (System Map)

> نقطة الدخول لتدقيق النظام. كل رقم هنا **معدود فعليًا** من المستودع وقاعدة البيانات
> الحيّة (`baytak_main`)، مش تقديريًا.

---

## 1. الجرد الحقيقي

| المكوّن | التقنية | الحجم |
|---------|---------|-------|
| `apps/api` | NestJS + TypeORM + PostgreSQL/PostGIS + Redis + BullMQ | **2,057 ملف TS**، ~141,000 سطر، **39 موديول** |
| `apps/admin` | Next.js 16 + shadcn/ui | 136 ملف، **61 صفحة** |
| `apps/customer-web` | Next.js 16 | 71 ملف، **25 صفحة** |
| `apps/customer-app` | Flutter | **159 ملف Dart** |
| `apps/technician-app` | Flutter | **119 ملف Dart** |
| `packages/` | `shared-types` · `shared-ui` · `config` | أنواع وثوابت وقت-تشغيل مشتركة |
| `infra/migrations/` | SQL خام | **260 migration** (بفحص checksum) |
| `docs/adr/` | قرارات معمارية | **72 ADR** |

### قاعدة البيانات

| | العدد |
|---|-------|
| الجداول | **159** |
| الأنواع المُعدَّدة (enums) | **96** |
| مفاتيح الإعدادات (`settings`) | **180** |

### التغطية الاختبارية

**275 ملف spec** في `apps/api`، **1,651 اختبار** — كلها بتشتغل على **Postgres وRedis حقيقيين**
مش mocks. آخر تشغيل كامل: **1,651/1,651 ناجحة**.

---

## 2. البنية الكلية

```mermaid
flowchart TB
  subgraph Clients["العملاء"]
    CA["customer-app<br/>Flutter"]
    CW["customer-web<br/>Next.js"]
    TA["technician-app<br/>Flutter"]
    AD["admin<br/>Next.js"]
  end

  subgraph API["apps/api — NestJS"]
    direction TB
    CTRL["Controllers<br/>REST + Socket.IO"]
    SVC["Services<br/>39 موديول"]
    EV["EventEmitter<br/>مستمعون داخليون"]
    Q["BullMQ<br/>4 processors"]
    T["مؤقّتات دورية<br/>22 خدمة"]
  end

  subgraph Data["البيانات"]
    PG[("PostgreSQL<br/>+ PostGIS<br/>159 جدول")]
    RD[("Redis<br/>cache + queues")]
    S3[("S3<br/>الوسائط")]
  end

  subgraph Ext["خدمات خارجية"]
    PM["Paymob"]
    FCM["FCM / Twilio / SMTP"]
    GM["Google Maps"]
  end

  CA --> CTRL
  CW --> CTRL
  TA --> CTRL
  AD --> CTRL
  CTRL --> SVC
  SVC --> EV
  SVC --> Q
  T --> SVC
  Q --> RD
  SVC --> PG
  SVC --> RD
  SVC --> S3
  SVC --> PM
  SVC --> FCM
  SVC --> GM
```

---

## 3. الموديولات الـ39 حسب المجال

### قلب العمل

| الموديول | الدور | مستند مفصّل |
|----------|-------|--------------|
| `orders` | دورة حياة الطلب، الإلغاء، إعادة الجدولة، المتكررة | [02](./02-ORDER-LIFECYCLE.md) |
| `pricing` | محرك المعادلات، وعاء العمولة، علاوة المستوى | [03](./03-PRICING-ENGINE.md) |
| `matching` | التوزيع، الجولات، الترتيب | [04](./04-MATCHING-ENGINE.md) |
| `catalog` | الخدمات، الفئات، تركيب السعر النهائي | [03](./03-PRICING-ENGINE.md) |
| `technicians` | الملفات، الجدولة، الإتاحة، المستويات، الفرق | [05](./05-SCHEDULING-AVAILABILITY.md) |
| `customers` | ملفات العملاء وإحصاءاتهم | — |

### المال

| الموديول | الدور |
|----------|-------|
| `payments` | التسوية، الاسترداد، البوابات، الصرف، توزيع الطاقم |
| `payouts` | (توثيق — المنطق داخل `payments`) |
| `installments` | التقسيط |
| `payment-policies` | سياسات الدفع ونسخها وموافقات المستخدمين |
| `promotions` | أكواد الخصم والحملات |

تفصيل كامل: [10 — تدفّق الأموال](./10-FINANCE-MONEY-FLOW.md)

### الخدمات المساعدة والتشغيل

`assistant-matching` · `projects` · `buildings` · `campaigns` · `operations` · `ops` ·
`geo` · `favorites` · `ratings` · `referrals` · `technician-referrals` · `academy`

### الفني — التقدّم والأداء

`technician-kpi` · `technician-productivity` · `technician-progression`

### المنصّة

`auth` · `users` · `security` · `admin` · `settings` · `audit` · `feature-flags` ·
`notifications` · `chat` · `internal-chat` · `support` · `branding` · `common`

---

## 4. الأنماط المعمارية الحاكمة

هذه الأنماط بتتكرّر عبر الموديولات، وفهمها بيوفّر قراءة نص المستودع:

### 4.1 مصدر حقيقة واحد لكل قاعدة

كل قاعدة عمل جوهرية متكتوبة **مرة واحدة** ومُستهلَكة من كل مكان بيسأل نفس السؤال:

| القاعدة | المصدر الوحيد | عدد المستهلكين |
|---------|----------------|-----------------|
| انتقالات حالة الطلب | `order-state-machine.ts` | كل المسارات |
| أهلية الفني | `technicianAvailabilityCondition()` | 3 (توزيع، قائمة، حارس تعيين) |
| السقف اليومي | `technician-day-capacity.sql.ts` | الأهلية + التصنيف |
| وعاء العمولة | `commission-base.ts` | التسوية + الأدمن |
| حدود المعادلة | `formula-limits.ts` | الباك-إند + محرر الأدمن |

**السبب**: منع انحراف (drift) بين نسختين لنفس المنطق. كل بند في الجدول ده كان **بَقّة حقيقية**
قبل التوحيد.

### 4.2 الفشل الآمن للبنية التحتية

أي فشل في cache/queue/تدقيق **لازم يتلقّط ويرجع للمسار الأساسي** — أبدًا ميكسرش عملية حقيقية
للمستخدم.

> الدرس المكلف: `queue.add()` كانت بتعلّق طلبًا حقيقيًا (تقييم/دفع) لدقايق وقت انقطاع Redis
> قبل ما يتكتشف.

نفس الفلسفة على: `AuditLogService.record()` · `service_pricing_evaluations` ·
`linkEvaluationToOrder()`.

### 4.3 الذرّية عند نقاط المال والجدولة

كل عملية بتلمس مالًا أو حجزًا بتتم جوّه transaction واحدة مع `pessimistic_write` + إعادة
تحقق من الحالة بعد القفل:

- الإلغاء + تحصيل الرسوم
- إنشاء الطلب + حجز السلوت
- إعادة الجدولة (تحرير + حجز)
- التسوية + توزيع الطاقم

### 4.4 التعويض الدوري (لأن الأحداث بتضيع)

الأحداث الداخلية (`EventEmitter`) مش مضمونة عبر إعادة التشغيل. فكل مسار حرج له **مسح دوري**
بيعيد بناء الحالة من البيانات الدائمة:

`reconcileReleasedSlots()` · `webhook-recovery` · `assistant-matching-recovery` ·
`order-chat-recovery` · `referral-recovery` · `technician-referral-recovery`

تفصيل: [19 — المهام الخلفية](./19-BACKGROUND-JOBS-EVENTS.md)

### 4.5 التوقيت — القاهرة صراحة

التخزين UTC، والمقارنة `AT TIME ZONE 'Africa/Cairo'` صراحة في كل استعلام بيقارن يومًا أو ساعة.
الاعتماد على توقيت جلسة Postgres كان بيرجّع **اليوم الغلط** لأي وقت بين نص الليل و٢ الصبح.

### 4.6 كل الأسعار بالقرش

`integer` مش `float`، في كل مكان بلا استثناء.

---

## 5. الاتفاقيات

| البند | القاعدة |
|-------|---------|
| أسماء الجداول/الأعمدة | `snake_case` |
| الكود | `camelCase` |
| مسارات الـAPI | `kebab-case` |
| كل جدول | `id, created_at, updated_at, deleted_at` |
| Migrations | SQL خام، `synchronize:false` دايمًا، **ما تعدّلش migration اتعمل commit** |
| التعليقات | عربي، وبس لما السبب مش واضح من الاسم |

---

## 6. تشغيل النظام محليًا

```bash
# البنية التحتية
docker compose -f infra/docker/docker-compose.yml up -d   # Postgres + Redis

# الباك-إند
cd apps/api && npm run start:dev

# الاختبارات (محتاجة DATABASE_URL صريح)
export DATABASE_URL=postgres://baytak:baytak@localhost:5432/baytak_main
npx tsc --noEmit && npx nest build && npx jest

# الأدمن / الويب
cd apps/admin && npm run dev
cd apps/customer-web && npm run dev

# Flutter (السـدك مش في PATH افتراضيًا)
export PATH="$PATH:/opt/flutter/bin"
cd apps/customer-app && flutter test test_live/ --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

> ⚠️ **فخّ متكرر**: `DATABASE_URL` **مش** بيتحمّل تلقائيًا في jest — الـfallback المكتوب في
> 193 spec بيشاور على قاعدة بيانات `baytak` القديمة. لازم تصدّره صراحة قبل التشغيل، وإلا
> هتشوف أخطاء زي `column Order.price_status does not exist` وتفتكرها بَقّة كود.

---

## 7. دليل المستندات

| # | المستند | المحتوى |
|---|---------|---------|
| 00 | خريطة النظام | ✅ هذا المستند |
| 01 | [دليل العمليات للأدمن](./01-ADMIN-OPERATIONS-HANDBOOK.md) | مين بيعمل إيه، والمهام اليومية خطوة بخطوة |
| 02 | [دورة حياة الطلب](./02-ORDER-LIFECYCLE.md) | 21 حالة، الانتقالات، الإلغاء والرسوم |
| 03 | [محرك التسعير](./03-PRICING-ENGINE.md) | المعادلات، الأمان، تركيب السعر، التتبّع |
| 04 | [محرك المطابقة](./04-MATCHING-ENGINE.md) | الأهلية، الجولات، صيغة الترتيب |
| 05 | [الجدولة والإتاحة](./05-SCHEDULING-AVAILABILITY.md) | السلوتات، التعارض، السقف اليومي |
| 06 | [الطلبات العاجلة ونفس اليوم](./06-SAME-DAY-URGENT-ORDERS.md) | الاستعجال مشتق من التاريخ |
| 07 | [المتكررة والمشاريع](./07-RECURRING-ORDERS.md) | القوالب والمناسبات، المراحل والاحتجاز |
| 08 | [إدارة العملاء](./08-CUSTOMER-MANAGEMENT.md) | الطبقات الأربع، الولاء، الإحالة |
| 09 | [إدارة الفنيين](./09-TECHNICIAN-MANAGEMENT.md) | المستويات، الترقية، الاعتماد |
| 10 | [تدفّق الأموال](./10-FINANCE-MONEY-FLOW.md) | القيد المزدوج، العمولة، الصرف |
| 11 | [مؤشّرات الأداء](./11-KPI-ANALYTICS.md) | الأبعاد الستة والمكافآت |
| 12 | [كتالوج الإعدادات](./12-SETTINGS-CATALOG.md) | 180 مفتاح مُولَّد من القاعدة |
| 13 | [الإشعارات والتتبّع](./13-NOTIFICATIONS-REALTIME.md) | القنوات، ساعات الهدوء، Socket.IO |
| 14 | [الدعم والشكاوى](./14-SUPPORT-CHAT-COMPLAINTS.md) | آلة حالات الشكوى، المحادثات |
| 15 | [الشركات والفرق والمساعدون](./15-COMPANIES-TEAMS-ASSISTANTS-PROJECTS.md) | أربعة مفاهيم متشابهة الاسم |
| 16 | [كتالوج الميزات](./16-FEATURE-CATALOG.md) | مصفوفة الحالة الحقيقية لكل ميزة |
| 17 | [خريطة قاعدة البيانات](./17-DATABASE-MAP.md) | جداول مصنَّفة + القيود |
| 18 | [خريطة الـAPI](./18-API-MAP.md) | 591 مسار مُستخرَج آليًا |
| 19 | [المهام الخلفية والأحداث](./19-BACKGROUND-JOBS-EVENTS.md) | الطوابير، المؤقّتات، التعويض |
| 20 | [الأمان والصلاحيات](./20-SECURITY-PERMISSIONS.md) | البوابات الأربع، MFA، Step-Up |
| — | [البَقّات المكتشفة والمصلَّحة](./BROKEN_FLOWS_FIXED.md) | 17 بَقّة بإثبات + 4 نفيات بدليل |

**ابدأ من فين؟**

| لو إنت… | اقرأ |
|---------|------|
| أدمن جديد | [01](./01-ADMIN-OPERATIONS-HANDBOOK.md) ثم [16](./16-FEATURE-CATALOG.md) |
| مطوّر جديد | هذا المستند ثم [02](./02-ORDER-LIFECYCLE.md) و[17](./17-DATABASE-MAP.md) |
| بتراجع المال | [10](./10-FINANCE-MONEY-FLOW.md) ثم [03](./03-PRICING-ENGINE.md) |
| بتشخّص «مفيش فنيين» | [04](./04-MATCHING-ENGINE.md) و[05](./05-SCHEDULING-AVAILABILITY.md) |
| بتدوّر على بَقّة معروفة | [BROKEN_FLOWS_FIXED](./BROKEN_FLOWS_FIXED.md) |

**مراجع خارج هذا المجلد**: `docs/01-master-plan.md` (الخطة) · `docs/02-data-dictionary.md`
(قاموس البيانات وعقد الـAPI) · `docs/03-external-integrations.md` (تفعيل الخدمات الخارجية) ·
`docs/08-pricing-engine-and-platform-vision.md` (الـbacklog الحيّ) · `docs/adr/` (72 قرارًا).
