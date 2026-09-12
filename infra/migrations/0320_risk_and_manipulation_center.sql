-- ADR-0085 — مركز المخاطر والتلاعب (docs/08 §140)
--
-- كل الجداول هنا **جديدة بالكامل** ومفيش أي `ALTER` على جدول قايم: الميزة دي بتقرا من النظام
-- ومابتكتبش فيه، فمستحيل تكسر أي سلوك شغّال.

-- ═══ ١) كتالوج أنواع الإشارات ═══
--
-- الوزن في الداتابيز مش في الكود عمدًا: لو نوع إشارة طلع مصدر إنذارات كاذبة، الأدمن بينزّل
-- وزنه للجميع مرة واحدة من غير نشر نسخة جديدة (ADR-0085 §4).
CREATE TABLE risk_signal_types (
  code                varchar(64) PRIMARY KEY,
  bucket              varchar(32) NOT NULL CHECK (bucket IN (
                        'pricing_abuse', 'parts_manipulation', 'order_abuse',
                        'off_platform_leakage', 'customer_abuse', 'collusion_fraud')),
  label_ar            varchar(160) NOT NULL,
  description_ar      text NOT NULL,
  weight              smallint NOT NULL CHECK (weight BETWEEN 1 AND 100),
  -- الأدوار اللي الكاشف ده ينطبق عليها — كاشف إساءة العميل مالوش معنى على فني.
  applies_to          varchar(32)[] NOT NULL,
  is_enabled          boolean NOT NULL DEFAULT true,
  updated_by_user_id  uuid NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON risk_signal_types
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══ ٢) الإشارات المرصودة ═══
CREATE TABLE risk_signals (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- **مستخدم مش ملف فني**: المالك طلب الفني والمساعد والعميل بنفس المنطق (ADR-0085 §7).
  actor_user_id       uuid NOT NULL REFERENCES users(id),
  actor_type          varchar(32) NOT NULL CHECK (actor_type IN ('technician','assistant','customer','company')),
  signal_type_code    varchar(64) NOT NULL REFERENCES risk_signal_types(code),
  order_id            uuid NULL REFERENCES orders(id) ON DELETE SET NULL,
  -- **لحظة الوقوع الحقيقية** — مدخل الاضمحلال. مابتتغيرش لو البيانات المصدر اتعدّلت بعدين.
  occurred_at         timestamptz NOT NULL,
  -- الأرقام اللي بتفسّر الإشارة: القيمة المقاسة، وسيط الأقران، حجم العيّنة… الواجهة بتعرضها
  -- كما هي فالمراجع يفهم «ليه ده شاذ» في ثواني.
  evidence            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- بديل وزن النوع لهذه الإشارة تحديدًا (شدّة متفاوتة داخل نفس النوع). NULL = وزن النوع.
  weight_override     smallint NULL CHECK (weight_override BETWEEN 1 AND 100),
  verdict             varchar(32) NOT NULL DEFAULT 'pending'
                        CHECK (verdict IN ('pending','legitimate','suspicious','confirmed_abuse','insufficient_evidence')),
  verdict_by_user_id  uuid NULL REFERENCES users(id),
  verdict_at          timestamptz NULL,
  verdict_notes       text NULL,
  -- **مفتاح التكرار**: بيخلّي إعادة تشغيل الكاشف آمنة. بيتبني من (النوع + الفاعل + المدى/الطلب).
  dedupe_key          varchar(255) NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_risk_signals_dedupe ON risk_signals(dedupe_key);
CREATE INDEX idx_risk_signals_actor ON risk_signals(actor_user_id, occurred_at DESC);
CREATE INDEX idx_risk_signals_type ON risk_signals(signal_type_code, occurred_at DESC);
CREATE INDEX idx_risk_signals_order_id ON risk_signals(order_id);
CREATE INDEX idx_risk_signals_verdict_by_user_id ON risk_signals(verdict_by_user_id);
CREATE INDEX idx_risk_signals_pending ON risk_signals(occurred_at DESC) WHERE verdict = 'pending';
CREATE TRIGGER set_updated_at BEFORE UPDATE ON risk_signals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══ ٣) الحالات: وحدة الشغل البشري ═══
--
-- حالة واحدة مفتوحة لكل فاعل — الطابور بيبقى «ناس» مش «أحداث»، وده كل الفرق عن مركز المراجعة.
CREATE TABLE risk_cases (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_user_id       uuid NOT NULL REFERENCES users(id),
  actor_type          varchar(32) NOT NULL,
  status              varchar(32) NOT NULL DEFAULT 'needs_review'
                        CHECK (status IN ('needs_review','monitoring','investigating','cleared','confirmed_manipulation')),
  -- الدرجة وقت آخر تقييم — **للفرز والتاريخ بس**. الدرجة المعروضة بتتحسب وقت القراءة دايمًا
  -- (ADR-0085 §1)، فالعمود ده مايتقريش كمصدر حقيقة في أي قرار.
  score_at_open       smallint NOT NULL DEFAULT 0,
  last_score          smallint NOT NULL DEFAULT 0,
  last_scored_at      timestamptz NULL,
  assigned_to_user_id uuid NULL REFERENCES users(id),
  opened_reason       text NULL,
  resolution_notes    text NULL,
  closed_by_user_id   uuid NULL REFERENCES users(id),
  closed_at           timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_risk_cases_open_actor ON risk_cases(actor_user_id)
  WHERE closed_at IS NULL;
CREATE INDEX idx_risk_cases_status ON risk_cases(status, last_score DESC);
CREATE INDEX idx_risk_cases_assigned_to_user_id ON risk_cases(assigned_to_user_id);
CREATE INDEX idx_risk_cases_closed_by_user_id ON risk_cases(closed_by_user_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON risk_cases
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══ ٤) الإجراءات المتدرجة ═══
--
-- **الحالة قبل وبعد مخزّنة في الصف نفسه**: أي إجراء لازم يكون قابل للمراجعة والرجوع بعد شهور،
-- وقتها الحالة الحالية للحساب مابتقولش إيه اللي اتغيّر ولا مين غيّره.
CREATE TABLE risk_actions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  case_id             uuid NOT NULL REFERENCES risk_cases(id) ON DELETE CASCADE,
  actor_user_id       uuid NOT NULL REFERENCES users(id),
  action_type         varchar(48) NOT NULL CHECK (action_type IN (
                        'monitor','manual_review','reduce_matching_priority','matching_hold',
                        'suspend_account','restore_account','clear_no_action')),
  reason              text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 2000),
  -- **لقطة الدليل وقت القرار** — الإشارات بتضمحل والبيانات بتتغيّر؛ المراجعة اللاحقة لازم
  -- تشوف اللي المنفّذ شافه هو، مش الحالة النهاردة.
  evidence_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_at_action     smallint NOT NULL,
  previous_state      jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_state           jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at          timestamptz NULL,
  reverted_at         timestamptz NULL,
  reverted_by_user_id uuid NULL REFERENCES users(id),
  performed_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_risk_actions_case ON risk_actions(case_id, created_at DESC);
CREATE INDEX idx_risk_actions_actor ON risk_actions(actor_user_id, created_at DESC);
CREATE INDEX idx_risk_actions_performed_by_user_id ON risk_actions(performed_by_user_id);
CREATE INDEX idx_risk_actions_reverted_by_user_id ON risk_actions(reverted_by_user_id);

-- ═══ ٥) بذور أنواع الإشارات ═══
--
-- كل نوع هنا **له كاشف فعلي مبني على بيانات موجودة**. مفيش نوع تطلّعي بلا مصدر — نوع بلا
-- كاشف بيخلّي الشاشة تعد بحاجة مش بتحصل.
INSERT INTO risk_signal_types (code, bucket, label_ar, description_ar, weight, applies_to) VALUES
  ('price_increase_rate_vs_peers', 'pricing_abuse',
   'معدل زيادة السعر أعلى من الأقران',
   'نسبة طلبات الفني اللي زوّد فيها السعر بعد الحجز، مقارنة بوسيط أقرانه في نفس فئة الخدمة.',
   22, ARRAY['technician','company']),

  ('quote_above_expected_range', 'pricing_abuse',
   'عرض سعر فوق النطاق المتوقع',
   'الفني قدّم عرض سعر أعلى من النطاق اللي النظام نفسه حسبه للشغلانة (expected_max_cents).',
   18, ARRAY['technician','company']),

  ('parts_cost_above_peers', 'parts_manipulation',
   'تكلفة قطع الغيار أعلى من الأقران',
   'متوسط قيمة قطع الغيار في طلبات الفني مقارنة بوسيط أقرانه في نفس الفئة.',
   18, ARRAY['technician','company']),

  ('parts_without_receipt', 'parts_manipulation',
   'قطع غيار بلا إيصال',
   'بنود قطع غيار اتضافت بلا صورة إيصال — المبلغ بيتحمّل على العميل بلا أي إثبات شراء.',
   14, ARRAY['technician','company']),

  ('accept_then_cancel', 'order_abuse',
   'قبول ثم إلغاء متكرر',
   'الفني بيقبل الطلب وبعدين يلغيه. بيحجز الطلب ويمنع غيره من أخذه، والعميل بيستنى بلا داعي.',
   15, ARRAY['technician','assistant','company']),

  ('late_cancellation_after_acceptance', 'order_abuse',
   'إلغاء متأخر بعد القبول',
   'إلغاءات بعد وقت طويل من القبول — أصعب حالة على العميل لأن الوقت اللي كان ممكن يلاقي فيه بديل ضاع.',
   12, ARRAY['technician','assistant','company']),

  ('contact_then_cancel', 'off_platform_leakage',
   'تواصل مع العميل ثم إلغاء سريع',
   'رسائل اتبعتت للعميل وبعدها إلغاء سريع. مؤشر — **مش إثبات** — على اتفاق خارج المنصة.',
   17, ARRAY['technician','assistant']),

  ('customer_churn_after_cancel', 'off_platform_leakage',
   'العميل وقف يحجز بعد الإلغاء',
   'عملاء ألغى لهم الفني وما رجعوش يحجزوا من المنصة بعدها خالص.',
   15, ARRAY['technician','assistant']),

  ('refund_rate_above_peers', 'customer_abuse',
   'معدل استرداد أعلى من المعتاد',
   'نسبة طلبات العميل اللي انتهت باسترداد، مقارنة بوسيط العملاء.',
   16, ARRAY['customer']),

  ('complaint_rate_above_peers', 'customer_abuse',
   'معدل شكاوى أعلى من المعتاد',
   'عدد الشكاوى اللي قدّمها العميل مقارنة بعدد طلباته ووسيط العملاء.',
   13, ARRAY['customer']),

  ('complaints_against_actor', 'customer_abuse',
   'شكاوى مرفوعة ضد الشخص',
   'شكاوى مقدّمة ضد الشخص ده تحديدًا — بتتحسب للفني والعميل بنفس الطريقة.',
   14, ARRAY['technician','assistant','customer','company']),

  ('repeat_pair_concentration', 'collusion_fraud',
   'تركّز غير طبيعي مع نفس الطرف',
   'نسبة عالية من طلبات الشخص مع نفس الطرف الآخر — مؤشر على معاملات متعمّدة بين حسابين.',
   20, ARRAY['technician','customer','assistant']);
