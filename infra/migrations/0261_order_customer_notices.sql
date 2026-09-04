-- baytak (صُنّاع) — 0261: رسايل الإدارة للعميل تتخزّن على الطلب (ADR-0071، بلاغ مالك 2026-09-04)
--
-- البلاغ بالحرف: «الأدمن لو عايز حاجة زيادة، النوتيفيكيشن بتروح والتفاصيل مكتوبة فيها… ولكن لما
-- الكاستمر يخش على الطلب ما بيشوفش التفاصيل اللي الأدمن كاتبها». ونفس الشكوى بالظبط على تحويل
-- الطلب لمعاينة في الموقع.
--
-- السبب الجذري: `AssessmentTriageService.requestMoreInformation()` و`routeToOnsiteAssessment()`
-- كانوا بيكتبوا نص الأدمن في `audit_logs` (مسار أدمن) و`order_status_history.reason` (مش معروض
-- للعميل) وفي حدث الإشعار. الإشعار **عابر** — بيتقري مرة وبيروح وممكن مايوصلش أصلاً. فنص مكتوب
-- **علشان العميل** مكانش له أي مكان دايم يقراه منه. مش بَقّة عرض — الحقل نفسه مكانش موجود.
--
-- الجدول ده مقصور على «رسالة من الإدارة للعميل مربوطة بطلب». الإشعارات مالهاش أي تغيير — بقت
-- إخطار بالرسالة مش المكان الوحيد اللي فيها.
CREATE TYPE order_customer_notice_type AS ENUM (
  'info_requested',                 -- الإدارة طلبت تفاصيل/صور إضافية قبل التسعير
  'routed_to_onsite_assessment'     -- الإدارة حوّلت الطلب لمعاينة في الموقع
);

CREATE TABLE order_customer_notices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id UUID NOT NULL REFERENCES orders(id),
  notice_type order_customer_notice_type NOT NULL,
  message TEXT NOT NULL,
  -- مين كتبها من الإدارة — للتدقيق، **مش** بيتعرض للعميل (خصوصية الموظفين، نفس قاعدة §60.2).
  created_by_user_id UUID NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_order_customer_notices_order
  ON order_customer_notices(order_id, created_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE order_customer_notices IS
  'رسايل من الإدارة للعميل مربوطة بالطلب — بتتعرض في تفاصيل الطلب زي ما بتتعرض في الإشعار (ADR-0071)';
COMMENT ON COLUMN order_customer_notices.message IS
  'نص الأدمن زي ما كتبه بالحرف — نفس النص اللي بيروح في الإشعار، مصدر واحد';
