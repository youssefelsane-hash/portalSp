-- baytak — 0085: صلاحيات قراءة جديدة — reports.view + recurring_orders.view
--
-- بَقّة أمنية حقيقية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، P0-2 في docs/12): كل
-- endpoints الـGET في AdminReportsController (dashboard/stats, reports/revenue,
-- reports/technicians, reports/zones) وAdminRecurringOrdersController (قايمة القوالب المتكررة)
-- كانوا محميين بـ@Roles(UserType.ADMIN) بس — يعني أي حساب أدمن (حتى support_agent بلا أي دور
-- تشغيلي حقيقي) يقدر يشوف بيانات الإيراد/الأرباح/تقارير الفنيين والمناطق والقوالب المتكررة.
-- مرجع: apps/api/src/modules/admin/README.md
INSERT INTO permissions (name, resource, action) VALUES
  ('reports.view', 'reports', 'view'),
  ('recurring_orders.view', 'recurring_orders', 'view');

-- منح افتراضي لـops_manager/finance — super_admin بياخدها أوتوماتيك عن طريق is_super_admin
-- bypass (ADR-0010، مفيش حاجة نمنحها هنا صراحة). recruiter/support_agent مايتاخدوهاش افتراضيًا —
-- التقارير المالية/التشغيلية مش جزء من دورهم.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN ('reports.view', 'recurring_orders.view')
WHERE r.name IN ('ops_manager', 'finance');
