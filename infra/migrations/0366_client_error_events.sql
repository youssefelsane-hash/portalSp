-- **تتبّع أخطاء الواجهة** (ADR-0114، طلب مالك 2026-09-25).
--
-- الفجوة اللي بيقفلها: كل ما عندنا من رصد أخطاء كان **من ناحية السيرفر** — `RequestMetricsService`
-- (نسبة 5xx في الذاكرة) و`.dev-logs/errors.log` (متوقّف في الإنتاج عمدًا). خطأ بيحصل في متصفح
-- العميل — رندر مكسور، شبكة قاطعة، استدعاء بيرجع 400 — مكان مالوش **أي** أثر. يعني كنا بنعرف
-- بالمشكلة لما حد يكلّم الدعم، وده اللي المالك طلب إنهاؤه بالنص.
--
-- ### الصف ما فيهوش بيانات شخصية، وده تصميم مش سهو
--
-- `visitor_hash` = هاش الـIP + الـuser-agent + **ملح بيتغيّر كل يوم**. بيدّي «كام مستخدم مختلف
-- النهاردة» بالظبط، وبيمنع ربط نفس الزائر عبر أيام. الفرق بين قياس وبين بناء ملف عن زائر.
-- والمتصفح/النظام/نوع الجهاز بيتشقّوا في السيرفر من هيدر `user-agent` — مش حقول بيبعتها العميل،
-- لأن مسار الكتابة ده عام وأي حقل جاي من بره بيتعامل كمدخل مش كحقيقة.

CREATE TABLE IF NOT EXISTS client_error_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- نفس المسار بيخدم الموقع العام ولوحة الأدمن، والتجميع لازم يفصلهم: خطأ في شاشة أدمن واحدة
  -- مشكلة داخلية، ونفس العدد على صفحة حجز عامة مشكلة إيراد.
  app text NOT NULL,
  kind text NOT NULL,

  -- المسار **المطهّر**: `/orders/01a0…/rate` بيتحوّل لـ`/orders/:id/rate` في العميل وبيتطهّر
  -- تاني في السيرفر. من غير كده التجميع بيتفتّت لصف لكل طلب، والجدول بيبقى سجل مش قياس.
  page_path text NOT NULL,
  error_name text,
  error_message text,
  component_stack text,

  -- أي API فشل — سؤال المالك الحرفي. بيخلّي «٣٧ مستخدم» تبقى «٣٧ مستخدم، وكلهم على نفس المسار
  -- ده بكود ٥٠٠» يعني بلاغ قابل للتصرف فورًا.
  api_path text,
  api_status integer,

  browser text,
  os text,
  device_kind text,

  -- مفتاح التجميع: نفس الخطأ على نفس الصفحة بنفس الـAPI = نفس البصمة، فالعدّ بيبقى `count(*)`
  -- على فهرس مش مقارنة نصوص.
  fingerprint text NOT NULL,
  visitor_hash text,

  -- من التوكن لو الطلب جاله توكن صالح، وبس. عميل يبعت `user_id` بتاع حد تاني كان هيلوّث التجميع.
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,

  -- **وقت السيرفر**: ساعة جهاز العميل ممكن تكون غلط بأيام، وسؤال «النهاردة» لازم يبقى له جواب.
  occurred_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- استعلام التجميع الوحيد اللي الشاشة والإنذار بيعملوه: نافذة زمنية ← جمّع بالبصمة.
CREATE INDEX IF NOT EXISTS idx_client_error_events_window
  ON client_error_events (occurred_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_error_events_fingerprint
  ON client_error_events (fingerprint, occurred_at DESC)
  WHERE deleted_at IS NULL;

-- ── الإعدادات: عتبة الإنذار ومدة الاحتفاظ ────────────────────────────────────────
-- كلها في محرك الإعدادات مش أرقام في الكود — اللي بيضبط الحساسية هو اللي شايف حجم الشغل
-- الحقيقي، ونفس المبدأ بالحرف زي باقي `ops.alert_*` (ج-١٨).
INSERT INTO settings (group_name, key, value, value_type, description, is_public)
VALUES
  ('ops', 'ops.alert_client_errors_per_hour', '25', 'number',
   'عدد أخطاء الواجهة في الساعة اللي بعده يطلع تحذير في /admin/ops/health-metrics', false),
  ('ops', 'ops.alert_client_errors_per_hour_critical', '150', 'number',
   'عدد أخطاء الواجهة في الساعة اللي بعده يطلع إنذار حرج', false),
  ('ops', 'ops.client_errors_retention_days', '30', 'number',
   'مدة الاحتفاظ بأخطاء الواجهة قبل التنظيف التلقائي', false)
ON CONFLICT (key) DO NOTHING;
