# BAYTAK — قاموس البيانات وعقد الـ API
**النسخة: v1.0 — مجمّدة بعد الاعتماد**

> ⚠️ **قاعدة حاكمة:** بعد اعتماد الملف ده، أي تغيير في اسم عمود أو جدول لازم يمر بـ migration موثّق ورقم نسخة جديد. الأسماء دي هتفضل معانا سنين — نختارها مرة واحدة صح.

---

## 1. القواعد العامة لكل الجداول

كل جدول في النظام يحتوي إجبارياً على الأعمدة دي:

```sql
id           UUID          PRIMARY KEY DEFAULT uuid_generate_v7()
created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
deleted_at   TIMESTAMPTZ   NULL          -- soft delete
```

**قواعد الأنواع:**

| النوع | الاستخدام | مثال |
|---|---|---|
| `UUID` | كل المعرفات | `id`, `customer_id` |
| `VARCHAR(n)` | نصوص محددة الطول | `full_name VARCHAR(120)` |
| `TEXT` | نصوص طويلة | `description` |
| `INTEGER` | **كل المبالغ بالقرش** | `total_amount_cents` |
| `TIMESTAMPTZ` | كل الأوقات (UTC) | `accepted_at` |
| `BOOLEAN` | `is_` / `has_` | `is_active` |
| `JSONB` | بيانات مرنة | `metadata` |
| `GEOGRAPHY(POINT)` | الإحداثيات (PostGIS) | `location` |
| `enum` | الحالات | `order_status` |

---

## 2. جداول المصادقة والمستخدمين

### 2.1 `users` — المستخدم الأساسي

```sql
id                      UUID          PK
phone_number            VARCHAR(15)   UNIQUE NOT NULL   -- بصيغة E.164 مثال: +201001234567
phone_verified_at       TIMESTAMPTZ   NULL
email                   VARCHAR(160)  UNIQUE NULL
email_verified_at       TIMESTAMPTZ   NULL
password_hash           VARCHAR(255)  NULL              -- للإدارة فقط، العملاء بـ OTP
full_name               VARCHAR(120)  NOT NULL
avatar_url              TEXT          NULL
user_type               ENUM          NOT NULL          -- customer | technician | admin | partner
preferred_language      VARCHAR(5)    DEFAULT 'ar'      -- ar | en
is_active               BOOLEAN       DEFAULT true
is_blocked              BOOLEAN       DEFAULT false
blocked_reason          TEXT          NULL
blocked_at              TIMESTAMPTZ   NULL
last_login_at           TIMESTAMPTZ   NULL
last_login_ip           INET          NULL
referral_code           VARCHAR(12)   UNIQUE NULL
referred_by_user_id     UUID          FK → users.id NULL
metadata                JSONB         DEFAULT '{}'
created_at / updated_at / deleted_at
```
**فهارس:** `phone_number`, `user_type`, `referral_code`

---

### 2.2 `otp_codes`

```sql
id                UUID          PK
phone_number      VARCHAR(15)   NOT NULL
code_hash         VARCHAR(255)  NOT NULL      -- مُشفّر، ممنوع تخزين الكود صريح
purpose           ENUM          NOT NULL      -- login | register | reset_password | verify_phone
attempts_count    SMALLINT      DEFAULT 0
max_attempts      SMALLINT      DEFAULT 5
is_used           BOOLEAN       DEFAULT false
used_at           TIMESTAMPTZ   NULL
expires_at        TIMESTAMPTZ   NOT NULL
request_ip        INET          NULL
created_at
```

### 2.3 `refresh_tokens`

```sql
id                UUID          PK
user_id           UUID          FK → users.id NOT NULL
token_hash        VARCHAR(255)  UNIQUE NOT NULL
device_id         VARCHAR(128)  NULL
device_name       VARCHAR(120)  NULL
device_platform   ENUM          NULL          -- ios | android | web
ip_address        INET          NULL
is_revoked        BOOLEAN       DEFAULT false
revoked_at        TIMESTAMPTZ   NULL
revoked_reason    VARCHAR(80)   NULL          -- logout | rotation | security_breach
expires_at        TIMESTAMPTZ   NOT NULL
created_at
```

### 2.4 `roles` / `permissions` / `role_permissions` / `user_roles`

```sql
-- roles
id            UUID PK
name          VARCHAR(60) UNIQUE   -- super_admin | ops_manager | support_agent | finance | recruiter
display_name  VARCHAR(120)
description   TEXT
is_system     BOOLEAN DEFAULT false

-- permissions
id            UUID PK
name          VARCHAR(80) UNIQUE   -- orders.view | orders.cancel | payouts.approve | users.block
resource      VARCHAR(40)          -- orders | users | payouts
action        VARCHAR(40)          -- view | create | update | delete | approve

-- role_permissions
role_id       UUID FK
permission_id UUID FK

-- user_roles
user_id       UUID FK
role_id       UUID FK
assigned_by   UUID FK → users.id
assigned_at   TIMESTAMPTZ
```

---

## 3. جداول الجغرافيا

### 3.1 `countries` / `cities` / `areas` / `service_zones`

```sql
-- countries
id, name_ar, name_en, iso_code (VARCHAR 2), phone_prefix, currency_code, is_active

-- cities
id, country_id FK, name_ar, name_en, slug, center_location GEOGRAPHY(POINT),
timezone VARCHAR(40) DEFAULT 'Africa/Cairo', is_active, launched_at

-- areas   (الأحياء)
id, city_id FK, name_ar, name_en, slug, boundary GEOGRAPHY(POLYGON),
center_location GEOGRAPHY(POINT), is_active, is_launched

-- service_zones   (نطاق تشغيلي = مجموعة أحياء لها نفس قواعد التسعير)
id, city_id FK, name_ar, name_en, boundary GEOGRAPHY(POLYGON),
surge_multiplier NUMERIC(4,2) DEFAULT 1.00,
min_order_amount_cents INTEGER, is_active
```

### 3.2 `addresses`

```sql
id                    UUID          PK
user_id               UUID          FK → users.id NOT NULL
label                 VARCHAR(40)   NULL          -- البيت | الشغل | بيت ماما
city_id               UUID          FK → cities.id
area_id               UUID          FK → areas.id
street_name           VARCHAR(160)  NOT NULL
building_number       VARCHAR(20)   NULL
floor_number          VARCHAR(10)   NULL
apartment_number      VARCHAR(10)   NULL
landmark              VARCHAR(200)  NULL          -- علامة مميزة — مهمة جداً في مصر
location              GEOGRAPHY(POINT) NOT NULL
contact_name          VARCHAR(120)  NULL
contact_phone         VARCHAR(15)   NULL
delivery_notes        TEXT          NULL
is_default            BOOLEAN       DEFAULT false
is_verified           BOOLEAN       DEFAULT false
created_at / updated_at / deleted_at
```

---

## 4. جداول العملاء والفنيين

### 4.1 `customer_profiles`

```sql
id                        UUID    PK
user_id                   UUID    FK → users.id UNIQUE NOT NULL
default_address_id        UUID    FK → addresses.id NULL
total_orders_count        INTEGER DEFAULT 0
completed_orders_count    INTEGER DEFAULT 0
cancelled_orders_count    INTEGER DEFAULT 0
total_spent_cents         INTEGER DEFAULT 0
loyalty_points_balance    INTEGER DEFAULT 0
customer_tier             ENUM    DEFAULT 'standard'   -- standard | silver | gold | vip
average_rating_given      NUMERIC(3,2) NULL
is_high_risk              BOOLEAN DEFAULT false
first_order_at            TIMESTAMPTZ NULL
last_order_at             TIMESTAMPTZ NULL
```

### 4.2 `technician_profiles`

```sql
id                          UUID          PK
user_id                     UUID          FK → users.id UNIQUE NOT NULL
technician_code             VARCHAR(20)   UNIQUE       -- TECH-000123
national_id_encrypted       TEXT          NOT NULL     -- AES-256
date_of_birth               DATE          NULL
gender                      ENUM          NULL         -- male | female
bio                         TEXT          NULL
years_of_experience         SMALLINT      DEFAULT 0
current_level               ENUM          DEFAULT 'bronze'  -- bronze|silver|gold|platinum
quality_score               NUMERIC(5,2)  DEFAULT 0
average_rating              NUMERIC(3,2)  DEFAULT 0
total_ratings_count         INTEGER       DEFAULT 0
completed_orders_count      INTEGER       DEFAULT 0
cancelled_orders_count      INTEGER       DEFAULT 0
on_time_rate                NUMERIC(5,2)  DEFAULT 0    -- نسبة مئوية
acceptance_rate             NUMERIC(5,2)  DEFAULT 0
completion_rate             NUMERIC(5,2)  DEFAULT 0
complaint_rate              NUMERIC(5,2)  DEFAULT 0
verification_status         ENUM          DEFAULT 'pending'
                            -- pending | documents_submitted | under_review | interview_scheduled
                            -- | test_passed | approved | rejected | suspended
verification_notes          TEXT          NULL
approved_at                 TIMESTAMPTZ   NULL
approved_by_user_id         UUID          FK → users.id NULL
is_available                BOOLEAN       DEFAULT false   -- أونلاين دلوقتي
is_on_duty                  BOOLEAN       DEFAULT false   -- في ورديّة
current_location            GEOGRAPHY(POINT) NULL
current_location_updated_at TIMESTAMPTZ   NULL
home_area_id                UUID          FK → areas.id
max_daily_orders            SMALLINT      DEFAULT 8
has_own_transport           BOOLEAN       DEFAULT false
has_own_tools               BOOLEAN       DEFAULT true
emergency_available         BOOLEAN       DEFAULT false
bank_account_number_encrypted TEXT        NULL
bank_name                   VARCHAR(80)   NULL
wallet_provider             VARCHAR(40)   NULL          -- vodafone_cash | instapay | bank
wallet_number_encrypted     TEXT          NULL
contract_signed_at          TIMESTAMPTZ   NULL
suspended_until             TIMESTAMPTZ   NULL
suspension_reason           TEXT          NULL
```

### 4.3 `technician_documents`

```sql
id                  UUID          PK
technician_id       UUID          FK → technician_profiles.id
document_type       ENUM          NOT NULL
                    -- national_id_front | national_id_back | criminal_record
                    -- | professional_certificate | photo | driving_license | vehicle_license
file_url            TEXT          NOT NULL
file_size_bytes     INTEGER
mime_type           VARCHAR(60)
review_status       ENUM          DEFAULT 'pending'   -- pending | approved | rejected
rejection_reason    TEXT          NULL
reviewed_by_user_id UUID          FK → users.id NULL
reviewed_at         TIMESTAMPTZ   NULL
expires_at          DATE          NULL
```

### 4.4 `technician_services` (ربط الفني بالخدمات)

```sql
id                    UUID    PK
technician_id         UUID    FK → technician_profiles.id
service_id            UUID    FK → services.id
skill_level           ENUM    DEFAULT 'standard'   -- beginner | standard | expert
is_active             BOOLEAN DEFAULT true
completed_count       INTEGER DEFAULT 0
average_rating        NUMERIC(3,2) NULL
tested_at             TIMESTAMPTZ NULL
UNIQUE(technician_id, service_id)
```

### 4.5 `technician_zones` (مناطق العمل)

```sql
id, technician_id FK, service_zone_id FK, is_primary BOOLEAN, is_active BOOLEAN
```

### 4.6 `technician_level_history`

```sql
id, technician_id FK, previous_level ENUM, new_level ENUM,
change_type ENUM,           -- promotion | demotion | manual_override
quality_score_at_change NUMERIC(5,2),
reason TEXT, changed_by_user_id UUID NULL, effective_from TIMESTAMPTZ
```

### 4.7 `technician_availability` (جدول التوافر)

```sql
id, technician_id FK,
day_of_week SMALLINT,       -- 0=الأحد ... 6=السبت
start_time TIME, end_time TIME, is_active BOOLEAN
```

---

## 5. جداول الكتالوج والتسعير

### 5.1 `service_categories`

```sql
id, parent_category_id UUID FK NULL, name_ar, name_en, slug UNIQUE,
description_ar, description_en, icon_url, cover_image_url,
display_order SMALLINT, is_active BOOLEAN, is_featured BOOLEAN,
launch_phase SMALLINT       -- 1 = MVP، 2 = المرحلة الثانية ...
```

### 5.2 `services`

```sql
id                          UUID          PK
category_id                 UUID          FK → service_categories.id
name_ar                     VARCHAR(120)  NOT NULL
name_en                     VARCHAR(120)
slug                        VARCHAR(120)  UNIQUE
short_description_ar        VARCHAR(255)
full_description_ar         TEXT
icon_url                    TEXT
pricing_model               ENUM          NOT NULL
                            -- fixed | hourly | per_unit | inspection_then_quote
base_price_cents            INTEGER       NOT NULL
inspection_fee_cents        INTEGER       DEFAULT 0
min_price_cents             INTEGER
max_price_cents             INTEGER
unit_name_ar                VARCHAR(40)   NULL      -- ساعة | متر | قطعة | جهاز
estimated_duration_minutes  SMALLINT
warranty_days               SMALLINT      DEFAULT 0
requires_photos             BOOLEAN       DEFAULT false
allows_scheduling           BOOLEAN       DEFAULT true
allows_emergency            BOOLEAN       DEFAULT false
min_technician_level        ENUM          DEFAULT 'bronze'
commission_percentage       NUMERIC(5,2)  DEFAULT 15.00
display_order               SMALLINT
is_active                   BOOLEAN       DEFAULT true
launch_phase                SMALLINT
```

### 5.3 `service_zone_pricing` (سعر مختلف حسب المنطقة)

```sql
id, service_id FK, service_zone_id FK,
price_cents INTEGER, inspection_fee_cents INTEGER,
surge_multiplier NUMERIC(4,2) DEFAULT 1.00,
valid_from TIMESTAMPTZ, valid_until TIMESTAMPTZ NULL, is_active BOOLEAN
```

### 5.4 `service_level_pricing` (سعر مختلف حسب مستوى الفني)

```sql
id, service_id FK, technician_level ENUM,
price_multiplier NUMERIC(4,2),      -- bronze 1.00 | silver 1.10 | gold 1.25 | platinum 1.45
is_active BOOLEAN
```

### 5.5 `service_addons` (إضافات اختيارية)

```sql
id, service_id FK, name_ar, name_en, price_cents INTEGER,
duration_minutes SMALLINT, is_active BOOLEAN, display_order SMALLINT
```

---

## 6. جداول الطلبات — القلب

### 6.1 `orders`

```sql
id                          UUID          PK
order_number                VARCHAR(24)   UNIQUE NOT NULL   -- ORD-2026-000123
customer_id                 UUID          FK → customer_profiles.id NOT NULL
technician_id               UUID          FK → technician_profiles.id NULL
service_id                  UUID          FK → services.id NOT NULL
address_id                  UUID          FK → addresses.id NOT NULL
service_zone_id             UUID          FK → service_zones.id
order_type                  ENUM          DEFAULT 'standard'  -- standard | emergency | scheduled | recurring | b2b
order_status                ENUM          NOT NULL DEFAULT 'draft'
requested_level             ENUM          NULL                -- مستوى الفني المطلوب
problem_description         TEXT          NULL
customer_notes              TEXT          NULL
scheduled_at                TIMESTAMPTZ   NULL
scheduled_slot_start        TIMESTAMPTZ   NULL
scheduled_slot_end          TIMESTAMPTZ   NULL

-- التسعير (كله بالقرش)
estimated_price_cents       INTEGER       NULL
inspection_fee_cents        INTEGER       DEFAULT 0
labor_amount_cents          INTEGER       DEFAULT 0
parts_amount_cents          INTEGER       DEFAULT 0
addons_amount_cents         INTEGER       DEFAULT 0
surge_amount_cents          INTEGER       DEFAULT 0
discount_amount_cents       INTEGER       DEFAULT 0
tax_amount_cents            INTEGER       DEFAULT 0
subtotal_cents              INTEGER       DEFAULT 0
total_amount_cents          INTEGER       DEFAULT 0
platform_commission_cents   INTEGER       DEFAULT 0
technician_earning_cents    INTEGER       DEFAULT 0
commission_rate_applied     NUMERIC(5,2)

payment_method              ENUM          -- cash | card | wallet | bank_transfer | corporate_credit
payment_status              ENUM          DEFAULT 'unpaid'  -- unpaid | pending | paid | partially_refunded | refunded | failed
promo_code_id               UUID          FK NULL

-- الأوقات (تسلسل دورة الحياة)
placed_at                   TIMESTAMPTZ   NULL
assigned_at                 TIMESTAMPTZ   NULL
accepted_at                 TIMESTAMPTZ   NULL
technician_departed_at      TIMESTAMPTZ   NULL
technician_arrived_at       TIMESTAMPTZ   NULL
work_started_at             TIMESTAMPTZ   NULL
work_completed_at           TIMESTAMPTZ   NULL
paid_at                     TIMESTAMPTZ   NULL
closed_at                   TIMESTAMPTZ   NULL
cancelled_at                TIMESTAMPTZ   NULL

cancelled_by_user_id        UUID          FK → users.id NULL
cancellation_reason_id      UUID          FK NULL
cancellation_fee_cents      INTEGER       DEFAULT 0

-- القياس
eta_minutes                 SMALLINT      NULL
actual_arrival_delay_minutes SMALLINT     NULL
actual_duration_minutes     SMALLINT      NULL
distance_km                 NUMERIC(6,2)  NULL
was_on_time                 BOOLEAN       NULL
warranty_expires_at         TIMESTAMPTZ   NULL
has_complaint               BOOLEAN       DEFAULT false
is_reopened                 BOOLEAN       DEFAULT false
parent_order_id             UUID          FK → orders.id NULL   -- لو إعادة زيارة تحت الضمان
source_channel              ENUM          -- customer_app | web | call_center | b2b_portal | whatsapp
metadata                    JSONB
created_at / updated_at / deleted_at
```

**فهارس مهمة:** `order_number`, `customer_id`, `technician_id`, `order_status`, `(service_zone_id, order_status)`, `created_at`

### 6.2 `order_status` — قائمة الحالات الكاملة

```
draft                  → العميل بيجهّز الطلب
pending_payment        → في انتظار دفع مقدم (لو مطلوب)
searching_technician   → بندوّر على فني
technician_assigned    → اتعيّن فني ومستني قبوله
accepted               → الفني قبل
technician_on_way      → الفني في الطريق
technician_arrived     → الفني وصل
in_progress            → الشغل شغال
awaiting_quote_approval→ الفني قدّم عرض سعر ومستني موافقة العميل
work_completed         → الشغل خلص
awaiting_payment       → مستني الدفع
completed              → مكتمل ومدفوع
cancelled_by_customer  → ألغاه العميل
cancelled_by_technician→ ألغاه الفني
cancelled_by_system    → إلغاء تلقائي (مفيش فني / انتهت المهلة)
expired                → انتهت صلاحيته
disputed               → فيه نزاع مفتوح
refunded               → تم الاسترجاع
```

### 6.3 `order_status_history` (سجل كل تغيير — إلزامي)

```sql
id, order_id FK, previous_status ENUM, new_status ENUM,
changed_by_user_id UUID NULL, changed_by_role VARCHAR(40),
change_source ENUM,          -- customer | technician | admin | system | webhook
reason TEXT NULL,
location GEOGRAPHY(POINT) NULL,
metadata JSONB, created_at
```

### 6.4 `order_items` (قطع الغيار والإضافات)

```sql
id, order_id FK,
item_type ENUM,              -- service | addon | spare_part | extra_labor
reference_id UUID NULL,
name_ar VARCHAR(160), description TEXT,
quantity NUMERIC(8,2) DEFAULT 1, unit_name VARCHAR(40),
unit_price_cents INTEGER, total_price_cents INTEGER,
is_customer_approved BOOLEAN DEFAULT false, approved_at TIMESTAMPTZ NULL,
added_by_user_id UUID, receipt_photo_url TEXT NULL
```

### 6.5 `order_media` (صور قبل/بعد)

```sql
id, order_id FK, uploaded_by_user_id FK,
media_type ENUM,             -- before_photo | after_photo | problem_photo | receipt | signature | video
file_url TEXT, thumbnail_url TEXT, file_size_bytes INTEGER,
caption VARCHAR(255) NULL, taken_at TIMESTAMPTZ, location GEOGRAPHY(POINT) NULL
```

### 6.6 `order_assignments` (محاولات التوزيع — مهم للتحليل)

```sql
id, order_id FK, technician_id FK,
assignment_round SMALLINT,   -- الدفعة رقم كام
distance_km NUMERIC(6,2), estimated_eta_minutes SMALLINT,
assignment_status ENUM,      -- sent | viewed | accepted | rejected | timeout | cancelled
rejection_reason_code VARCHAR(40) NULL,
sent_at, responded_at, expires_at TIMESTAMPTZ
```

### 6.7 `cancellation_reasons`

```sql
id, reason_ar, reason_en, applies_to ENUM,   -- customer | technician | admin
charges_fee BOOLEAN, fee_percentage NUMERIC(5,2), affects_technician_score BOOLEAN,
display_order SMALLINT, is_active BOOLEAN
```

---

## 7. جداول المال

### 7.1 `wallets`

```sql
id, owner_user_id UUID FK UNIQUE,
owner_type ENUM,             -- customer | technician | partner | platform
balance_cents INTEGER DEFAULT 0,
pending_balance_cents INTEGER DEFAULT 0,     -- أرباح لسه تحت التسوية
reserved_balance_cents INTEGER DEFAULT 0,    -- محجوز لطلب صرف
total_earned_cents INTEGER DEFAULT 0,
total_withdrawn_cents INTEGER DEFAULT 0,
currency_code VARCHAR(3) DEFAULT 'EGP',
is_frozen BOOLEAN DEFAULT false, frozen_reason TEXT NULL
```

### 7.2 `wallet_transactions` (قيد مزدوج — لا يُحذف ولا يُعدّل أبداً)

```sql
id                    UUID    PK
wallet_id             UUID    FK → wallets.id
transaction_number    VARCHAR(24) UNIQUE       -- TXN-2026-000123
direction             ENUM    NOT NULL         -- credit | debit
transaction_type      ENUM    NOT NULL
                      -- order_earning | commission_deduction | topup | withdrawal
                      -- | refund | penalty | bonus | referral_reward | adjustment
amount_cents          INTEGER NOT NULL         -- دايماً موجب، الاتجاه في direction
balance_before_cents  INTEGER NOT NULL
balance_after_cents   INTEGER NOT NULL
reference_type        VARCHAR(40)              -- order | payout | complaint
reference_id          UUID
description_ar        VARCHAR(255)
performed_by_user_id  UUID NULL
is_reversed           BOOLEAN DEFAULT false
reversal_transaction_id UUID FK NULL
created_at
```

### 7.3 `payments`

```sql
id                      UUID          PK
payment_number          VARCHAR(24)   UNIQUE          -- PAY-2026-000123
order_id                UUID          FK → orders.id
customer_id             UUID          FK
amount_cents            INTEGER       NOT NULL
currency_code           VARCHAR(3)    DEFAULT 'EGP'
payment_method          ENUM          NOT NULL
payment_gateway         VARCHAR(40)   NULL            -- paymob | fawry | manual
gateway_transaction_id  VARCHAR(120)  NULL
gateway_reference       VARCHAR(120)  NULL
gateway_response        JSONB         NULL            -- بدون أي بيانات كارت
card_last_four          VARCHAR(4)    NULL
card_brand              VARCHAR(20)   NULL
payment_status          ENUM          DEFAULT 'pending'
                        -- pending | processing | succeeded | failed | cancelled | expired | refunded
failure_code            VARCHAR(60)   NULL
failure_message         TEXT          NULL
idempotency_key         VARCHAR(80)   UNIQUE NOT NULL
initiated_at, completed_at, failed_at TIMESTAMPTZ
collected_by_user_id    UUID NULL                     -- لو كاش: الفني
```

### 7.4 `refunds`

```sql
id, refund_number VARCHAR(24) UNIQUE, payment_id FK, order_id FK,
amount_cents INTEGER, refund_type ENUM,        -- full | partial
refund_reason_code VARCHAR(60), reason_notes TEXT,
refund_method ENUM,                            -- original_method | wallet_credit | cash
refund_status ENUM,                            -- pending | approved | processing | completed | rejected
gateway_refund_id VARCHAR(120) NULL,
requested_by_user_id UUID, approved_by_user_id UUID NULL,
requested_at, approved_at, completed_at TIMESTAMPTZ
```

### 7.5 `payouts` (صرف أرباح الفنيين)

```sql
id, payout_number VARCHAR(24) UNIQUE, technician_id FK, wallet_id FK,
amount_cents INTEGER, fee_cents INTEGER DEFAULT 0, net_amount_cents INTEGER,
payout_method ENUM,                -- bank_transfer | vodafone_cash | instapay | cash
destination_masked VARCHAR(40),    -- ****1234
payout_status ENUM,                -- requested | under_review | approved | processing | completed | rejected | failed
period_start_date DATE, period_end_date DATE,
orders_count INTEGER,
requested_at, reviewed_at, completed_at TIMESTAMPTZ,
reviewed_by_user_id UUID NULL, rejection_reason TEXT NULL,
external_reference VARCHAR(120) NULL
```

### 7.6 `payout_order_items` (تفصيل الطلبات في كل صرف)

```sql
id, payout_id FK, order_id FK, earning_cents INTEGER, commission_cents INTEGER
```

---

## 8. التقييم والشكاوى والدعم

### 8.1 `ratings`

```sql
id, order_id FK UNIQUE, rated_by_user_id FK, rated_user_id FK,
rating_type ENUM,                  -- customer_to_technician | technician_to_customer
overall_rating SMALLINT,           -- 1..5
punctuality_rating SMALLINT NULL,
quality_rating SMALLINT NULL,
professionalism_rating SMALLINT NULL,
price_fairness_rating SMALLINT NULL,
comment TEXT NULL,
tags TEXT[] NULL,                  -- ['ملتزم','نضيف','شرح كويس']
is_published BOOLEAN DEFAULT true,
is_flagged BOOLEAN DEFAULT false, flagged_reason TEXT NULL,
moderated_by_user_id UUID NULL, created_at
```

### 8.2 `complaints`

```sql
id                    UUID    PK
complaint_number      VARCHAR(24) UNIQUE       -- CMP-2026-000123
order_id              UUID    FK NULL
filed_by_user_id      UUID    FK
against_user_id       UUID    FK NULL
category              ENUM
                      -- poor_quality | late_arrival | no_show | overcharging | rude_behavior
                      -- | damage_to_property | incomplete_work | safety_concern | fraud | other
severity              ENUM DEFAULT 'medium'    -- low | medium | high | critical
title                 VARCHAR(200)
description           TEXT
complaint_status      ENUM DEFAULT 'open'
                      -- open | under_investigation | awaiting_customer | awaiting_technician
                      -- | resolved | rejected | escalated | closed
resolution_type       ENUM NULL                -- refund | redo_service | partial_refund
                                               -- | warning_issued | technician_suspended | no_action
resolution_notes      TEXT NULL
compensation_cents    INTEGER DEFAULT 0
assigned_to_user_id   UUID NULL
sla_due_at            TIMESTAMPTZ
first_response_at     TIMESTAMPTZ NULL
resolved_at           TIMESTAMPTZ NULL
resolved_by_user_id   UUID NULL
customer_satisfied    BOOLEAN NULL
```

### 8.3 `complaint_messages` / `complaint_attachments`

```sql
-- complaint_messages
id, complaint_id FK, sender_user_id FK, sender_role VARCHAR(40),
message TEXT, is_internal_note BOOLEAN DEFAULT false, created_at

-- complaint_attachments
id, complaint_id FK, file_url TEXT, file_type VARCHAR(40), uploaded_by_user_id FK
```

### 8.4 `support_tickets`

```sql
id, ticket_number VARCHAR(24) UNIQUE, user_id FK,
subject VARCHAR(200), category ENUM, priority ENUM,
ticket_status ENUM, channel ENUM,         -- app | phone | whatsapp | email
assigned_to_user_id UUID NULL,
first_response_at, resolved_at TIMESTAMPTZ, satisfaction_rating SMALLINT NULL
```

---

## 9. الشات والإشعارات

### 9.1 `chat_threads`

```sql
id, order_id FK UNIQUE NULL, thread_type ENUM,   -- order_chat | support_chat
customer_id FK, technician_id FK NULL,
is_active BOOLEAN, last_message_at TIMESTAMPTZ, closes_at TIMESTAMPTZ
```

### 9.2 `chat_messages`

```sql
id, thread_id FK, sender_user_id FK,
message_type ENUM,          -- text | image | location | system | quick_reply
content TEXT NULL, file_url TEXT NULL, location GEOGRAPHY(POINT) NULL,
is_read BOOLEAN DEFAULT false, read_at TIMESTAMPTZ NULL,
is_flagged BOOLEAN DEFAULT false,     -- كشف محاولة تبادل أرقام للتحايل
created_at
```

### 9.3 `notifications`

```sql
id, user_id FK,
notification_type VARCHAR(60),        -- order_accepted | technician_arrived | payment_received ...
channel ENUM,                         -- push | sms | email | in_app | whatsapp
title_ar VARCHAR(160), body_ar TEXT,
deep_link VARCHAR(255) NULL,
reference_type VARCHAR(40), reference_id UUID NULL,
delivery_status ENUM,                 -- queued | sent | delivered | failed | read
sent_at, delivered_at, read_at TIMESTAMPTZ, failure_reason TEXT NULL
```

### 9.4 `user_devices`

```sql
id, user_id FK, device_id VARCHAR(128) UNIQUE, fcm_token TEXT,
platform ENUM, os_version VARCHAR(40), app_version VARCHAR(20),
device_model VARCHAR(80), is_active BOOLEAN, last_active_at TIMESTAMPTZ
```

---

## 10. العروض والولاء

### 10.1 `promo_codes`

```sql
id, code VARCHAR(24) UNIQUE, name_ar VARCHAR(120),
discount_type ENUM,                    -- percentage | fixed_amount | free_inspection
discount_value NUMERIC(10,2),
max_discount_cents INTEGER NULL, min_order_amount_cents INTEGER DEFAULT 0,
usage_limit_total INTEGER NULL, usage_limit_per_user SMALLINT DEFAULT 1,
used_count INTEGER DEFAULT 0,
applies_to_service_ids UUID[] NULL, applies_to_zone_ids UUID[] NULL,
new_customers_only BOOLEAN DEFAULT false,
valid_from, valid_until TIMESTAMPTZ, is_active BOOLEAN,
created_by_user_id UUID, budget_cents INTEGER NULL, spent_cents INTEGER DEFAULT 0
```

### 10.2 `promo_code_usages`

```sql
id, promo_code_id FK, user_id FK, order_id FK, discount_applied_cents INTEGER, used_at
```

### 10.3 `loyalty_transactions`

```sql
id, user_id FK, points_amount INTEGER, direction ENUM,   -- earn | redeem | expire
source ENUM,                            -- order | referral | review | promotion | manual
reference_id UUID NULL, balance_after INTEGER, expires_at TIMESTAMPTZ NULL, created_at
```

---

## 11. النظام والحوكمة

### 11.1 `audit_logs`

```sql
id, actor_user_id UUID NULL, actor_role VARCHAR(40), actor_ip INET,
action VARCHAR(80),                    -- order.cancelled | payout.approved | user.blocked
entity_type VARCHAR(60), entity_id UUID,
old_values JSONB NULL, new_values JSONB NULL,
user_agent TEXT, request_id VARCHAR(60), created_at
```

### 11.2 `settings`

```sql
id, key VARCHAR(80) UNIQUE, value JSONB, value_type VARCHAR(20),
group_name VARCHAR(40),                -- pricing | matching | notifications | limits
description TEXT, is_public BOOLEAN, updated_by_user_id UUID
```

**إعدادات أساسية:**
```
matching.radius_km_initial          = 5
matching.radius_km_max              = 15
matching.batch_size                 = 5
matching.response_timeout_seconds   = 30
matching.max_rounds                 = 4
orders.auto_cancel_after_minutes    = 20
orders.cancellation_free_window_min = 5
pricing.default_commission_percent  = 15
payouts.min_amount_cents            = 20000
payouts.auto_approve_limit_cents    = 100000
otp.expiry_minutes                  = 5
warranty.default_days               = 14
```

### 11.3 `webhook_events` (كل رد من بوابة الدفع يتسجل)

```sql
id, provider VARCHAR(40), event_type VARCHAR(80), external_event_id VARCHAR(120) UNIQUE,
payload JSONB, signature_valid BOOLEAN,
processing_status ENUM,               -- received | processing | processed | failed | ignored
processed_at TIMESTAMPTZ, error_message TEXT, retry_count SMALLINT
```

### 11.4 `feature_flags`

```sql
id, key VARCHAR(60) UNIQUE, is_enabled BOOLEAN,
rollout_percentage SMALLINT DEFAULT 0,
enabled_for_user_ids UUID[] NULL, enabled_for_zone_ids UUID[] NULL, description TEXT
```

---

## 12. جداول المراحل المتقدمة (تصميم مبدئي)

### المرحلة 3 — المغاسل

```sql
-- laundry_partners
id, business_name, owner_user_id FK, commercial_register_number,
address_id FK, service_zone_ids UUID[], capacity_per_day INTEGER,
turnaround_hours SMALLINT, partner_status ENUM, commission_rate NUMERIC(5,2),
dashboard_plan ENUM,                 -- free | basic | pro
rating NUMERIC(3,2)

-- laundry_orders
id, order_number, customer_id FK, laundry_partner_id FK,
pickup_courier_id FK NULL, delivery_courier_id FK NULL,
pickup_address_id FK, pickup_scheduled_at, delivery_scheduled_at,
items_count SMALLINT, total_weight_kg NUMERIC(6,2),
laundry_status ENUM,   -- requested|picked_up|received_at_laundry|washing|drying|ironing|ready|out_for_delivery|delivered
qr_batch_code VARCHAR(40)

-- laundry_items
id, laundry_order_id FK, qr_code VARCHAR(60) UNIQUE,
item_type VARCHAR(60), color VARCHAR(40), fabric VARCHAR(60),
service_type ENUM,                   -- wash | dry_clean | iron_only | wash_and_iron
price_cents INTEGER, item_status ENUM,
condition_notes TEXT, before_photo_url, after_photo_url,
is_damaged BOOLEAN, damage_report TEXT
```

### المرحلة 4 — الشركات B2B

```sql
-- corporate_accounts
id, company_name, commercial_register, tax_id, account_type ENUM,  -- company | compound | property_manager
primary_contact_user_id FK, billing_address_id FK,
contract_start_date, contract_end_date, credit_limit_cents INTEGER,
current_balance_cents INTEGER, payment_terms_days SMALLINT,
discount_percentage NUMERIC(5,2), sla_response_minutes SMALLINT, account_status ENUM

-- corporate_users
id, corporate_account_id FK, user_id FK, corporate_role ENUM,  -- admin | requester | approver | viewer
department VARCHAR(80), monthly_budget_cents INTEGER NULL, requires_approval BOOLEAN

-- corporate_properties
id, corporate_account_id FK, property_name, address_id FK,
units_count INTEGER, property_type ENUM

-- corporate_invoices
id, invoice_number, corporate_account_id FK, period_start, period_end,
orders_count, subtotal_cents, tax_cents, total_cents,
invoice_status ENUM, due_date, paid_at
```

### المرحلة 5 — الذكاء الاصطناعي

```sql
-- ai_diagnoses
id, order_id FK NULL, customer_id FK, input_image_urls TEXT[],
input_description TEXT,
predicted_category_id UUID, predicted_service_id UUID,
confidence_score NUMERIC(5,4),
estimated_min_price_cents INTEGER, estimated_max_price_cents INTEGER,
diagnosis_text_ar TEXT, urgency_level ENUM,
model_version VARCHAR(40),
was_accepted_by_customer BOOLEAN NULL,
actual_service_id UUID NULL,          -- للمقارنة وقياس الدقة
actual_price_cents INTEGER NULL,
was_prediction_correct BOOLEAN NULL
```

### المرحلة 7 — الاشتراكات

```sql
-- subscription_plans
id, name_ar, plan_type ENUM,          -- customer | technician
billing_cycle ENUM,                   -- monthly | quarterly | annual
price_cents INTEGER,
free_inspections_count SMALLINT, discount_percentage NUMERIC(5,2),
priority_matching BOOLEAN, extended_warranty_days SMALLINT,
included_services JSONB, is_active BOOLEAN

-- subscriptions
id, user_id FK, plan_id FK, subscription_status ENUM,
started_at, current_period_start, current_period_end,
auto_renew BOOLEAN, cancelled_at, cancellation_reason TEXT,
remaining_free_inspections SMALLINT, total_saved_cents INTEGER
```

### المرحلة 8 — Home Management

```sql
-- home_profiles
id, customer_id FK, address_id FK, property_type ENUM,
area_sqm NUMERIC(8,2), rooms_count SMALLINT, bathrooms_count SMALLINT,
build_year SMALLINT, is_primary BOOLEAN

-- home_appliances
id, home_profile_id FK, appliance_type VARCHAR(60), brand VARCHAR(60),
model VARCHAR(80), serial_number VARCHAR(80),
purchase_date DATE, purchase_price_cents INTEGER,
warranty_expires_at DATE, warranty_document_url TEXT,
installation_date DATE, last_maintenance_at DATE, next_maintenance_due_at DATE,
maintenance_interval_days SMALLINT, room_location VARCHAR(60), condition_status ENUM

-- maintenance_schedules
id, home_profile_id FK, appliance_id FK NULL, service_id FK,
title_ar VARCHAR(120), recurrence_type ENUM, interval_days SMALLINT,
next_due_at TIMESTAMPTZ, last_completed_at TIMESTAMPTZ,
reminder_days_before SMALLINT, is_active BOOLEAN, auto_book BOOLEAN

-- home_documents
id, home_profile_id FK, document_type ENUM,   -- invoice | warranty | contract | manual | photo
title VARCHAR(160), file_url TEXT, related_order_id UUID NULL, expires_at DATE NULL
```

---

## 13. عقد الـ API (REST)

**القاعدة العامة:** `https://api.baytak.app/api/v1/...`
كل استجابة بالشكل ده:

```json
{
  "success": true,
  "data": { },
  "meta": { "page": 1, "per_page": 20, "total": 145 },
  "error": null,
  "request_id": "req_01H..."
}
```

### 13.1 المصادقة
```
POST   /auth/register
POST   /auth/otp/request
POST   /auth/otp/verify
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
PATCH  /auth/me
DELETE /auth/me                 (طلب حذف الحساب)
```

### 13.2 العميل
```
GET    /addresses
POST   /addresses
PATCH  /addresses/:id
DELETE /addresses/:id
GET    /service-categories
GET    /services?category_id=&zone_id=
GET    /services/:id
POST   /services/:id/estimate           (حساب سعر تقديري)
```

### 13.3 الطلبات
```
POST   /orders                          (Idempotency-Key مطلوب)
GET    /orders?status=&page=
GET    /orders/:id
GET    /orders/:id/tracking
POST   /orders/:id/cancel
POST   /orders/:id/approve-quote
POST   /orders/:id/rate
GET    /orders/:id/invoice
POST   /orders/:id/reorder
```

### 13.4 الفني
```
GET    /technician/orders/available
POST   /technician/orders/:id/accept
POST   /technician/orders/:id/reject
POST   /technician/orders/:id/depart
POST   /technician/orders/:id/arrive
POST   /technician/orders/:id/start
POST   /technician/orders/:id/add-item
POST   /technician/orders/:id/complete
POST   /technician/location                (تحديث الموقع)
PATCH  /technician/availability
GET    /technician/earnings?from=&to=
GET    /technician/level
POST   /technician/payouts
GET    /technician/documents
POST   /technician/documents
```

### 13.5 الدفع
```
POST   /payments/initiate                  (Idempotency-Key مطلوب)
POST   /payments/:id/confirm
GET    /payments/:id
GET    /wallet
GET    /wallet/transactions
POST   /wallet/topup
POST   /webhooks/paymob                    (بتوقيع مُتحقَّق)
POST   /webhooks/fawry
```

### 13.6 الدعم
```
POST   /complaints
GET    /complaints
GET    /complaints/:id
POST   /complaints/:id/messages
GET    /chat/threads/:id/messages
POST   /chat/threads/:id/messages
```

### 13.7 الإدارة (مسبوقة بـ `/admin`)
```
GET    /admin/dashboard/stats
GET    /admin/orders                 + /:id/reassign  /:id/cancel  /:id/adjust-price
GET    /admin/technicians            + /:id/approve  /:id/reject  /:id/suspend  /:id/level
GET    /admin/customers              + /:id/block
GET    /admin/payouts                + /:id/approve  /:id/reject
GET    /admin/complaints             + /:id/resolve
GET    /admin/promo-codes            (CRUD)
GET    /admin/services               (CRUD)
GET    /admin/settings               PATCH /admin/settings/:key
GET    /admin/audit-logs
GET    /admin/reports/revenue        ?from=&to=&group_by=
GET    /admin/reports/technicians
GET    /admin/reports/zones
```

### 13.8 أحداث WebSocket

```
# العميل يستمع
order:status_changed        { order_id, new_status, timestamp }
order:technician_assigned   { order_id, technician: {...}, eta_minutes }
order:location_updated      { order_id, lat, lng, eta_minutes }
chat:message_received       { thread_id, message }

# الفني يستمع
order:new_request           { order_id, service, address, distance_km, expires_at }
order:cancelled             { order_id, reason }
payout:status_changed       { payout_id, status }
```

### 13.9 أكواد الأخطاء الموحّدة

```
AUTH_001  توكن غير صالح
AUTH_002  انتهت صلاحية التوكن
AUTH_003  كود التحقق غير صحيح
AUTH_004  تجاوزت عدد المحاولات
ORDR_001  الخدمة غير متاحة في منطقتك
ORDR_002  لا يوجد فنيون متاحون حالياً
ORDR_003  لا يمكن تغيير حالة الطلب من كذا إلى كذا
ORDR_004  انتهت مهلة الإلغاء المجاني
ORDR_005  لازم صورة بعد التنفيذ قبل إنهاء الشغل (docs/08 §20 بند 12)
PAY_001   فشلت عملية الدفع
PAY_002   رصيد غير كافٍ
PAY_003   عملية مكررة (idempotency)
TECH_001  حسابك غير معتمد بعد
TECH_002  وصلت للحد الأقصى للطلبات اليومية
VAL_001   بيانات غير صحيحة
RATE_001  تجاوزت عدد الطلبات المسموح
```

---

## 14. ملاحظات تنفيذية على التصميم

1. **`orders` هو الجدول الأخطر.** كل تغيير حالة يمر عبر state machine واحدة مقفولة في الكود، وأي انتقال غير مسموح يرمي خطأ — مش يعدّي بصمت.
2. **مفيش تعديل على `wallet_transactions`.** الغلط يتصحّح بقيد عكسي جديد، مش بتعديل القديم. ده اللي يخلي الحسابات قابلة للمراجعة.
3. **`order_assignments` ده منجم ذهب للتحليل** — منه هتعرف ليه الطلبات بتضيع وأي فني بيرفض كتير.
4. **الأعمدة المحسوبة** (`average_rating`, `completed_orders_count`) تتحدّث بمهمة خلفية مجدولة، مش داخل معاملة الطلب نفسها — عشان الأداء.
5. **`landmark` في العناوين مش رفاهية** — في مصر ده أهم من رقم العمارة نفسه.
6. **`is_flagged` في الشات** ضروري: أكبر تسريب للفنيين خارج المنصة بيحصل من خلال تبادل الأرقام في الشات.

---

*ارجع لـ `01-master-plan.md` لخطة التنفيذ المرحلية.*
