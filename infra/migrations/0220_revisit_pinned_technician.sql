-- baytak — 0220: إعادة الزيارة مربوطة بالفني الأصلي (ADR-0051، docs/08 §96).
--
-- requested_technician_id معناه المستقر في النظام "تفضيل يتجاهَل بأمان" (إعادة الحجز/اعتماد
-- شركة)، فمينفعش يحمل التزام صارم. الأعمدة دي بتفصل الالتزام عن التفضيل باسم مختلف عشان
-- الفرق يفضل مقروء في أي استعلام جاي.

ALTER TABLE orders
  ADD COLUMN revisit_pinned_technician_id UUID NULL REFERENCES technician_profiles(id),
  ADD COLUMN revisit_pinned_at            TIMESTAMPTZ NULL,
  ADD COLUMN revisit_released_at          TIMESTAMPTZ NULL,
  ADD COLUMN revisit_release_reason       VARCHAR(24) NULL;

-- الأسباب الثلاثة الوحيدة المسموحة، والتحرير لازم يبقى معاه سبب والعكس (الاتنين مع بعض أو ولا واحد).
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_revisit_release_reason
    CHECK (
      (revisit_released_at IS NULL AND revisit_release_reason IS NULL)
      OR (revisit_released_at IS NOT NULL
          AND revisit_release_reason IN ('refused', 'no_response', 'admin'))
    );

-- الـsweeper بيدوّر بس على إعادات زيارة مثبّتة لسه متحرّرتش — فهرس جزئي ضيق جداً بدل مسح كامل.
CREATE INDEX idx_orders_revisit_pinned_active
  ON orders (revisit_pinned_at)
  WHERE revisit_pinned_technician_id IS NOT NULL
    AND revisit_released_at IS NULL
    AND deleted_at IS NULL;

COMMENT ON COLUMN orders.revisit_pinned_technician_id IS
  'ADR-0051: الفني الأصلي اللي إعادة الزيارة مربوطة بيه حصرياً. التزام صارم مش تفضيل — مفيش fallback طول ما الطلب مثبّت ومتحرّرش.';
COMMENT ON COLUMN orders.revisit_pinned_at IS
  'ADR-0051: بداية عدّاد مهلة رد الفني الأصلي (revisit.original_technician_response_hours).';
COMMENT ON COLUMN orders.revisit_released_at IS
  'ADR-0051: لحظة تحرير الأدمن للطلب للتوزيع العام. حارس الخصم — التحرير (والخصم معاه) مرة واحدة بس.';

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('revisit.original_technician_response_hours', '48', 'number', 'orders',
   'مهلة رد الفني الأصلي على إعادة زيارة مثبّتة عليه (بالساعات). بعدها بتظهر عند الأدمن كبند محتاج تصرّف — التحرير قرار أدمن مش تلقائي لأن وراه خصم مالي.', false)
ON CONFLICT (key) DO NOTHING;

-- صلاحية أدمن مخصوصة لتحرير إعادة زيارة مثبّتة — القرار ده بيخصم فلوس من فني حقيقي، فنفس مستوى
-- حساسية orders.resolve_failed_visit بالظبط (مُدرجة في MFA_REQUIRED_PERMISSIONS بالكود كمان).
INSERT INTO permissions (name, resource, action) VALUES
  ('orders.release_revisit', 'orders', 'release_revisit')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'orders.release_revisit'
WHERE r.name IN ('super_admin', 'ops_manager')
ON CONFLICT DO NOTHING;
