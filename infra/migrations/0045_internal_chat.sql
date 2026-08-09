-- baytak — 0045: شات داخلي (مدير↔فنيين، أدمن↔فنيين) — منفصل عن chat_threads
-- طلب صريح: "نظام تواصل بين المدير والworkers وبين الأدمن والworkers". chat_threads الموجود
-- (0009) مالوش استخدام هنا: customer_id فيه NOT NULL + FK على customer_profiles، وموظفين/فنيين
-- مالهمش customer_profile أصلاً — تعديل قيد موجود على جدول مُختبر بالكامل أخطر من جدول جديد.
-- نطاق أول نسخة: بين أي مستخدم admin وأي مستخدم admin/technician تاني — مش technician↔technician
-- (مش مطلوب صراحة، والنطاق الأوسع محتاج قرارات هرمية إضافية مؤجلة).
CREATE TABLE internal_chat_threads (
  id                     UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  participant_a_user_id  UUID          NOT NULL REFERENCES users(id),
  participant_b_user_id  UUID          NOT NULL REFERENCES users(id),
  last_message_at        TIMESTAMPTZ   NULL,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- ترتيب ثابت (a < b) مفروض على مستوى القاعدة، مش بس التطبيق — يمنع صف مكرر لنفس الزوج
  -- بترتيب معكوس (A,B) و(B,A) بيبقوا نفس الخيط دايماً.
  CONSTRAINT internal_chat_threads_ordered_pair CHECK (participant_a_user_id < participant_b_user_id),
  CONSTRAINT internal_chat_threads_unique_pair UNIQUE (participant_a_user_id, participant_b_user_id)
);
CREATE INDEX idx_internal_chat_threads_participant_a ON internal_chat_threads(participant_a_user_id);
CREATE INDEX idx_internal_chat_threads_participant_b ON internal_chat_threads(participant_b_user_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON internal_chat_threads
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE internal_messages (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  thread_id        UUID          NOT NULL REFERENCES internal_chat_threads(id),
  sender_user_id   UUID          NOT NULL REFERENCES users(id),
  content          TEXT          NOT NULL,
  is_read          BOOLEAN       NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_internal_messages_thread_id ON internal_messages(thread_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON internal_messages
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
