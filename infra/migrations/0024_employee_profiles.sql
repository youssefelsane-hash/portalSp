-- baytak — 0024: بروفايلات الموظفين الإداريين (تسلسل هرمي، قسم، بيانات وظيفية)
-- مرجع: apps/api/src/modules/admin/README.md
--
-- ده منفصل عمداً عن roles/permissions (0003/0020): "القسم" و"المدير المباشر" هيكل تنظيمي
-- (org chart) بينما roles/permissions هي صلاحيات وصول للنظام. نفس الموظف ممكن يتغيّر قسمه
-- أو مديره من غير ما ندي/نسحب منه أي صلاحية، والعكس. الربط الوحيد هو user_id.

CREATE TABLE employee_profiles (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id           UUID          NOT NULL UNIQUE REFERENCES users(id),
  employee_code     VARCHAR(24)   NOT NULL UNIQUE,      -- EMP-YYYY-NNNNNN عبر next_human_readable_number
  department        VARCHAR(60)   NOT NULL,             -- نص حر: operations | support | finance | quality | ... (بدون قيد على roles)
  title             VARCHAR(120)  NULL,
  manager_user_id   UUID          NULL REFERENCES users(id),
  hire_date         DATE          NULL,
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  notes             TEXT          NULL,
  created_by_user_id UUID         NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ   NULL
);
CREATE INDEX idx_employee_profiles_department ON employee_profiles(department) WHERE deleted_at IS NULL;
CREATE INDEX idx_employee_profiles_manager ON employee_profiles(manager_user_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON employee_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
