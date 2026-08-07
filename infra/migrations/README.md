# infra/migrations

SQL migrations لقاعدة البيانات — مصدر الحقيقة الوحيد للـ schema، ومطابقة دايماً لـ `docs/02-data-dictionary.md`. ممنوع أي تعديل مباشر على schema الإنتاج بدون migration هنا.

## الحالة

الـ schema الكامل (المرحلة 1 MVP + كل جداول المراحل المتقدمة 3-8 من القاموس) مكتوب ومرتب في 16 ملف، كل ملف = مجال منفصل بيتقرا لوحده:

| الملف | المحتوى |
|---|---|
| `0001_extensions_and_functions.sql` | PostGIS، pgcrypto، `uuid_generate_v7()`، تريجر `updated_at`، مولّد الأرقام المسلسلة (ORD-2026-000123) |
| `0002_enums.sql` | كل أنواع الـ ENUM في النظام |
| `0003_auth.sql` | users, otp_codes, refresh_tokens, roles, permissions, role_permissions, user_roles |
| `0004_geo.sql` | countries, cities, areas, service_zones, addresses |
| `0005_customers_technicians.sql` | customer_profiles, technician_profiles, technician_documents, technician_zones, technician_level_history, technician_availability |
| `0006_catalog.sql` | service_categories, services, service_zone_pricing, service_level_pricing, service_addons, technician_services |
| `0007_orders.sql` | orders, order_status_history, order_items, order_media, order_assignments, cancellation_reasons |
| `0008_finance.sql` | wallets, wallet_transactions (قيد مزدوج، ممنوع تعديل/حذف)، payments, refunds, payouts, payout_order_items |
| `0009_support_chat_notifications.sql` | ratings, complaints, complaint_messages, complaint_attachments, support_tickets, chat_threads, chat_messages, notifications, user_devices |
| `0010_promotions.sql` | promo_codes, promo_code_usages, loyalty_transactions |
| `0011_system.sql` | audit_logs, settings (مع القيم الافتراضية من القاموس §11.2)، webhook_events, feature_flags |
| `0012_phase3_laundry.sql` | جداول المغاسل (مرحلة 3 — مصمم بس مش مفعّل قبل بوابة P2) |
| `0013_phase4_b2b.sql` | جداول الشركات B2B (مرحلة 4) |
| `0014_phase5_ai.sql` | ai_diagnoses (مرحلة 5) |
| `0015_phase7_subscriptions.sql` | subscription_plans, subscriptions (مرحلة 7) |
| `0016_phase8_home_management.sql` | home_profiles, home_appliances, maintenance_schedules, home_documents (مرحلة 8) |

**ملاحظة:** الجداول المتقدمة (0012-0016) موجودة كاملة في الـ schema من اليوم الأول عشان مفيش تضارب أسماء بعدين، لكن مفيش أي كود في `apps/api` بيستخدمها قبل ما نوصل فعلياً لبوابة المرحلة المعنية (راجع §4 في الماستر بلان).

## التشغيل محلياً

```bash
cd infra/docker && docker compose up -d db
cd ../migrations
npm install
DATABASE_URL=postgres://baytak:baytak@localhost:5432/baytak npm run migrate
```

الـ runner (`migrate.js`) بيسجل كل ملف اتطبق في جدول `schema_migrations`، وبيشغّل كل ملف جوّه transaction واحدة — لو فشل أي سطر، الملف كله يرجع زي ما كان.

## قاعدة إضافة migration جديدة

1. ملف جديد برقم تالي (`0017_...`), مفيش تعديل على ملف اتعمل commit له قبل كده أبداً.
2. لو التعديل على جدول موجود، استخدم `ALTER TABLE`.
3. لازم يتراجع مع `docs/02-data-dictionary.md` ويتحدث فيه نفس التعديل بنفس الـ commit.

مرجع كامل: `../../docs/01-master-plan.md`
