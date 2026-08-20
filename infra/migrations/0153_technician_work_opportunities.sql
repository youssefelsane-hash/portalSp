-- baytak — 0153: طلبات شغل إضافي اختيارية للفني اللي عنده شغل متوسط/تقيل في نفس اليوم
-- (docs/08 §34.1، ADR-0020 §2). راجع docs/adr/0020-technician-workload-tiers-and-fair-allocation.md
-- للتصميم الكامل.
--
-- ده كيان جديد منفصل تمامًا عن order_assignments (بث الطوارئ) — الفرق الجوهري: مفيش انتهاء
-- بالوقت (`expires_at`). الفرصة تفضل صالحة لحد ما (أ) الفني يقبل/يرفض، أو (ب) الطلب/المركز
-- المطلوب يتغطى بالكامل من فني/فنيين تانيين. قيد فريد جزئي يمنع تكرار العرض لنفس الفني لنفس
-- الطلب طالما لسه offered.

CREATE TYPE technician_work_opportunity_status AS ENUM ('offered', 'accepted', 'declined', 'closed');

CREATE TABLE technician_work_opportunities (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id        UUID        NOT NULL REFERENCES orders(id),
  technician_id   UUID        NOT NULL REFERENCES technician_profiles(id),
  -- تصنيف القدرة الاستيعابية وقت العرض (MEANINGFUL/HEAVY) — لأغراض شفافية الأدمن (docs/08 §34.4)،
  -- مش شرط تشغيلي (إعادة الفحص وقت القبول بتعتمد على الحالة الحقيقية اللحظية، مش القيمة المخزّنة هنا).
  capacity_tier_at_offer  VARCHAR(20) NOT NULL,
  status          technician_work_opportunity_status NOT NULL DEFAULT 'offered',
  offered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ NULL
);

-- منع تكرار العرض لنفس الفني لنفس الطلب طالما لسه offered (فني ممكن يترفضله عرض ويتعرضله تاني
-- لاحقًا لو الظروف اتغيّرت — القيد بيمنع بس تراكم عروض offered متعددة حية في نفس اللحظة).
CREATE UNIQUE INDEX uq_technician_work_opportunities_offered
  ON technician_work_opportunities (order_id, technician_id)
  WHERE status = 'offered' AND deleted_at IS NULL;

CREATE INDEX idx_technician_work_opportunities_order ON technician_work_opportunities (order_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_work_opportunities_technician_status
  ON technician_work_opportunities (technician_id, status) WHERE deleted_at IS NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_work_opportunities
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- إعدادات جديدة لنموذج القدرة الاستيعابية/العدالة (docs/08 §34، ADR-0020) — كلها قابلة للتعديل
-- من /admin/settings بلا كود، افتراضاتها محافظة (سلوك جديد قابل للتعطيل الكامل بسهولة).
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.offer_heavy_workload_technicians', 'true', 'boolean', 'matching',
   'فني تصنيفه HEAVY (شاغل يوم كامل/مدة متعددة الأيام) يتعرضله فرصة اختيارية برضه؟ false = يتستبعد تمامًا زي القديم', false),
  ('matching.fairness_lookback_days', '7', 'number', 'matching',
   'نافذة الأيام اللي نموذج العدالة بيراجعها لحساب توزيع الشغل الحديث للفني', false),
  ('matching.fairness_weight', '0', 'number', 'matching',
   'وزن مكوّن العدالة في ترتيب المطابقة — 0 = معطّل تمامًا (الترتيب زي ما هو دلوقتي)، لحد ما يتفعّل صراحة', false),
  ('matching.tie_break_threshold', '0', 'number', 'matching',
   'الفرق بين نتيجتين مرشّحين اللي تحتهم يُعتبروا "متعادلين" لكسر التعادل الموزون عشوائيًا — 0 = معطّل (ترتيب حتمي زي القديم)', false)
ON CONFLICT (key) DO NOTHING;
