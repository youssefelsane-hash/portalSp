-- Script 4 §22-29, §38-41 — إدارة طاقم الطلب من الأدمن (إضافة/إزالة/استبدال عضو). كانت فجوة
-- موثّقة صراحة: OrderTeamService.addMember()/removeMember() مقصورين على الفني القائد بس
-- (technician-leader-ownership-gated)، وAdminOrdersService.assignAssistant() مقصور على شغل
-- "مساعد" بس (ADR-0008) — مفيش أي مسار أدمن لإدارة أعضاء الطاقم العاديين (member_type='team_member').

-- نفس نمط منح orders.assign_assistant لـsuper_admin+ops_manager في 0076 — عملية تشغيلية يومية
-- (حل نقص طاقم، استبدال عضو غاب)، مش قرار يحتاج صلاحية super_admin فقط.
INSERT INTO permissions (name, resource, action) VALUES
  ('orders.manage_crew', 'orders', 'manage_crew');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'orders.manage_crew'
WHERE r.name IN ('super_admin', 'ops_manager');
