-- Script 5 Part 11 §24 — صلاحيات دقيقة جديدة لبيانات الأمان/نشاط الموظفين. نفس نمط
-- employees.manage (0025)/customers.manage (0033) بالحرف — super_admin بس افتراضيًا، قابلة
-- للتوسيع لاحقًا عبر باني الأدوار الديناميكي (ADR-0010) بلا أي كود جديد.
INSERT INTO permissions (name, resource, action) VALUES
  ('security.alerts.view',    'security',  'alerts_view'),
  ('security.alerts.manage',  'security',  'alerts_manage'),
  ('security.sessions.revoke','security',  'sessions_revoke'),
  ('employees.activity.view', 'employees', 'activity_view'),
  ('employees.sessions.view', 'employees', 'sessions_view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name IN (
  'security.alerts.view', 'security.alerts.manage', 'security.sessions.revoke',
  'employees.activity.view', 'employees.sessions.view'
)
WHERE r.name = 'super_admin';

-- تنبيهات Super Admin اللحظية (Part 6) — إعادة استخدام محرك التوجيه الموجود (0030)، صفر قناة
-- إشعارات جديدة. قابل للتعديل من /admin/notification-routing-rules الموجودة بلا أي كود إضافي.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('security.critical_event', 'super_admin', '["in_app"]');
