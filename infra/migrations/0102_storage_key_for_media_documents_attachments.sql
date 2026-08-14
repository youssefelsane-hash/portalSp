-- baytak — 0102: storage_key لـ order_media/technician_documents/complaint_attachments
-- (docs/08 §19 بند 9، تدقيق جاهزية الإطلاق)
-- s3-storage.service.ts's تعليق الكلاس نفسه كان بيوثّق الفجوة دي صراحة: save() بترجع presigned
-- URL بعمر 7 أيام يتخزن دائم في file_url — بعد المدة دي الرابط بيبقى ميت (404) لغير S3 نفسه،
-- ومفيش آلية تجديد وقت القراءة. نمط branding module (getUrl(key) — تخزين الـkey بس، توليد رابط
-- طازة وقت كل قراءة) بيتعمم هنا على التلات جداول التانية اللي فيهم نفس المشكلة. storage_key
-- اختياري (NULL لأي صف قديم اترفع قبل الإصلاح ده — بيفضل يستخدم file_url المخزّن زي ما هو، مفيش
-- backfill ممكن لأن الـkey الأصلي مش متسجّل خالص لحد دلوقتي).
ALTER TABLE order_media ADD COLUMN storage_key TEXT NULL;
ALTER TABLE technician_documents ADD COLUMN storage_key TEXT NULL;
ALTER TABLE complaint_attachments ADD COLUMN storage_key TEXT NULL;
