-- baytak — 0190: إنشاء المشروع يتحمل ضياع الرد وإعادة المحاولة من الموبايل.
ALTER TABLE projects
  ADD COLUMN idempotency_key VARCHAR(128);

CREATE UNIQUE INDEX uq_projects_customer_idempotency
  ON projects (customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN projects.idempotency_key IS
  'مفتاح ثابت لمحاولة إنشاء مشروع واحدة؛ إعادة نفس الطلب ترجع نفس المشروع بدل إنشاء نسخة.';
