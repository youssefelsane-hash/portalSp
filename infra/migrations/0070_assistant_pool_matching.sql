-- baytak — 0070: مطابقة المساعدين التلقائية (ADR-0007)
-- كانت فجوة موثّقة صراحة (docs/08 §6): "مفهوم 'مساعد متاح للربط' مش موجود في القاموس، مش
-- هيتخترع" — المالك حدد القرار بالتفصيل (2026-08-13)، التصميم الكامل في ADR-0007.

-- بث/عرض فردي لكل مرشّح مساعد — نفس فلسفة order_assignments بس لمجال "شرائح مساعد" بدل
-- "طلب كامل لفني واحد" (ممكن أكتر من صف accepted لنفس الطلب لو required_assistants > 1).
CREATE TABLE order_assistant_offers (
  id                       UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                 UUID          NOT NULL REFERENCES orders(id),
  assistant_technician_id  UUID          NOT NULL REFERENCES technician_profiles(id),
  offer_status             VARCHAR(20)   NOT NULL DEFAULT 'sent'
                              CHECK (offer_status IN ('sent','accepted','rejected','expired','slot_filled')),
  sent_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  expires_at               TIMESTAMPTZ   NOT NULL,
  responded_at             TIMESTAMPTZ   NULL,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_assistant_offers_order ON order_assistant_offers(order_id, offer_status);
CREATE INDEX idx_order_assistant_offers_assistant ON order_assistant_offers(assistant_technician_id, offer_status);

COMMENT ON TABLE order_assistant_offers IS 'عروض مطابقة المساعد التلقائية (ADR-0007) — بث تنافسي، أول قبول صحيح ياخد الشريحة.';
COMMENT ON COLUMN order_assistant_offers.offer_status IS 'slot_filled = اتقفلت لأن حد تاني كسب السباق (مختلف عن expired = محدش رد قبل المهلة).';

-- إعادة استخدام order_team_members (migration 0060) لتخزين التعيين النهائي المؤكَّد لمساعد —
-- شخصي (أولوية 1) أو من المجمع (أولوية 2). العمود الجديد يفرّق استعلاميًا بين عضو فريق "اعتماد"
-- يدوي وبين مساعد اتوصل بالمطابقة التلقائية، بدل الاعتماد على role_label (نص حر هش).
ALTER TABLE order_team_members ADD COLUMN member_type VARCHAR(20) NOT NULL DEFAULT 'team_member'
  CHECK (member_type IN ('team_member','assistant'));
COMMENT ON COLUMN order_team_members.member_type IS 'assistant = اتوصل عبر مطابقة المساعد التلقائية (ADR-0007)، team_member = إضافة يدوية من قائد الطلب في "اعتماد" (docs/08 §5).';

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('assistant_matching.pool_matching_enabled',       'true', 'boolean', 'assistant_matching', 'مفتاح إيقاف عام لبث فرص المساعدة لمجمع المساعدين', false),
  ('assistant_matching.batch_size',                  '10',   'number',  'assistant_matching', 'عدد المساعدين المرشّحين اللي بيتبعتلهم عرض في كل بث', false),
  ('assistant_matching.response_timeout_seconds',    '120',  'number',  'assistant_matching', 'مهلة رد المساعدين على عرض المطابقة بالثانية', false);

-- تصعيد للعمليات لو انتهت المهلة وفيه شرائح مساعد لسه فاضية — نفس نمط order.emergency_created
-- (0053)، مفعّل افتراضيًا (بخلاف بعض القواعد التانية) لأن التصعيد ده سيناريو تشغيلي حرج.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('assistant_matching.escalated', 'ops_manager', '["in_app"]');
