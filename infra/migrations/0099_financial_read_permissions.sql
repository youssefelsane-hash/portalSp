-- baytak — 0099: صلاحيات قراءة مالية مخصوصة (docs/08 §19 بند 8) — كانت GET /admin/payouts,
-- GET /admin/payouts/:id/order-items, GET /admin/wallets/:userId محمية بـ@Roles(ADMIN) بس، بلا
-- @RequirePermission — أي حساب أدمن (مش finance/super_admin بس) يقدر يقرا بيانات صرف/محفظة حساسة.
-- كمان reports.view كانت صلاحية واحدة بتجمع dashboard/technicians/zones (تشغيلي) مع revenue
-- (مالي بحت) وممنوحة لـops_manager — بيكسر مبدأ "الإيرادات وبيانات مالية حساسة = default-deny"
-- المطلوب صراحة. الحل: صلاحيات قراءة مالية جديدة، ممنوحة لـfinance بس (super_admin بياخدها
-- أوتوماتيك زي كل صلاحية عن طريق cross join الموجود بالفعل) — ops_manager يفضل عنده reports.view
-- (dashboard/technicians/zones التشغيلية) بس من غير الإيراد المالي.

INSERT INTO permissions (name, resource, action) VALUES
  ('payouts.view',        'payouts', 'view'),
  ('wallets.view',        'wallets', 'view'),
  ('reports.view_revenue','reports', 'view_revenue');

-- منح افتراضي لـfinance بس — super_admin بياخدها أوتوماتيك عن طريق is_super_admin bypass
-- (PermissionsService.isSuperAdminUser، ADR-0010 §1)، نفس نمط 0085.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (
  'payouts.view', 'wallets.view', 'reports.view_revenue'
) WHERE r.name = 'finance';
