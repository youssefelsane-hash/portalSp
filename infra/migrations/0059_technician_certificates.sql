-- baytak — 0059: شهادات/كورسات الفني المعروضة على بروفايله العام (docs/08 §4)
-- ليها غرض مختلف تماماً عن technician_documents: الأخيرة مستندات KYC خاصة (بطاقة/فيش وتشبيه)
-- بتتراجع وقت التسجيل وما بتتعرضش للعميل أبداً. الجدول ده بالعكس تسويقي بالكامل — شهادات
-- تدريب/كورسات يختارها الفني بنفسه ليعرضها كثقة إضافية، فلازم مراجعة أدمن (review_status) قبل
-- ما تبان publicly عشان محدش يحط شهادة مزوّرة، بالظبط بنفس منطق مراجعة المستندات — فبنعيد
-- استخدام enum document_review_status الموجود بدل ما نعمل واحد جديد بنفس القيم.
CREATE TABLE technician_certificates (
  id                  UUID                     PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id       UUID                     NOT NULL REFERENCES technician_profiles(id),
  title               VARCHAR(200)             NOT NULL,
  issuer_name         VARCHAR(200)             NULL,
  issued_at           DATE                     NULL,
  file_url            TEXT                     NOT NULL,
  review_status       document_review_status   NOT NULL DEFAULT 'pending',
  rejection_reason    TEXT                     NULL,
  reviewed_by_user_id UUID                     NULL REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ              NULL,
  display_order       SMALLINT                 NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ              NULL
);
CREATE INDEX idx_technician_certificates_technician_id ON technician_certificates(technician_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_certificates
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
