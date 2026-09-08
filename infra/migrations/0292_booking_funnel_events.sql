-- baytak — 0292: سجل أحداث رحلة الحجز (ADR-0081 §3)
--
-- الفجوة اللي الجدول ده بيسدّها: كل ما يحصل قبل ما الطلب يتولد مالوش أي أثر في القاعدة.
-- العميل يفتح خدمة، يشوف السعر، يتفرّج على الفنيين، وينسحب — ومفيش صف واحد بيقول ده حصل.
-- يعني سؤال «فين بنفقد العملاء؟» ماكانش ليه إجابة ممكنة من البيانات، مش إجابة صعبة.
--
-- **الجدول ده بيمسك اللي مالوش أثر تاني بس.** المراحل بعد إنشاء الطلب (تعيين الفني، وصوله،
-- اكتمال الشغل) بتتحسب من `order_status_history` وقت الاستعلام — دي مصدر الحقيقة لانتقالات
-- الحالة بالفعل، ونسخها هنا كان هيخلق مصدرين للحقيقة ممكن يختلفوا.
--
-- append-only بالطبيعة (مفيش UPDATE في الكود)، وله سياسة احتفاظ ١٨٠ يوم مع rollup يومي —
-- عشان كده مفيش `updated_at` ولا `deleted_at` عليه.

CREATE TABLE booking_funnel_events (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- بيوصّل مراحل نفس محاولة الحجز ببعض. بيتولّد في العميل مرة لكل محاولة وبيتبعت في هيدر
  -- `x-funnel-session`. NULL مسموح: كلاينت قديم لسه مابيبعتهوش يفضل بيدّي عدّاد مرحلة صحيح،
  -- بس مايدخلش في حساب التسرّب بين المراحل (اللي محتاج ربط الرحلة).
  funnel_session_id UUID          NULL,

  -- NULL = تصفّح قبل تسجيل الدخول.
  user_id           UUID          NULL REFERENCES users(id),

  stage             VARCHAR(30)   NOT NULL,
  -- `server` = اتسجّلت من نداء API حقيقي (لا بتضيع مع انقطاع الشبكة ولا بتتزوّر).
  -- `client` = التطبيق قالها (شاشة اتفتحت). الواجهة بتفرّق بين الاتنين عشان القارئ يعرف
  -- إيه الرقم اللي يقدر يبني عليه قرار.
  source            VARCHAR(10)   NOT NULL,

  -- **أهم عمودين للسؤال «إيه اللي مش حلو في الموقع»**: محاولة فشلت في مرحلة معناها المنتج
  -- منع العميل يكمّل، مش إن العميل غيّر رأيه. الاتنين لازم يتفرّقوا في التقرير.
  outcome           VARCHAR(10)   NOT NULL DEFAULT 'success',
  failure_reason    VARCHAR(120)  NULL,

  service_id        UUID          NULL REFERENCES services(id),
  city_id           UUID          NULL REFERENCES cities(id),
  client_channel    order_source_channel NOT NULL DEFAULT 'customer_app',

  -- بيتملى وقت `order_placed` — ده الجسر اللي بيخلّي المراحل المشتقة من
  -- `order_status_history` تنضم لنفس الرحلة.
  order_id          UUID          NULL REFERENCES orders(id),

  occurred_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_booking_funnel_events_stage CHECK (stage IN (
    'service_viewed', 'booking_started', 'price_previewed', 'providers_viewed', 'order_placed'
  )),
  CONSTRAINT chk_booking_funnel_events_source CHECK (source IN ('client', 'server')),
  CONSTRAINT chk_booking_funnel_events_outcome CHECK (outcome IN ('success', 'failed')),
  -- سبب الفشل إجباري مع الفشل وممنوع مع النجاح — من غير القيد ده بيبقى فيه صفوف «فشل بلا
  -- سبب» ومحدش يعرف يتصرف فيها.
  CONSTRAINT chk_booking_funnel_events_failure_reason CHECK (
    (outcome = 'failed' AND failure_reason IS NOT NULL) OR
    (outcome = 'success' AND failure_reason IS NULL)
  )
);

-- كل الاستعلامات بتبدأ بمدى زمني، وأغلبها بيقسّم بالمرحلة.
CREATE INDEX idx_booking_funnel_events_occurred_at ON booking_funnel_events(occurred_at);
CREATE INDEX idx_booking_funnel_events_stage_occurred ON booking_funnel_events(stage, occurred_at);
-- حساب التسرّب بين المراحل بيجمّع بالرحلة.
CREATE INDEX idx_booking_funnel_events_session ON booking_funnel_events(funnel_session_id)
  WHERE funnel_session_id IS NOT NULL;
-- «أنهي خدمة بتخسر ناس؟»
CREATE INDEX idx_booking_funnel_events_service ON booking_funnel_events(service_id, occurred_at)
  WHERE service_id IS NOT NULL;
-- فهارس المفاتيح الأجنبية الباقية (نفس قاعدة تدقيق-5: كل FK له فهرس).
CREATE INDEX idx_booking_funnel_events_user_id ON booking_funnel_events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_booking_funnel_events_order_id ON booking_funnel_events(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_booking_funnel_events_city_id ON booking_funnel_events(city_id) WHERE city_id IS NOT NULL;
