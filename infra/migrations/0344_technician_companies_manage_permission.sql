-- صلاحية إدارة الشركة (ADR-0086) — ملف مستقل عن 0321 لأن 0343 اتطبّق بالفعل، و migration
-- اتعمله commit لازم يفضل ثابت (نفس القاعدة اللي `migrate.js` بيفرضها بالـchecksum).
--
-- الـendpoint `PATCH /admin/technician-companies/:id/recruitment-policy` قرار **حدود تشغيلية**
-- للشركة — مش قرار تسعير (`orders.adjust_price`) ولا اعتماد فني (`technicians.approve`). فله
-- صلاحيته الخاصة بدل ما يركب على واحدة معناها مختلف.
--
-- `AdminRouteRbacValidator` بيرفض **إقلاع التطبيق** لو صلاحية مذكورة في `@RequirePermission`
-- ومش موجودة في الكتالوج (اتلقطت حيًا وقت كتابة ADR-0086) — فالملف ده مش تجميل، من غيره الـAPI
-- مايقلعش أصلاً.
INSERT INTO permissions (name, resource, action) VALUES
  ('technician_companies.manage', 'technician_companies', 'manage')
ON CONFLICT (name) DO NOTHING;

-- مين بياخدها: نفس الأدوار اللي بتشوف الشركات بالفعل — مشتقّ من البيانات مش من قايمة أدوار
-- مكتوبة بالإيد، فأي دور مخصّص أضافه المالك بيتغطّى كمان (نفس أسلوب 0293/0294).
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id AND src.name = 'technician_companies.view'
JOIN permissions target ON target.name = 'technician_companies.manage'
ON CONFLICT DO NOTHING;
