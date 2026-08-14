-- baytak — 0095: نظام البراندنج القابل للإدارة من الأدمن (ADR-0014، توجيه المالك 2026-08-14)
CREATE TYPE branding_asset_type AS ENUM (
  'primary_logo', 'logo_mark', 'logo_light', 'logo_dark', 'login_logo', 'splash'
);

CREATE TABLE branding_assets (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  asset_type            branding_asset_type NOT NULL UNIQUE,
  storage_key           VARCHAR(300) NOT NULL,
  mime_type             VARCHAR(60) NOT NULL,
  width_px              SMALLINT NOT NULL,
  height_px             SMALLINT NOT NULL,
  file_size_bytes       INTEGER NOT NULL,
  original_file_name    VARCHAR(255),
  uploaded_by_user_id   UUID NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- صلاحية مخصوصة (ADR-0014) — تحكم مباشر في البراندنج المعروض للجميع، Super Admin بس مبدئيًا.
INSERT INTO permissions (name, resource, action) VALUES
  ('branding.manage', 'branding', 'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'branding.manage'
WHERE r.name = 'super_admin';
