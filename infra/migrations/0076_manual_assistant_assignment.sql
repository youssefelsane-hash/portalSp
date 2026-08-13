-- baytak — 0076: تعيين مساعد يدوي من الأدمن بعد التصعيد (امتداد لـADR-0007)
-- ADR-0007 §7 أجّل صراحة "حل يدوي إداري بعد التصعيد" عن نطاقه الأول ("موثّق كنطاق متبقي
-- صريح، مش سهو"). المالك طلب إقفال الفجوة دي — التفاصيل الكاملة في ADR-0007-addendum.md.

-- order_team_members.added_by_technician_id كانت NOT NULL بافتراض "قائد الطلب هو اللي بيضيف
-- دايمًا" (إما يدويًا في "اعتماد"، أو تلقائيًا عبر AssistantMatchingService باسم القائد). التعيين
-- اليدوي من الأدمن مش له تقني "مضيف" حقيقي — لازم عمود بديل صريح بدل ما نحط أي قيمة وهمية.
ALTER TABLE order_team_members ALTER COLUMN added_by_technician_id DROP NOT NULL;
ALTER TABLE order_team_members ADD COLUMN added_by_admin_user_id UUID NULL REFERENCES users(id);
ALTER TABLE order_team_members ADD CONSTRAINT chk_order_team_members_added_by
  CHECK (added_by_technician_id IS NOT NULL OR added_by_admin_user_id IS NOT NULL);

COMMENT ON COLUMN order_team_members.added_by_admin_user_id IS 'تعيين يدوي من الأدمن بعد تصعيد مطابقة مساعد (ADR-0007 §7) — بديل لـadded_by_technician_id، واحد منهم بس لازم يكون موجود.';

-- نفس نمط منح orders.adjust_price لـsuper_admin+ops_manager في 0034 — تعيين مساعد يدوي بعد
-- تصعيد عملية تشغيلية يومية، مش قرار يحتاج صلاحية super_admin فقط.
INSERT INTO permissions (name, resource, action) VALUES
  ('orders.assign_assistant', 'orders', 'assign_assistant');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'orders.assign_assistant'
WHERE r.name IN ('super_admin', 'ops_manager');
