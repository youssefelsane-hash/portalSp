-- باني أدوار ديناميكي (docs/10 بند 43، ADR-0010). تمديد schema RBAC الموجود من migration 0003،
-- مش استبداله — الجداول الأربعة (roles/permissions/role_permissions/user_roles) شغالة بالفعل.

-- تفعيل/تعطيل مؤقت وعكسي — دور معطّل بيوقف يمنح صلاحياته فورًا (الفحص حي أصلاً، مفيش JWT staleness).
ALTER TABLE roles ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- يقفل بَقّة "الـCROSS JOIN كان لقطة لحظية" (موثّقة صراحة في 0038) جذريًا: super_admin بيتخطى
-- فحص role_permissions تمامًا بدل ما يعتمد على منح كل صلاحية جديدة له صراحة كل مرة — العمود ده
-- مش متاح للتعديل من أي endpoint (مقفول على الدور المزروع بس، منع تصعيد صلاحيات).
ALTER TABLE roles ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT false;
UPDATE roles SET is_super_admin = true WHERE name = 'super_admin';

-- صلاحية جديدة: تسمح لحاملها يمنح لدور تاني صلاحية هو نفسه ملوش (تصعيد صلاحيات متحكم فيه،
-- ADR-0010 §3) — تُمنح لـ super_admin بس افتراضيًا (بس is_super_admin بيتخطاها أصلاً، فمنحها
-- هنا للتوثيق/الوضوح مش للفعالية الفعلية).
INSERT INTO permissions (name, resource, action) VALUES
  ('roles.grant_unrestricted', 'roles', 'grant_unrestricted');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'roles.grant_unrestricted'
WHERE r.name = 'super_admin';

COMMENT ON COLUMN roles.is_active IS 'دور معطّل يوقف يمنح صلاحياته فورًا لأي مستخدم حامله — عكسي، مختلف عن deleted_at.';
COMMENT ON COLUMN roles.is_super_admin IS 'يتخطى فحص role_permissions بالكامل (كل الصلاحيات ضمنيًا). محدود على الدور المزروع، غير قابل للتعيين من الـAPI.';
