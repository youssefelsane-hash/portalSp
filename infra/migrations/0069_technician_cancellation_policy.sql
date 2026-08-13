-- baytak — 0069: سياسة إلغاء الفني الكاملة (docs/10-integration-completion-tracker.md) —
-- OrdersService.technicianCancel() القديمة كانت بسيطة (سبب + رسوم بس، hardcoded بالكامل).
-- الجدول ده بيسجّل تفصيل كل إلغاء فني بشكل قابل للاستعلام (audit/ops)، منفصل عن order_status_history
-- العام لأنه محتاج حقول مخصوصة (كود سبب + نص حر + وقت منقضي + هل جوّه النافذة المسموحة) مش موجودة
-- في الجدول العام. orders.cancelled_at/cancelled_by_user_id/cancellation_reason_id فضلوا محجوزين
-- للإلغاء النهائي الحقيقي (عميل/نظام) بس — إلغاء الفني هنا مش بيقفل الطلب نهائي (بيرجع للمطابقة
-- أو لإعادة اختيار العميل، تفاصيل في orders/README.md).

-- "أخرى" كسبب لازم نص حر إجباري — عمود جديد على الجدول الموجود أصلاً بدل ما نخترع enum سبب موازي.
ALTER TABLE cancellation_reasons ADD COLUMN requires_free_text BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE technician_order_cancellations (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                UUID          NOT NULL REFERENCES orders(id),
  technician_id           UUID          NOT NULL REFERENCES technician_profiles(id),
  technician_user_id      UUID          NOT NULL REFERENCES users(id),
  cancellation_reason_id  UUID          NOT NULL REFERENCES cancellation_reasons(id),
  reason_text             TEXT          NULL,
  booking_mode            booking_mode  NOT NULL,
  accepted_at             TIMESTAMPTZ   NOT NULL,
  cancelled_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  elapsed_seconds_after_acceptance  INTEGER  NOT NULL,
  within_policy_window    BOOLEAN       NOT NULL,
  -- 'auto_rematch' (طوارئ أو auto-match مفعّل — رجع searching_technician فورًا، استبعاد الفني
  -- اللي لغى) أو 'manual_reselection_required' (العميل هو اللي اختار الفني ده بنفسه، أو
  -- auto-match متعطّل — الطلب يستنى العميل يختار بديل بنفسه، awaiting_technician_reselection).
  recovery_action         VARCHAR(30)   NOT NULL,
  fee_cents               INTEGER       NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_technician_order_cancellations_order ON technician_order_cancellations(order_id);
CREATE INDEX idx_technician_order_cancellations_technician ON technician_order_cancellations(technician_id);
