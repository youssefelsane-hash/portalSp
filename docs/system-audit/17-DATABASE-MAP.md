# 17 — خريطة قاعدة البيانات (Database Map)

> **مُولَّد من `baytak_main` الحيّة** — 158 جدولًا، 96 نوعًا مُعدَّدًا، 259 migration مطبَّقًا.
>
> مستندات مرتبطة: [00 — خريطة النظام](./00-SYSTEM-MAP.md) · `docs/02-data-dictionary.md`

---

## 1. الاتفاقيات الملزِمة

| البند | القاعدة |
|-------|---------|
| الأسماء | `snake_case` للجداول والأعمدة |
| الأعمدة القياسية | كل جدول فيه `id, created_at, updated_at, deleted_at` |
| الحذف | **ناعم** (`deleted_at`) — أي استعلام لازم يفلتر `deleted_at IS NULL` |
| المبالغ | `integer` بالقرش — **مفيش `float` خالص** |
| الأوقات | `timestamptz`، التخزين UTC، والمقارنة `AT TIME ZONE 'Africa/Cairo'` صراحة |
| المفاتيح | `uuid` بـ`uuid_generate_v7()` (مرتّب زمنيًا ⇒ فهارس أنظف من v4) |
| الجغرافيا | PostGIS `geography(Point,4326)` |

### Migrations

- SQL **خام** في `infra/migrations/`، مرقّم تسلسليًا.
- `synchronize: false` **دايمًا** — TypeORM مابيعدّلش المخطط أبدًا.
- **ما تعدّلش migration اتعمل commit** — دايمًا ملف جديد برقم تالي.
- الملفات المطبَّقة متسجّلة في `schema_migrations` **بـchecksum** — تعديل ملف مطبَّق بيتكشف.
- `scripts/check-migrations.js` بيرفض رقمين متكررين، وشغّال في CI. (حصلت فعلًا: سيشنان
  متوازيان خدوا `0257`، واتكشفت **بالصدفة وقت دمج** مش بفحص.)

---

## 2. الجداول حسب المجال

| المجال | عدد الجداول |
|---|---|
| الطلبات والتنفيذ | 23 |
| المطابقة والجدولة | 5 |
| الفنيون والطواقم | 23 |
| العملاء والمنازل | 15 |
| التسعير والكتالوج | 20 |
| المال | 20 |
| التواصل والدعم | 17 |
| المنصّة والأمان | 20 |
| الجغرافيا | 3 |
| المشاريع والحملات والتعلّم | 8 |
| بنية تحتية | 3 |
| غير مصنَّف | 1 |

### الطلبات والتنفيذ — 23 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `ai_diagnoses` | 18 | 5 |
| `booking_match_previews` | 17 | 6 |
| `cancellation_reasons` | 12 | 0 |
| `laundry_orders` | 16 | 5 |
| `order_assignments` | 12 | 2 |
| `order_assistant_offers` | 10 | 2 |
| `order_earning_adjustments` | 8 | 3 |
| `order_earning_shares` | 26 | 2 |
| `order_internal_notes` | 5 | 2 |
| `order_items` | 20 | 3 |
| `order_media` | 15 | 5 |
| `order_problem_image_uploads` | 11 | 3 |
| `order_quotes` | 23 | 4 |
| `order_reschedule_requests` | 10 | 4 |
| `order_status_history` | 11 | 2 |
| `order_team_members` | 9 | 4 |
| `order_work_sessions` | 8 | 2 |
| `orders` | 119 | 21 |
| `payout_order_items` | 5 | 2 |
| `project_quotes` | 21 | 3 |
| `recurring_order_occurrences` | 12 | 2 |
| `recurring_order_templates` | 25 | 7 |
| `technician_order_cancellations` | 14 | 4 |

### المطابقة والجدولة — 5 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `maintenance_schedules` | 14 | 3 |
| `service_zone_pricing` | 13 | 2 |
| `service_zones` | 11 | 1 |
| `technician_schedule_slots` | 11 | 2 |
| `technician_work_opportunities` | 12 | 2 |

### الفنيون والطواقم — 23 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `customer_favorite_technicians` | 5 | 2 |
| `technician_availability` | 8 | 1 |
| `technician_categories` | 11 | 3 |
| `technician_certificates` | 15 | 2 |
| `technician_companies` | 13 | 2 |
| `technician_company_branches` | 9 | 2 |
| `technician_debt_settlements` | 13 | 3 |
| `technician_documents` | 15 | 2 |
| `technician_earning_adjustments` | 12 | 4 |
| `technician_excluded_services` | 7 | 3 |
| `technician_internal_notes` | 5 | 2 |
| `technician_kpi_snapshots` | 39 | 2 |
| `technician_level_config` | 13 | 0 |
| `technician_level_history` | 10 | 2 |
| `technician_portfolio_links` | 10 | 1 |
| `technician_preferred_crew_members` | 9 | 2 |
| `technician_profiles` | 55 | 8 |
| `technician_progression_rules` | 19 | 0 |
| `technician_progression_status` | 17 | 2 |
| `technician_referral_attributions` | 7 | 2 |
| `technician_referral_bonuses` | 15 | 5 |
| `technician_services` | 15 | 3 |
| `technician_zones` | 8 | 2 |

### العملاء والمنازل — 15 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `addresses` | 19 | 3 |
| `buildings` | 11 | 1 |
| `corporate_accounts` | 18 | 2 |
| `corporate_invoices` | 14 | 1 |
| `corporate_properties` | 9 | 2 |
| `corporate_users` | 9 | 2 |
| `customer_profiles` | 17 | 2 |
| `customer_service_intents` | 8 | 2 |
| `customer_warranties` | 19 | 4 |
| `home_appliances` | 19 | 1 |
| `home_documents` | 8 | 2 |
| `home_profiles` | 12 | 2 |
| `loyalty_transactions` | 9 | 1 |
| `subscription_plans` | 14 | 0 |
| `subscriptions` | 14 | 2 |

### التسعير والكتالوج — 20 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `laundry_items` | 16 | 1 |
| `laundry_partners` | 15 | 2 |
| `pricing_field_uploads` | 12 | 4 |
| `service_addons` | 11 | 1 |
| `service_categories` | 16 | 1 |
| `service_earnings_level_overrides` | 7 | 2 |
| `service_earnings_skill_overrides` | 7 | 2 |
| `service_installment_plans` | 2 | 2 |
| `service_level_pricing` | 7 | 1 |
| `service_pricing_evaluations` | 9 | 2 |
| `service_pricing_fields` | 18 | 1 |
| `service_pricing_rule_tests` | 8 | 2 |
| `service_pricing_rules` | 12 | 1 |
| `service_pricing_tier_pricing` | 7 | 1 |
| `service_productivity_actuals` | 11 | 3 |
| `service_productivity_suggestions` | 10 | 2 |
| `service_standard_data` | 14 | 1 |
| `services` | 64 | 1 |
| `warranty_claims` | 18 | 6 |
| `warranty_plans` | 23 | 2 |

### المال — 20 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `earnings_shadow_comparisons` | 9 | 1 |
| `earnings_skill_policy` | 4 | 1 |
| `installment_application_documents` | 9 | 2 |
| `installment_applications` | 30 | 5 |
| `installment_plan_document_requirements` | 7 | 1 |
| `installment_plans` | 16 | 0 |
| `installments` | 13 | 2 |
| `payment_methods` | 11 | 1 |
| `payment_policies` | 11 | 2 |
| `payment_policy_acceptances` | 6 | 2 |
| `payment_policy_versions` | 5 | 1 |
| `payments` | 24 | 4 |
| `payouts` | 19 | 3 |
| `promo_code_usages` | 7 | 3 |
| `promo_codes` | 23 | 2 |
| `refund_settlement_reversals` | 8 | 3 |
| `refunds` | 17 | 4 |
| `wallet_adjustments` | 11 | 5 |
| `wallet_transactions` | 15 | 3 |
| `wallets` | 14 | 1 |

### التواصل والدعم — 17 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `chat_messages` | 11 | 2 |
| `chat_threads` | 10 | 3 |
| `complaint_attachments` | 7 | 2 |
| `complaint_messages` | 7 | 2 |
| `complaints` | 21 | 5 |
| `internal_chat_threads` | 6 | 2 |
| `internal_messages` | 7 | 2 |
| `notification_campaign_sends` | 7 | 3 |
| `notification_campaigns` | 13 | 1 |
| `notification_routing_rules` | 7 | 1 |
| `notification_type_configs` | 10 | 0 |
| `notification_workflows` | 19 | 1 |
| `notifications` | 17 | 3 |
| `project_notification_outbox` | 13 | 2 |
| `ratings` | 18 | 4 |
| `support_tickets` | 14 | 2 |
| `user_notification_preferences` | 6 | 1 |

### المنصّة والأمان — 20 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `admin_mfa_recovery_codes` | 5 | 1 |
| `audit_logs` | 12 | 1 |
| `branding_assets` | 11 | 1 |
| `employee_daily_activity` | 13 | 1 |
| `employee_profiles` | 13 | 3 |
| `feature_flags` | 9 | 0 |
| `otp_codes` | 11 | 0 |
| `permissions` | 7 | 0 |
| `refresh_tokens` | 16 | 1 |
| `role_permissions` | 2 | 2 |
| `roles` | 10 | 0 |
| `security_event_notes` | 5 | 2 |
| `security_events` | 23 | 5 |
| `settings` | 10 | 1 |
| `step_up_tokens` | 5 | 1 |
| `user_devices` | 12 | 1 |
| `user_roles` | 4 | 3 |
| `users` | 23 | 1 |
| `webauthn_challenges` | 7 | 1 |
| `webauthn_credentials` | 11 | 1 |

### الجغرافيا — 3 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `areas` | 12 | 1 |
| `cities` | 12 | 1 |
| `spatial_ref_sys` | 5 | 0 |

### المشاريع والحملات والتعلّم — 8 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `academy_courses` | 10 | 0 |
| `academy_exam_attempts` | 8 | 3 |
| `project_attachments` | 6 | 2 |
| `project_comments` | 10 | 3 |
| `project_milestones` | 21 | 1 |
| `projects` | 32 | 4 |
| `referral_rewards` | 5 | 2 |
| `referrals` | 9 | 3 |

### بنية تحتية — 3 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `human_readable_sequences` | 2 | 0 |
| `schema_migrations` | 3 | 0 |
| `webhook_events` | 16 | 0 |

### غير مصنَّف — 1 جدول

| الجدول | أعمدة | مفاتيح أجنبية |
|---|---|---|
| `countries` | 10 | 0 |

---

## 3. الجداول المحورية

### `orders` — قلب النظام

المحوران المستقلان: `order_status` (21 قيمة) و`price_status` (6 قيم).
راجع [02](./02-ORDER-LIFECYCLE.md).

أعمدة تشغيلية تستحق الانتباه:

| العمود | المعنى |
|--------|--------|
| `scheduled_at` | موعد الزيارة (`NULL` = ASAP) |
| `duration_minutes` / `estimated_duration_days` | الحمل التشغيلي — بيدخل في فحص التعارض والسقف اليومي |
| `technician_id` | **قائد** الطلب فقط — أعضاء الطاقم في `order_team_members` |
| `requested_technician_id` | العميل اختار فنيًا بعينه ⇒ مفيش fallback تلقائي |
| `service_zone_id` | فلتر أهلية أساسي — `NULL` بيخلّي الطلب غير قابل للتوزيع |
| `source_channel` | قناة الحجز — كان **بيكدب** قبل الإصلاح (راجع `BROKEN_FLOWS_FIXED.md` §5) |

> ⚠️ **الفخّ الأخطر**: `orders.technician_id` **مش** مصدر الحقيقة الكامل لالتزام الشخص.
> المساعد بطبيعته **دايمًا** عضو طاقم مش قائد، فأي استعلام حمل/تعارض بيبص على العمود ده
> وحده **بيعتبر المساعد فاضي دايمًا** — بلاغ مالك حقيقي. الصحيح هو
> `technicianCommittedOrdersSource()` (UNION مع `order_team_members`، ADR-0057).

### `wallet_transactions` — الدفتر

كل صف بـ`balance_before_cents` و`balance_after_cents` ⇒ **الدفتر نفسه بيحمل دليل صحّته**.
راجع [10](./10-FINANCE-MONEY-FLOW.md).

### `technician_schedule_slots` — جدول استثناءات، مش جدول دوام

غياب الصف معناه **متاح**. راجع [05 §2](./05-SCHEDULING-AVAILABILITY.md).

### `service_pricing_evaluations` — لقطة السعر التاريخية

بتضمن إن السعر المتفق عليه **مايتغيّرش** لو الأدمن عدّل قواعد التسعير بعدين.
راجع [03 §7](./03-PRICING-ENGINE.md).

---

## 4. قيود `CHECK` كطبقة أمان أخيرة

قاعدة البيانات مش مجرد تخزين — فيها قيود بتمنع حالات **مستحيلة منطقيًا** حتى لو الكود غلط:

| القيد | بيمنع |
|-------|-------|
| `services_assessment_required_needs_a_route_check` (+2) | خدمة `assessment_required` بلا أي مسار تقييم مفعّل ⇒ **مستحيلة الحجز بأي طريق** |
| `chk_orders_price_status` | قيمة `price_status` خارج المجموعة المعرَّفة |
| `chk_orders_revisit_release_reason` | سبب تحرير إعادة زيارة غير مثبَّت (ADR-0051) |
| `chk_orders_assessment_type` · `chk_orders_assessment_financials` | حالات تقييم غير متسقة على الطلب |
| `chk_services_assessment_route_policy` · `_credit_mode` · `_policy_values` | قيم سياسة تقييم خارج المجموعة المعرَّفة |
| `services_remote_assessment_requires_inspection_model_check` | تقييم عن بُعد لخدمة طريقة تسعيرها مش «كشف ثم عرض سعر» |

وتلات قيود `EXCLUDE` بتمنع التداخل **تحت السباق**، مش بفحص مسبق قابل للسبق:

| القيد | بيمنع |
|-------|-------|
| `ex_technician_schedule_slots_no_overlap` | سلوتان متداخلان لنفس اليوم |
| `service_zone_pricing_no_overlap` | فترتا تسعير منطقة متداخلتان |
| `service_pricing_rules_no_overlap` | فترتا سريان قاعدة تسعير متداخلتان |

**الفلسفة**: التحقق في طبقة الخدمة بيدّي رسالة واضحة للمستخدم، والقيد في القاعدة بيضمن إن
البيانات **مستحيل** تفسد حتى لو مسار جديد نسي التحقق.

---

## 5. تجديد هذا المستند

```bash
export PGPASSWORD=baytak
psql -U baytak -h localhost -d baytak_main -At -F$'\t' -c "
  select c.relname,
         (select count(*) from information_schema.columns col
           where col.table_name=c.relname and col.table_schema='public'),
         pg_size_pretty(pg_total_relation_size(c.oid)),
         (select count(*) from pg_constraint fk where fk.conrelid=c.oid and fk.contype='f')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' order by c.relname"
```

> ملاحظة نظافة: قاعدة التطوير فيها مخلّفات اختبارات (فئات خدمة، صفوف `test.*` في
> `permissions`) بتشوّه أي **عدّ صفوف**. عدد الجداول والأعمدة غير متأثر.
> الحل الصحيح: كل spec ينضّف وراه.
