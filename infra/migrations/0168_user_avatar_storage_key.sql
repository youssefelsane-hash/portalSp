-- ADR-0031 — أفتار الفني/الشغالة المعتمد (بعد موافقة الأدمن على مستند "صورة شخصية") لازم يتخزّن
-- كـstorage key ثابت مش رابط presigned جاهز (بينتهي بعد 7 أيام في S3) — نفس نمط
-- branding_assets/technician_documents/technician_certificates بالحرف. NULL يعني مفيش صورة
-- معتمدة لسه (fallback لـavatar_url الخام الموجود، لو موجود).
ALTER TABLE users ADD COLUMN avatar_storage_key text NULL;
