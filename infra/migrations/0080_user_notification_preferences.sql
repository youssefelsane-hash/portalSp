-- تفضيلات إشعارات المستخدم بالقناة (docs/10 بند 37) — كانت مؤجّلة عمدًا كـbacklog. مستوى
-- القناة بس (push/sms/whatsapp/email)، مش لكل notification_type — نفس نطاق الطلب الأصلي
-- بالحرف ("تفضيلات إشعارات المستخدم (قنوات)"). in_app مستثناة عمدًا: هي صندوق الإشعارات نفسه
-- جوّه التطبيق، مفيش معنى لتعطيلها (العميل أصلاً بيفتح الشاشة بإرادته).
-- غياب الصف = تفعيل افتراضي (نفس فلسفة أي إعداد تاني في المشروع: القيمة الافتراضية أهم من
-- سطر مخزّن لكل مستخدم لكل قناة من أول يوم تسجيل).

CREATE TABLE user_notification_preferences (
  id          UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     UUID                NOT NULL REFERENCES users(id),
  channel     notification_channel NOT NULL,
  is_enabled  BOOLEAN             NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ         NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel)
);

CREATE INDEX idx_user_notification_preferences_user ON user_notification_preferences(user_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON user_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE user_notification_preferences IS 'تفضيل المستخدم بتعطيل/تفعيل قناة إشعار معيّنة (push/sms/whatsapp/email) — مستوى القناة بس، مش لكل نوع إشعار. غياب الصف = مفعّل افتراضيًا.';
