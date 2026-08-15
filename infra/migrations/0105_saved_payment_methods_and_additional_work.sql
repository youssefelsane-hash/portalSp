-- baytak — 0105: طريقة دفع محفوظة (tokenized) + ربط دفعات الشغل الإضافي (docs/08 §21)
-- تصحيح تدفّق: موافقة العميل على زيادة سعر إلكترونية لازم تطلق محاولة تحصيل فورية بوسيلة دفع
-- محفوظة، بمعزل عن تقدّم الشغل. قاعدة أمان صريحة: الجدول ده بيخزّن الـtoken اللي بترجّعه بوابة
-- الدفع + بيانات آمنة (آخر 4 أرقام/نوع الكارت) بس — أبداً رقم كارت خام أو CVV.

CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_id UUID NOT NULL REFERENCES customer_profiles(id),
  provider VARCHAR(40) NOT NULL,
  provider_token VARCHAR(200) NOT NULL,
  card_brand VARCHAR(20),
  masked_pan VARCHAR(20),
  is_default BOOLEAN NOT NULL DEFAULT true,
  is_revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (provider, provider_token)
);

CREATE INDEX idx_payment_methods_customer_active ON payment_methods (customer_id) WHERE is_revoked = false;

-- بند إضافي واحد أو أكتر مقترحين مع بعض في نفس نداء propose() بيشاركوا batch_id — عشان موافقة
-- العميل تعامَل كـ"طلب واحد" (obligation واحد)، مش N بند منفصلين كل واحد محاولة دفع لوحده.
ALTER TABLE order_items ADD COLUMN batch_id UUID;

-- محاولة دفع الزيادة (لو الطلب مدفوع مسبقًا إلكترونيًا) مربوطة بالدفعة اللي أنتجتها — تمييزها عن
-- الدفعة الأصلية للطلب (order_item_batch_id = NULL) عشان finalizeGatewayWebhook() يعرف يوجّه صح
-- (مايستدعيش settleAndComplete — الطلب لسه شغال، مش بيقفل).
ALTER TABLE payments ADD COLUMN order_item_batch_id UUID;

CREATE INDEX idx_payments_order_item_batch ON payments (order_item_batch_id) WHERE order_item_batch_id IS NOT NULL;
