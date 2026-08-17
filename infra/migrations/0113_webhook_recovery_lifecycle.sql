-- baytak — 0113: دورة حياة Webhook قابلة للاسترداد (Script 1، Phase 1)
-- الحدث الخارجي معرّف داخل provider بعينه، وليس عقدًا عالميًا بين كل البوابات. القيد المركب
-- يمنع تكرار الحدث من نفس البوابة من غير ما يخلط رقم Paymob رقمي محتمل مع مرجع Fawry.

ALTER TABLE webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_external_event_id_key;

CREATE UNIQUE INDEX uq_webhook_events_provider_external_event
  ON webhook_events(provider, external_event_id);

-- حالة FAILED ليست نهاية تلقائية: هذه الحقول تفصل بين محاولة فشلت وبين حدث نهائي معالَج، وتسمح
-- بـ recovery محدود ومرئي بدون إعادة محاولة لا نهائية.
ALTER TABLE webhook_events
  ADD COLUMN processing_started_at TIMESTAMPTZ NULL,
  ADD COLUMN next_retry_at TIMESTAMPTZ NULL;

CREATE INDEX idx_webhook_events_recovery_ready
  ON webhook_events(processing_status, next_retry_at)
  WHERE processing_status = 'failed';

CREATE INDEX idx_webhook_events_processing_started
  ON webhook_events(processing_started_at)
  WHERE processing_status = 'processing';

-- صفوف قديمة بتوقيع غير صالح لا يجب أن تدخل recovery؛ التوقيع اتراجع بالفعل ولا توجد معلومة
-- جديدة في إعادة نفس الحمولة المزورة.
UPDATE webhook_events
SET processing_status = 'ignored',
    processed_at = COALESCE(processed_at, now())
WHERE processing_status = 'failed'
  AND signature_valid = false;

-- الأحداث الصحيحة القديمة لا تحتوي نسخة من HMAC query الخاص بـ Paymob، لذلك لا يمكن إعادة
-- التحقق منها بأمان بعد النشر. تظل FAILED ومرئية للمراجعة، لكن لا ندخلها في retry تلقائيًا؛
-- كل حدث جديد يحفظ توقيع delivery ويأخذ next_retry_at عند الفشل.
UPDATE webhook_events
SET next_retry_at = NULL
WHERE processing_status = 'failed'
  AND signature_valid = true;

-- إعدادات تشغيلية قابلة للمراجعة بدلاً من أرقام retry ثابتة في الكود.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('payments.webhook_recovery_max_attempts', '5', 'number', 'payments', 'أقصى عدد محاولات معالجة webhook فاشل قبل المراجعة اليدوية', false),
  ('payments.webhook_recovery_base_delay_seconds', '30', 'number', 'payments', 'أول مهلة لإعادة معالجة webhook فاشل؛ يتضاعف التأخير لكل محاولة', false),
  ('payments.webhook_processing_stale_minutes', '5', 'number', 'payments', 'بعدها تعتبر محاولة webhook processing عالقة وقابلة للاسترداد', false),
  ('payments.webhook_recovery_batch_size', '25', 'number', 'payments', 'أقصى عدد webhooks يستعيده الفحص الدوري في الدفعة الواحدة', false)
ON CONFLICT (key) DO NOTHING;
