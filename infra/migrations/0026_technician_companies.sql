-- baytak — 0026: شركات/فرق الفنيين (فني مستقل | فرد جوّه فريق | شركة بفروع وأدوار داخلية)
-- مرجع: apps/api/src/modules/technicians/README.md
--
-- تصميم واحد يغطي "الفريق" و"الشركة" سوا بدل مفهومين متوازيين: فريق صغير هو ببساطة شركة
-- من غير سجل تجاري وفروع رسمية. owner/manager عندهم سلطة إدارة الفريق (يضيفوا/يشيلوا أعضاء،
-- يعدّلوا فروع)، supervisor/worker أعضاء عاديين. ده منفصل تماماً عن roles/permissions
-- الإدارية (0003/0020) — سلطة داخل الشركة، مش صلاحية على نظام baytak نفسه.

CREATE TABLE technician_companies (
  id                              UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  owner_user_id                   UUID          NOT NULL UNIQUE REFERENCES users(id),
  name                            VARCHAR(160)  NOT NULL,
  commercial_registration_number  VARCHAR(60)   NULL,
  is_active                       BOOLEAN       NOT NULL DEFAULT true,
  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at                      TIMESTAMPTZ   NULL
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_companies
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE technician_company_branches (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  company_id    UUID          NOT NULL REFERENCES technician_companies(id),
  name          VARCHAR(160)  NOT NULL,
  area_id       UUID          NULL REFERENCES areas(id),
  address_line  TEXT          NULL,
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ   NULL
);
CREATE INDEX idx_technician_company_branches_company_id ON technician_company_branches(company_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_company_branches
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE technician_profiles
  ADD COLUMN company_id UUID NULL REFERENCES technician_companies(id),
  ADD COLUMN branch_id  UUID NULL REFERENCES technician_company_branches(id),
  ADD COLUMN team_role  VARCHAR(20) NOT NULL DEFAULT 'independent'
    CHECK (team_role IN ('independent', 'owner', 'manager', 'supervisor', 'worker'));
CREATE INDEX idx_technician_profiles_company_id ON technician_profiles(company_id) WHERE deleted_at IS NULL;
