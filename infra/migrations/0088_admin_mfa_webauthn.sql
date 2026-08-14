-- baytak — 0088: ترقية أمان دخول الأدمن — WebAuthn/Passkeys + MFA + Step-up (ADR-0011)
-- طلب صريح من المالك (docs/08 §14): MFA إجباري لكل High-Privilege role من أول يوم (فحص
-- صلاحية حي، مش قايمة أدوار hardcoded)، step-up للعمليات الحساسة، recovery قوي مايعتمدش
-- على SMS بمفرده.

-- مفاتيح Passkey العامة — السيرفر أبدًا ميخزّنش بصمة/بيانات بيومترية خام (public-key فقط).
CREATE TABLE webauthn_credentials (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id           UUID          NOT NULL REFERENCES users(id),
  credential_id     TEXT          NOT NULL UNIQUE,
  public_key        TEXT          NOT NULL,
  sign_count        BIGINT        NOT NULL DEFAULT 0,
  device_label      VARCHAR(120)  NULL,
  transports        JSONB         NULL,
  backed_up         BOOLEAN       NOT NULL DEFAULT false,
  last_used_at      TIMESTAMPTZ   NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);

COMMENT ON TABLE webauthn_credentials IS 'مفاتيح Passkey العامة لكل مستخدم (ADR-0011) — public-key بس، مفيش بيانات بيومترية خام.';

-- رموز استرجاع لمرة واحدة — تتولّد وقت أول تسجيل Passkey، تتعرض مرة واحدة بس، مخزّنة hashed.
-- الاستخدام محتاج OTP + recovery code مع بعض (عاملين مستقلين) — مش SMS بمفرده أبدًا.
CREATE TABLE admin_mfa_recovery_codes (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      UUID          NOT NULL REFERENCES users(id),
  code_hash    VARCHAR(255)  NOT NULL,
  used_at      TIMESTAMPTZ   NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_mfa_recovery_codes_user_id ON admin_mfa_recovery_codes(user_id);

COMMENT ON TABLE admin_mfa_recovery_codes IS 'أكواد استرجاع لمرة واحدة (ADR-0011) — لازم تتستخدم مع OTP مش بمفردها، عشان الاسترجاع مايرجعش لعامل ضعيف واحد.';

-- تحديات WebAuthn المؤقتة — جدول منفصل عن otp_codes عمدًا (شكل مختلف، مش مرتبط برقم موبايل،
-- user_id ممكن يكون NULL وقت discoverable-credential login لأن السيرفر لسه ميعرفش مين قبل التحقق).
CREATE TABLE webauthn_challenges (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id         UUID          NULL REFERENCES users(id),
  ceremony_type   VARCHAR(20)   NOT NULL CHECK (ceremony_type IN ('registration','authentication','step_up')),
  challenge       TEXT          NOT NULL,
  is_used         BOOLEAN       NOT NULL DEFAULT false,
  expires_at      TIMESTAMPTZ   NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_webauthn_challenges_challenge ON webauthn_challenges(challenge);

COMMENT ON TABLE webauthn_challenges IS 'تحديات WebAuthn المؤقتة لكل ceremony (ADR-0011) — دقايق العمر بس، سجل تدقيقي دايم.';

-- توكن step-up قصير العمر (دقيقتين) — معرّف صف حقيقي في Postgres مش JWT ومش Redis key، عشان
-- الاستهلاك-مرة-واحدة يكون fail-closed (انقطاع الداتابيز يمنع العملية الحساسة نفسها أصلاً،
-- بعكس Redis اللي فشله بيترجم "miss آمن" = ثغرة إعادة استخدام حقيقية لضابط أمان).
CREATE TABLE step_up_tokens (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      UUID          NOT NULL REFERENCES users(id),
  expires_at   TIMESTAMPTZ   NOT NULL,
  used_at      TIMESTAMPTZ   NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_step_up_tokens_user_id ON step_up_tokens(user_id);

COMMENT ON TABLE step_up_tokens IS 'توكن تأكيد Passkey حديث للعمليات الحساسة (ADR-0011 §4) — استهلاك مرة واحدة، صالح دقيقتين بس.';

-- تعبية أعمدة refresh_tokens الموجودة أصلاً (device_id/device_name/device_platform من migration
-- 0003 كانت فاضية دايمًا) — عمودين إضافيين جداد بس لإدارة الجلسات (ADR-0011 §5).
ALTER TABLE refresh_tokens ADD COLUMN last_seen_at TIMESTAMPTZ NULL;
ALTER TABLE refresh_tokens ADD COLUMN user_agent VARCHAR(255) NULL;
-- إزاي المستخدم أثبت هويته وقت إصدار الجلسة دي أصلاً (['otp'] أو ['otp','webauthn'] أو
-- ['webauthn']) — بيتنقل لكل access token جديد وقت refresh() بدل ما يضيع، عشان الـamr claim
-- يفضل معبّر عن الحقيقة حتى بعد تدوير التوكن مرات كتير.
ALTER TABLE refresh_tokens ADD COLUMN amr JSONB NOT NULL DEFAULT '["otp"]';

COMMENT ON COLUMN refresh_tokens.last_seen_at IS 'آخر مرة اتستخدم فيها التوكن ده فعليًا (refresh) — لعرض شاشة الأجهزة/الجلسات.';
COMMENT ON COLUMN refresh_tokens.amr IS 'Authentication Methods Reference وقت إصدار الجلسة (ADR-0011) — بينتقل لكل access token جديد وقت التدوير.';

-- تصعيد أمني فوري لاستخدام recovery code (ADR-0011 §6) — نفس نمط assistant_matching.escalated/
-- order.emergency_created، مفعّل افتراضيًا لأنه سيناريو أمني حرج مش تشغيلي عادي.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('admin_mfa.recovery_used', 'super_admin', '["in_app","push"]');
