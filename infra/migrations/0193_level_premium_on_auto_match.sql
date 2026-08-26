-- docs/08 §60.3 — فرق سعر "الفني المميّز" (level premium) في الاختيار التلقائي.
--
-- البَقّة اللي المالك وصفها: لما العميل يسيب المطابقة تختار، `OrdersService.create()` بيسعّر
-- بمضاعف مستوى = 1 (الفني مش معروف بعد، راجع knownTechnicianLevel في orders.service.ts). بعدين
-- المطابقة بتعيّن فني مستواه أعلى — بس السعر كان اتقفل خلاص على المضاعف الأقل. النتيجة إن مستوى
-- الفني ما بيأثرش في السعر خالص في المسار التلقائي، رغم إنه بيأثر في الاختيار اليدوي.
--
-- العمود ده بيسجّل الفرق كسطر تسعير مستقل وواضح (نفس أسلوب surge_amount_cents وwarranty_price_cents
-- الموجودين) — مش بند شغل، فمكانه هنا مش في order_items.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS level_premium_cents integer NOT NULL DEFAULT 0
  CHECK (level_premium_cents >= 0);

COMMENT ON COLUMN orders.level_premium_cents IS
  'docs/08 §60.3: فرق سعر مستوى الفني اللي اتضاف بعد التعيين التلقائي. 0 لو الفني كان معروف وقت الحجز (الفرق داخل السعر أصلاً) أو لو مستواه بلا مضاعف.';

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('pricing.auto_match_level_premium', '"charge"', 'string', 'pricing',
   'لما المطابقة التلقائية تعيّن فني مستواه بيزوّد السعر: charge = الفرق يتضاف للطلب كسطر "فني مميّز" (السلوك المطلوب من المالك)؛ absorb = الشركة تتحمّله والسعر ما يتغيّرش.', false)
ON CONFLICT (key) DO NOTHING;
