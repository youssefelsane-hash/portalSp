-- §24 تدقيق الاكتمال الداخلي — فجوة حقيقية موثّقة: نمط storage_key/getUrl(key) الطازة (migration
-- 0102) اتطبّق على order_media/technician_documents/complaint_attachments بس اتسيبت technician_
-- certificates عمدًا برّه نطاق الإصلاح وقتها — نفس البَقّة بالظبط (presigned URL على S3 بينتهي
-- بعد 7 أيام، الرابط المخزّن بيموت بصمت). بتتقفل هنا بنفس النمط بالظبط.
ALTER TABLE technician_certificates
  ADD COLUMN storage_key TEXT NULL;
