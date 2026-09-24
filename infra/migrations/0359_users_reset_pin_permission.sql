-- **صلاحية استرجاع رمز الدخول** (ADR-0109 §6-ب).
--
-- ليه صلاحية مستقلة مش `customers.manage`: الإجراء ده **بيفك قفل حساب** — بيمسح الـcredential
-- وبيلغي كل الجلسات. حد معاه `customers.manage` عشان يعدّل عنوان أو اسم مالوش لازمة يقدر
-- يفتح حسابات. وبما إن الاسترجاع بيتم بعد مكالمة تليفون (مفيش إثبات تقني)، الصلاحية دي هي
-- الحد الوحيد بين «الدعم بيساعد عميل» و«موظف بياخد حساب».
--
-- بتتضاف لـsuper_admin بس تلقائيًا. أي دور تاني لازم الأدمن يمنحها صراحةً من شاشة الأدوار.

INSERT INTO permissions (name, resource, action)
VALUES ('users.reset_pin', 'users', 'reset_pin')
ON CONFLICT (name) DO NOTHING;

-- super_admin بياخد كل الصلاحيات بالتعريف في الكود، بس الصف هنا بيخلي الشاشة تعرضها صح.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.is_super_admin = true
   AND r.deleted_at IS NULL
   AND p.name = 'users.reset_pin'
ON CONFLICT DO NOTHING;
