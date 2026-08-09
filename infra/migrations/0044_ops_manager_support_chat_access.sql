-- baytak — 0044: توسيع صلاحية support_tickets.manage لتشمل ops_manager
-- طلب صريح: "عايز السيستم يوصل تحت الأدمن... المانيجر يعرف يكلم مع العميل برضه" — مدير العمليات
-- (ops_manager) دلوقتي يقدر يرد على شات الدعم العام وتذاكر الدعم زي super_admin/support_agent
-- بالظبط (support_tickets.manage هي نفس الصلاحية اللي شات الدعم بيستخدمها — راجع
-- apps/api/src/modules/chat/README.md و0037). الصلاحية نفسها موجودة من 0037، هنا بس منحها
-- لدور إضافي — مفيش صلاحية جديدة.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'support_tickets.manage'
WHERE r.name = 'ops_manager';
