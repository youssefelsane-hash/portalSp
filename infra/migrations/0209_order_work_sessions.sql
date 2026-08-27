-- ADR-0047 — استكمال الشغل يوم تاني (زيارات متعددة لطلب واحد).
--
-- المشكلة اللي بيحلها الجدول ده: الطلب كان دايمًا **زيارة واحدة** — `scheduled_at` واحد
-- و`started_at` واحد و`completed_at` واحد. لما الفني يكتشف وسط الشغل إنه محتاج قطعة غيار
-- نادرة، مكانش قدّامه غير إنه يقفل الطلب كأنه خلص (بيكسر التقييم والضمان والفلوس) أو يسيبه
-- مفتوح بلا معلومة (بيبان "متأخر" والعميل مش عارف حصل إيه).
--
-- **مش نفس `order_reschedule_requests` (0185)**: دي بتنقل زيارة **لسه ما حصلتش** بموافقة
-- العميل. هنا الشغل بدأ فعلاً، والفني مش بيطلب ينقل — بيقول "هرجع يوم كذا".

CREATE TABLE order_work_sessions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  technician_id  UUID NOT NULL REFERENCES technician_profiles(id),
  -- اليوم اللي الشغل حصل/هيحصل فيه. DATE مش TIMESTAMPTZ عمدًا — الجدولة في المشروع كله
  -- **باليوم** مش بالساعة (ADR-0018 §2).
  session_date   DATE NOT NULL,
  status         VARCHAR(20) NOT NULL
                 CHECK (status IN ('completed_partial', 'scheduled')),
  -- ليه وقف — بيتكتب على الزيارة اللي وقفت، وبيتعرض للعميل حرفيًا. مطلوب لها، ممنوع للمجدولة.
  pause_reason   TEXT NULL CHECK (pause_reason IS NULL OR char_length(btrim(pause_reason)) BETWEEN 3 AND 500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_order_work_session_reason CHECK (
    (status = 'completed_partial' AND pause_reason IS NOT NULL)
    OR
    (status = 'scheduled' AND pause_reason IS NULL)
  )
);

-- زيارة مجدولة واحدة بس مفتوحة لكل طلب — الفني ما ينفعش يجدول يومين جايين في نفس الوقت.
CREATE UNIQUE INDEX uq_order_work_sessions_one_scheduled
  ON order_work_sessions(order_id)
  WHERE status = 'scheduled';

CREATE INDEX idx_order_work_sessions_order_date
  ON order_work_sessions(order_id, session_date DESC);

-- بيخدم حساب حمل اليوم للفني (ADR-0047، القرار الفرعي 2): الزيارة المجدولة بتحجز طاقة
-- زيها زي أي طلب — من غير كده النظام هيوزّع شغل تاني على فني هو أصلاً مشغول في اليوم ده.
CREATE INDEX idx_order_work_sessions_technician_scheduled
  ON order_work_sessions(technician_id, session_date)
  WHERE status = 'scheduled';

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('orders.max_work_sessions_per_order', '3', 'number', 'orders',
   'أقصى عدد زيارات لطلب واحد (استكمال الشغل يوم تاني). بعده لازم تدخّل الدعم.', false)
ON CONFLICT (key) DO NOTHING;
