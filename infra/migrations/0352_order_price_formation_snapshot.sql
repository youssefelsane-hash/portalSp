-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0107 / docs/08 §161 — لقطة مراحل تكوين سعر العميل على الطلب
--
-- بلاغ مالك 2026-09-17: «صفحة الطلب لا تعطيني trace واضحًا يشرح كيف وصل السعر من ناتج
-- الـPrice Engine إلى المبلغ النهائي».
--
-- المراحل الموجودة فعلاً في `CatalogService.estimate()`:
--   ناتج المحرك الخام → تعديل المنطقة → مضاعف فئة المهارة/الشركة → قصّ الحد الأدنى/الأقصى
-- وبعدها الرسوم (كشف/طوارئ/إضافات/ضمان/خصم) اللي **متسجّلة أصلاً** في أعمدة الطلب.
--
-- اللي كان ناقص للتفسير التاريخي هو المراحل التلاتة الأولى بس. الأعمدة دي **لقطة**: تغيير
-- نسبة المنطقة أو مضاعف الفئة بعد أسبوع **مالوش أي أثر** على تفسير طلب قديم — وده شرط
-- صريح في الطلب.
--
-- ليه أعمدة على `orders` مش جدول جديد: علاقة ١:١ صارمة بالطلب، بتتكتب مرة واحدة وقت الإنشاء،
-- وبتتقرا دايمًا مع الطلب. جدول منفصل كان هيزوّد JOIN بلا أي قدرة إضافية.
-- `service_pricing_evaluations.computed_price_cents` بتغطي الناتج الخام لخدمات المعادلة بس،
-- فالعمود هنا بيغطي كل المسارات ويخلي الصف مفسَّر لوحده.
--
-- كلها NULL لأي طلب قديم — مفيش backfill بالتخمين (الإعدادات وقتها مش معروفة، وأي حساب
-- رجعي بالإعدادات الحالية هيكون **كذب** على طلب تاريخي).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pricing_engine_raw_cents integer,
  ADD COLUMN IF NOT EXISTS pricing_zone_modifier_percentage numeric(6,2),
  ADD COLUMN IF NOT EXISTS pricing_zone_adjustment_cents integer,
  ADD COLUMN IF NOT EXISTS pricing_tier_snapshot varchar(20),
  ADD COLUMN IF NOT EXISTS pricing_multiplier_source varchar(20),
  ADD COLUMN IF NOT EXISTS pricing_multiplier_snapshot numeric(6,4),
  ADD COLUMN IF NOT EXISTS pricing_tier_adjustment_cents integer,
  ADD COLUMN IF NOT EXISTS pricing_clamp_applied varchar(4),
  ADD COLUMN IF NOT EXISTS pricing_clamp_delta_cents integer,
  ADD COLUMN IF NOT EXISTS pricing_work_price_cents integer;

COMMENT ON COLUMN orders.pricing_engine_raw_cents IS
  'ناتج محرك التسعير الخام قبل أي تعديل تجاري (ADR-0107). NULL لطلبات قبل المهاجرة.';
COMMENT ON COLUMN orders.pricing_zone_modifier_percentage IS
  'نسبة تعديل المنطقة السارية وقت الحساب — لقطة، مش قراءة حيّة لـservice_zone_pricing.';
COMMENT ON COLUMN orders.pricing_zone_adjustment_cents IS
  'اللي زيادة المنطقة ضافته بالقروش (سالب = خصم).';
COMMENT ON COLUMN orders.pricing_tier_snapshot IS
  'فئة مهارة التسعير اللي المضاعف اتقرا منها (ServicePricingTierPricing هو المصدر التجاري).';
COMMENT ON COLUMN orders.pricing_multiplier_source IS
  'pricing_tier | company | none — معامل الشركة بديل عن فئة المهارة مش فوقه (ADR-0042).';
COMMENT ON COLUMN orders.pricing_multiplier_snapshot IS
  'المضاعف المطبّق فعلاً (1 = مفيش).';
COMMENT ON COLUMN orders.pricing_tier_adjustment_cents IS
  'اللي المضاعف ضافه بالقروش.';
COMMENT ON COLUMN orders.pricing_clamp_applied IS
  'min | max | NULL — أنهي حد قصّ تدخّل في السعر.';
COMMENT ON COLUMN orders.pricing_clamp_delta_cents IS
  'فرق القصّ بالقروش (موجب = الحد الأدنى رفع السعر).';
COMMENT ON COLUMN orders.pricing_work_price_cents IS
  'سعر الشغل بعد المراحل الأربعة وقبل أي رسوم — لازم يساوي estimated_price_cents للطلبات الجديدة.';

-- قيد تماسك: لو اللقطة موجودة، لازم تتجمع صح. ده بيمنع **بالبنية** أي كتابة جزئية تخلي
-- الشرح مش مطابق للسعر — بدل ما نكتشف كده في شاشة الأدمن بعدين.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_orders_price_formation_sums;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_price_formation_sums CHECK (
    pricing_work_price_cents IS NULL
    OR pricing_engine_raw_cents IS NULL
    OR pricing_work_price_cents =
         pricing_engine_raw_cents
         + COALESCE(pricing_zone_adjustment_cents, 0)
         + COALESCE(pricing_tier_adjustment_cents, 0)
         + COALESCE(pricing_clamp_delta_cents, 0)
  );
