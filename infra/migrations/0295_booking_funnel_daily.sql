-- baytak — 0295: تجميع الفنل اليومي + الاحتفاظ (ADR-0081 §4)
--
-- ## ليه الجدول ده موجود
--
-- `booking_funnel_events` بيكبر بسرعة: صف لكل خطوة لكل محاولة حجز. التقرير الحي بيعمل
-- `COUNT(DISTINCT funnel_session_id)` على المدى كله، وده بيتحوّل لمسح ملايين الصفوف أول ما
-- المنصة تكبر — واللوحة بتبقى بطيئة بالظبط لما تبقى مفيدة.
--
-- الحل مش «نخزّن العدّادات ونزوّدها» (ده بالظبط فئة البَقّة اللي ADR-0081 §1 رافضها): الجدول
-- ده **مشتق بالكامل** من الأحداث الخام، بيتبني بإعادة حساب اليوم من أوله، وممكن يتمسح ويتبني
-- تاني في أي وقت من غير ما نخسر أي معلومة. لو اتعارض مع الأحداث، الأحداث هي الصح.
--
-- ## ليه الاحتفاظ ١٨٠ يوم للخام
--
-- المدى اللي أي سؤال إداري حقيقي بيتسأل فيه (ربع/نصف سنة) بيتغطّى من الخام، وأي حاجة أقدم
-- بتتقرا من التجميع. الخام بعد ٦ شهور تكلفة تخزين وفهرسة بلا سؤال بيتسأل عليها.

CREATE TABLE booking_funnel_daily (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- اليوم بتوقيت القاهرة (`OPERATING_TIMEZONE`) مش UTC — «كام حد بدأ حجز يوم الجمعة» سؤال
  -- بيتسأل بتقويم البلد، والتقسيم بـUTC كان بيحط شغل الليل في اليوم اللي بعده.
  day               DATE          NOT NULL,
  stage             VARCHAR(30)   NOT NULL,

  -- الجلسات المميّزة — نفس المقياس اللي التقرير الحي بيعده بالظبط، عشان الرقمين مايفرقوش.
  sessions          INTEGER       NOT NULL DEFAULT 0,
  -- كل الأحداث (جلسة واحدة ممكن تعيد نفس الخطوة). بيفرّق بين «١٠٠ حد» و«حد واحد ١٠٠ مرة».
  events            INTEGER       NOT NULL DEFAULT 0,
  failed_events     INTEGER       NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_booking_funnel_daily_counts CHECK (
    sessions >= 0 AND events >= 0 AND failed_events >= 0 AND failed_events <= events
  )
);

-- صف واحد لكل (يوم، مرحلة) — الدورة بتعمل upsert عليه، فإعادة تشغيلها مابتضاعفش الأرقام.
CREATE UNIQUE INDEX uq_booking_funnel_daily_day_stage ON booking_funnel_daily(day, stage);
CREATE INDEX idx_booking_funnel_daily_day ON booking_funnel_daily(day DESC);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON booking_funnel_daily
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- صف الإعداد نفسه: سجل الإعدادات في الكود لازم يقابله صف في القاعدة، وإلا `SettingsService.update()`
-- بيرمي 404 والأدمن مايقدرش يضبط المفتاح من اللوحة أصلاً (البَقّة اللي تدقيق C-3 اتعمل عشانها،
-- ومحروسة باختبار تطابق في الاتجاهين).
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('analytics.funnel_retention_days', '180'::jsonb, 'number', 'ops',
   'ADR-0081 §4: كام يوم نحتفظ بأحداث رحلة الحجز الخام. الأقدم من كده بيتمسح بعد ما يكون اتجمّع في booking_funnel_daily. الحد الأدنى المسموح ٧ أيام مهما كان الرقم المدخل.',
   false)
ON CONFLICT (key) DO NOTHING;
