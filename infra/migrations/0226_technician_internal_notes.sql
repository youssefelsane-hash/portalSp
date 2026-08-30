-- ملاحظات تشغيلية داخلية على ملف الفني. الجدول متاح من مسارات الإدارة فقط؛ تطبيقات العميل
-- والفني ليس عندها أي endpoint يقرأه. كل ملاحظة تحتفظ بكاتبها ووقتها بدل حقل نص واحد يُستبدل.

CREATE TABLE technician_internal_notes (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id   uuid NOT NULL REFERENCES technician_profiles(id) ON DELETE CASCADE,
  author_user_id  uuid NOT NULL REFERENCES users(id),
  note            text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 2000),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_technician_internal_notes_profile_created
  ON technician_internal_notes(technician_id, created_at DESC);
