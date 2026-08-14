-- baytak — 0091: إضافة instapay لـ payment_method enum (ADR-0013، توجيه المالك 2026-08-14)
-- InstaPay — مسبق الدفع بتأكيد يدوي بس (مفيش بوابة API حقيقية موثوقة متاحة). ADD VALUE هنا آمن
-- جوّه transaction (PostgreSQL 12+) طالما مش بنستخدم القيمة الجديدة في نفس الـmigration — نفس
-- نمط 0042_fawry_payment_method.sql بالحرف.
ALTER TYPE payment_method ADD VALUE 'instapay';
