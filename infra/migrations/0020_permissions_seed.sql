-- baytak — 0020: تفعيل نظام الصلاحيات الدقيقة (roles/permissions موجودين من 0003 بس فاضيين)
-- مرجع: docs/02-data-dictionary.md §2.4 و apps/api/src/modules/admin/README.md (فجوة موثّقة اتقفلت هنا)

INSERT INTO permissions (name, resource, action) VALUES
  ('orders.cancel',               'orders',      'cancel'),
  ('orders.reassign',             'orders',      'reassign'),
  ('technicians.approve',         'technicians', 'approve'),
  ('technicians.review_documents','technicians', 'review_documents'),
  ('payouts.approve',             'payouts',     'approve'),
  ('refunds.issue',               'payments',    'refund'),
  ('complaints.resolve',          'complaints',  'resolve'),
  ('promotions.manage',           'promotions',  'manage'),
  ('loyalty.manage',              'loyalty',     'manage'),
  ('roles.manage',                'roles',       'manage');

-- super_admin ياخد كل الصلاحيات أوتوماتيك
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'super_admin';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (
  'orders.cancel', 'orders.reassign', 'technicians.approve', 'technicians.review_documents', 'promotions.manage'
) WHERE r.name = 'ops_manager';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'complaints.resolve'
WHERE r.name = 'support_agent';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (
  'payouts.approve', 'refunds.issue', 'loyalty.manage'
) WHERE r.name = 'finance';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (
  'technicians.approve', 'technicians.review_documents'
) WHERE r.name = 'recruiter';
