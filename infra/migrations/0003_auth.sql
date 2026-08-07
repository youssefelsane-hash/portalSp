-- baytak — 0003: المصادقة والصلاحيات
-- مرجع: docs/02-data-dictionary.md §2

CREATE TABLE users (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone_number            VARCHAR(15)   NOT NULL UNIQUE,
  phone_verified_at       TIMESTAMPTZ   NULL,
  email                   VARCHAR(160)  NULL UNIQUE,
  email_verified_at       TIMESTAMPTZ   NULL,
  password_hash           VARCHAR(255)  NULL,
  full_name               VARCHAR(120)  NOT NULL,
  avatar_url               TEXT         NULL,
  user_type               user_type     NOT NULL,
  preferred_language      VARCHAR(5)    NOT NULL DEFAULT 'ar',
  is_active               BOOLEAN       NOT NULL DEFAULT true,
  is_blocked              BOOLEAN       NOT NULL DEFAULT false,
  blocked_reason          TEXT          NULL,
  blocked_at              TIMESTAMPTZ   NULL,
  last_login_at           TIMESTAMPTZ   NULL,
  last_login_ip           INET          NULL,
  referral_code           VARCHAR(12)   NULL UNIQUE,
  referred_by_user_id     UUID          NULL REFERENCES users(id),
  metadata                JSONB         NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ   NULL
);
CREATE INDEX idx_users_phone_number ON users(phone_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_user_type ON users(user_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_referral_code ON users(referral_code) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE otp_codes (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone_number      VARCHAR(15)   NOT NULL,
  code_hash         VARCHAR(255)  NOT NULL,
  purpose           otp_purpose   NOT NULL,
  attempts_count    SMALLINT      NOT NULL DEFAULT 0,
  max_attempts      SMALLINT      NOT NULL DEFAULT 5,
  is_used           BOOLEAN       NOT NULL DEFAULT false,
  used_at           TIMESTAMPTZ   NULL,
  expires_at        TIMESTAMPTZ   NOT NULL,
  request_ip        INET          NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_codes_phone_purpose ON otp_codes(phone_number, purpose, is_used);
CREATE INDEX idx_otp_codes_expires_at ON otp_codes(expires_at);

CREATE TABLE refresh_tokens (
  id                UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id           UUID              NOT NULL REFERENCES users(id),
  token_hash        VARCHAR(255)      NOT NULL UNIQUE,
  device_id         VARCHAR(128)      NULL,
  device_name       VARCHAR(120)      NULL,
  device_platform   device_platform   NULL,
  ip_address        INET              NULL,
  is_revoked        BOOLEAN           NOT NULL DEFAULT false,
  revoked_at        TIMESTAMPTZ       NULL,
  revoked_reason    VARCHAR(80)       NULL,      -- logout | rotation | security_breach
  expires_at        TIMESTAMPTZ       NOT NULL,
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at) WHERE is_revoked = false;

CREATE TABLE roles (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  name          VARCHAR(60)   NOT NULL UNIQUE,   -- super_admin | ops_manager | support_agent | finance | recruiter
  display_name  VARCHAR(120)  NOT NULL,
  description   TEXT          NULL,
  is_system     BOOLEAN       NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ   NULL
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE permissions (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  name        VARCHAR(80)   NOT NULL UNIQUE,     -- orders.view | orders.cancel | payouts.approve | users.block
  resource    VARCHAR(40)   NOT NULL,
  action      VARCHAR(40)   NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ   NULL
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON permissions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE role_permissions (
  role_id       UUID  NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID  NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id       UUID          NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by   UUID          NULL REFERENCES users(id),
  assigned_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- الأدوار الإدارية الأساسية (§6 في الماستر بلان)
INSERT INTO roles (name, display_name, is_system) VALUES
  ('super_admin',  'مدير عام',        true),
  ('ops_manager',  'مدير عمليات',      true),
  ('support_agent','موظف دعم',        true),
  ('finance',      'مالية',           true),
  ('recruiter',    'مسؤول تجنيد الفنيين', true);
