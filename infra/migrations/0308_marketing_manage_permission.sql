-- صلاحية إدارة التسويق (ADR-0082، docs/08 §135).
--
-- **القراءة تحت نفس الصلاحية زي الكتابة عن قصد**: الأرقام دي بتكشف الصرف وهوامش الاكتساب
-- وأسماء وأرقام تليفونات شركاء (بوابين)، ومش كل موظف أدمن مفروض يشوفها. الفصل بين قراءة
-- وكتابة هنا كان هيدّي إحساس زايف بالتحكّم من غير ما يحمي أي حاجة.
INSERT INTO permissions (name, resource, action) VALUES
  ('marketing.manage', 'marketing', 'manage')
ON CONFLICT (name) DO NOTHING;

-- مين بياخدها: نفس اللي بيدخّل الإنفاق التسويقي بالفعل — مشتقّ من البيانات مش من قايمة أدوار
-- مكتوبة بالإيد (نفس أسلوب 0293/0294، وهو اللي بيخلّي أي دور مخصّص أضافه المالك يتغطّى كمان).
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id AND src.name = 'analytics.marketing_spend.manage'
JOIN permissions target ON target.name = 'marketing.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
