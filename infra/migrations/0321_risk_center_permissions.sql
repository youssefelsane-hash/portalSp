-- صلاحيات مركز المخاطر (ADR-0085، docs/08 §140).
--
-- **صلاحية مستقلة مش `operations.view`**: الشاشة دي بتعرض تحليل سلوكي شخصي عن ناس بالاسم —
-- «الفني ده بنشك إنه بيسرّب عملاء». ده مستوى حساسية مختلف تمامًا عن لوحة العمليات اللي بتقول
-- «فيه طلب معداه عدّى»، ومايستحملش نفس دائرة الاطلاع.
INSERT INTO permissions (name, resource, action) VALUES
  ('risk_center.view', 'risk_center', 'view'),
  ('risk_center.manage', 'risk_center', 'manage')
ON CONFLICT (name) DO NOTHING;

-- القراءة بتروح لمين بيراجع الشكاوى أصلاً (نفس دائرة الثقة، ونفس نوع البيانات الشخصية)،
-- والإدارة بتروح لمين بيقدر يحظر حساب عميل بالفعل (`customers.manage` — هي الصلاحية اللي
-- `admin-customers.service.ts` بيقفل بيها الحظر). مشتقّ من البيانات مش من قايمة أدوار مكتوبة
-- بالإيد، عشان أي دور مخصّص أضافه المالك يتغطّى كمان (نفس أسلوب 0293/0294/0310).
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id AND src.name = 'complaints.view'
JOIN permissions target ON target.name = 'risk_center.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id AND src.name = 'customers.manage'
JOIN permissions target ON target.name = 'risk_center.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ومين عنده الإدارة لازم يشوف كمان — إجراء بلا اطلاع على سببه قرار أعمى.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id AND src.name = 'risk_center.manage'
JOIN permissions target ON target.name = 'risk_center.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;
