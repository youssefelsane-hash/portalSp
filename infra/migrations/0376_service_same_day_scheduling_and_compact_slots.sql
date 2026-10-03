-- Osta — 0376: نفس اليوم كحجز عادي + رسوم الطوارئ لكل خدمة + رصّ الساعات المقترحة
-- (ADR-0118، docs/08 §196، طلب مالك 2026-10-03).
--
-- «جوه الكتالوج لخدمة معينة (مثلاً المكوجي) زرار يخلي الاقتراحات تبتدي من نفس اليوم… وكمان جوه
-- الخدمة زرار يخلي الخدمة دي ينطبق عليها الـemergency cost أو لا».
--
-- الافتراضيات = السلوك الحالي بالحرف: نفس اليوم طوارئ (false)، ورسوم الطوارئ سارية (true).

ALTER TABLE services ADD COLUMN IF NOT EXISTS same_day_scheduling_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS emergency_surcharge_enabled BOOLEAN NOT NULL DEFAULT true;

-- حجز النهارده كموعد عادي معناه إن الخدمة بتقبل مواعيد أصلاً — من غير الشرط ده الطلب كان
-- هيترفض بـ«الخدمة دي مش بتقبل حجز مواعيد مقدمًا». الخدمة بتتحقق منه برسالة واضحة قبل الحفظ؛
-- القيد ده خط الدفاع الأخير.
-- migration-safety: ok جدول services فيه عشرات الصفوف بس، وكل الصفوف بتعدّي القيد (العمود الجديد false).
ALTER TABLE services DROP CONSTRAINT IF EXISTS chk_services_same_day_scheduling_needs_scheduling;
ALTER TABLE services ADD CONSTRAINT chk_services_same_day_scheduling_needs_scheduling
  CHECK (NOT same_day_scheduling_enabled OR allows_scheduling);

COMMENT ON COLUMN services.same_day_scheduling_enabled IS
  'ADR-0118 §4 — حجز النهارده للخدمة دي موعد عادي مش طوارئ: مفيش رسوم استعجال ولا بث، والعميل بيختار منفّذ، والاقتراحات بتبدأ من النهارده.';
COMMENT ON COLUMN services.emergency_surcharge_enabled IS
  'ADR-0118 §5 — false: الطلب المستعجل بيفضل مستعجل في التوزيع لكن رسوم الطوارئ = صفر.';

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('booking.same_day_min_lead_minutes', '90'::jsonb, 'number', 'booking',
   'أقل مهلة بالدقايق بين دلوقتي وأول ساعة ممكن تتقترح أو تتحجز النهارده (للخدمات المفعّل فيها «نفس اليوم كحجز عادي»). بتدّي الفني وقت يوصل.',
   false),
  ('booking.suggestion_compaction_weight', '0.6'::jsonb, 'number', 'booking',
   'وزن «الرصّ» في ترتيب الساعات المقترحة (٠ لـ١): الساعة اللي بتلزق في شغل قائم عند فني (أو أول يومه الفاضي) بتكسب على ساعة في نص فراغه، فيوم الفني يتملي ورا بعض. صفر = السلوك القديم.',
   false),
  ('booking.suggestion_adjacency_gap_minutes', '60'::jsonb, 'number', 'booking',
   'أقصى فجوة بالدقايق بين شغلانتين عشان الساعة تتحسب «لازقة» (بتشمل وقت المشوار).',
   false)
ON CONFLICT (key) DO NOTHING;
