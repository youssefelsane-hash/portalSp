-- baytak — 0164: سياسة إيداع لكل خدمة (deposit now / remainder later) — ADR-0027، docs/08 §42
-- Phase A.3 من محرك الحجز الموحّد. نفس نمط 0163 (cash_allowed): علم مباشر على services، مش جدول
-- تهيئة منفصل. الافتراضي false/NULL عمدًا لكل خدمة موجودة (صفر تغيير سلوك)، والأدمن يفعّلها صراحة
-- لخدمة بعينها. deposit_amount_cents على orders هو snapshot وقت إنشاء الطلب (نفس فلسفة
-- assigned_company_id/standard_data_id) — مش مربوط ديناميكيًا بنسبة الخدمة بعد إنشاء الطلب.

ALTER TABLE services ADD COLUMN deposit_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN deposit_percentage NUMERIC(5, 2) NULL;
ALTER TABLE services ADD CONSTRAINT services_deposit_percentage_range
  CHECK (deposit_percentage IS NULL OR (deposit_percentage > 0 AND deposit_percentage < 100));
ALTER TABLE services ADD CONSTRAINT services_deposit_percentage_required
  CHECK (NOT deposit_required OR deposit_percentage IS NOT NULL);

ALTER TABLE orders ADD COLUMN deposit_amount_cents INTEGER NULL;
