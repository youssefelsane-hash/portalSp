-- baytak — 0176: الحجز المتكرر كقدرة رسمية في محرك الحجز + تكوين القالب الكامل
--
-- جزء 1: `services.allows_recurring_booking` — نفس نمط allows_individual/cash_allowed/
-- allows_date_range_booking بالحرف (قدرة لكل خدمة يتحكم فيها الأدمن من /admin/services).
-- الافتراضي false عمدًا: مفيش أي خدمة موجودة بتتغير سلوكها بعد الـmigration — الأدمن هو اللي
-- بيفعّل التكرار للخدمة المناسبة صراحة، ولما يكون مقفول العميل مش شايف خيارات التكرار خالص.
ALTER TABLE services
  ADD COLUMN allows_recurring_booking BOOLEAN NOT NULL DEFAULT false;

-- جزء 2: تكوين "إيه بالظبط اللي بيتكرر" — القالب كان بيحفظ الخدمة/العنوان/الوضع بس، فأي طلب
-- متولّد لخدمة formula بحقول تسعير إجبارية أو خدمة بتوقيت دقيق كان يفشل عند التوليد للأبد
-- (المعادلة بترفض "الحقل مطلوب"، والطلب بيرفض "لازم تحدد المدة") — القيم دي لازم تتخزن مع
-- القالب وتتبعت مع كل طلب متولّد، عشان السعر يتحدد وقت التوليد بنفس مدخلات العميل الأصلية.
-- promo_code/building_code/addon_ids مش بتتخزنة عمدًا — خصومات/إضافات لمرة واحدة.
ALTER TABLE recurring_order_templates
  ADD COLUMN field_values JSONB NULL,
  ADD COLUMN duration_hours INTEGER NULL,
  ADD COLUMN scheduled_end_at TIMESTAMPTZ NULL,
  ADD COLUMN requested_technician_company_id UUID NULL REFERENCES technician_companies(id);

-- قيد اتساق بسيط: المدة موجبة لو موجودة.
ALTER TABLE recurring_order_templates
  ADD CONSTRAINT chk_recurring_order_templates_duration_hours
    CHECK (duration_hours IS NULL OR duration_hours > 0);
