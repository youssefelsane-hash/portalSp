-- ترشيح QR للفني + مكافأة (docs/10 بند 39، docs/11 §1) — كل فني عنده كود ترشيح دائم
-- (technician_profiles.technician_code الموجود بالفعل، مُعاد استخدامه كـpayload الـQR — نفس
-- الكود المستخدم في ربط المساعد الشخصي، بس هنا لغرض مختلف: عميل يستخدمه بدل فني تاني).

-- التقاط الترشيح — عميل واحد بس عنده فني ترشيح واحد (أول التقاط يفوز، دائم، مفيش استبدال لاحق —
-- قرار مضاد لإساءة الاستخدام: فني ميقدرش "يقنع" عميل عنده ولاء لفني تاني يمسح كوده وقت الحجز).
CREATE TABLE technician_referral_attributions (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id     UUID          NOT NULL REFERENCES technician_profiles(id),
  customer_user_id  UUID          NOT NULL UNIQUE REFERENCES users(id),
  referral_token    VARCHAR(20)   NOT NULL,
  attributed_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_technician_referral_attributions_technician ON technician_referral_attributions(technician_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_referral_attributions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- مكافأة لكل طلب مؤهّل — order_id UNIQUE يضمن idempotency (نفس فلسفة orders.id UNIQUE في
-- ratings — طلب واحد يولّد مكافأة واحدة بالظبط، مهما اتكرر معالجة الحدث).
CREATE TABLE technician_referral_bonuses (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id         UUID          NOT NULL REFERENCES technician_profiles(id),
  customer_user_id      UUID          NOT NULL REFERENCES users(id),
  order_id              UUID          NOT NULL UNIQUE REFERENCES orders(id),
  bonus_amount_cents    INTEGER       NOT NULL,
  status                VARCHAR(20)   NOT NULL DEFAULT 'credited'
                          CHECK (status IN ('credited', 'revoked', 'rejected_suspicious')),
  rejection_reason      TEXT          NULL,
  -- لقطة device_id بتاع العميل وقت التقييم — مش استعلام حي على user_devices، لأن device_id
  -- عمود UNIQUE عالميًا هناك (ملكية بتتنقل، مش سجل تاريخي). لقطة دائمة هنا هي الطريقة الوحيدة
  -- الصح نكتشف بيها "نفس الجهاز فعلاً كسب مكافأة قبل كده لنفس الفني" حتى لو الجهاز اتنقل
  -- لمستخدم تاني بعدين — بَقّة حقيقية اتلقطت واتصلحت وقت الاختبار الحي (راجع README).
  customer_device_id    VARCHAR(128)  NULL,
  credited_at           TIMESTAMPTZ   NULL,
  revoked_at            TIMESTAMPTZ   NULL,
  revoked_reason        TEXT          NULL,
  wallet_debit_tx_id    UUID          NULL REFERENCES wallet_transactions(id),
  wallet_credit_tx_id   UUID          NULL REFERENCES wallet_transactions(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_technician_referral_bonuses_technician ON technician_referral_bonuses(technician_id, status);
CREATE INDEX idx_technician_referral_bonuses_credited_at ON technician_referral_bonuses(technician_id, credited_at) WHERE status = 'credited';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_referral_bonuses
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE technician_referral_attributions IS 'ربط عميل بفني اللي رشّحه (مسح QR/كود) — أول التقاط يفوز، دائم.';
COMMENT ON TABLE technician_referral_bonuses IS 'مكافأة فني عن طلب مؤهّل لعميل رشّحه — order_id UNIQUE لضمان idempotency.';

-- إعدادات قابلة للتعديل من /settings بالكامل — مفيش قيمة مالية أو حد مكتوب في الكود (docs/11).
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('referral_qr.enabled', 'true', 'boolean', 'referral_qr', 'تفعيل/تعطيل نظام ترشيح QR للفني بالكامل', false),
  ('referral_qr.bonus_amount_cents', '5000', 'number', 'referral_qr', 'مكافأة الفني بالقرش لكل طلب مؤهّل (افتراضي 50 جنيه — قابل للتعديل بالكامل)', false),
  ('referral_qr.qualifying_min_order_status', '"completed"', 'string', 'referral_qr', 'أقل حالة طلب لاستحقاق المكافأة: accepted أو work_completed أو completed', false),
  ('referral_qr.reward_mode', '"first_order_only"', 'string', 'referral_qr', 'first_order_only = أول طلب مؤهّل بس، every_order = كل طلب مؤهّل', false),
  ('referral_qr.min_order_amount_cents', '0', 'number', 'referral_qr', 'أقل قيمة طلب بالقرش عشان يستحق المكافأة (صفر = بلا حد أدنى)', false),
  ('referral_qr.max_monthly_bonus_cents_per_technician', '0', 'number', 'referral_qr', 'أقصى مكافآت ترشيح شهرية لكل فني بالقرش (صفر = بلا حد أقصى)', false),
  ('referral_qr.min_minutes_between_bonuses', '0', 'number', 'referral_qr', 'أقل مدة بالدقايق بين مكافأتين متتاليتين لنفس الفني — منع إساءة استخدام (صفر = معطّل)', false),
  ('referral_qr.reject_duplicate_device', 'true', 'boolean', 'referral_qr', 'رفض المكافأة لو العميل بيستخدم نفس جهاز الفني أو عميل تاني اتكافأ عليه الفني قبل كده', false);
