-- baytak — 0060: توزيع أدوار الفريق داخل الطلب الواحد (docs/08 §5)
-- كانت فجوة موثّقة صراحة: orders.technician_id فرد واحد بس حتى لو الطلب booking_mode='team'
-- (الفني اللي المطابقة اختارته من الشركة/الفريق) — مفيش أي تسجيل لباقي أفراد الفريق اللي
-- فعليًا هيشتغلوا في نفس الطلب. الجدول ده إضافي بحت فوق orders.technician_id (اللي فاضل هو
-- "قائد الطلب"/المسؤول الأساسي، من غير أي تغيير) — مش بديل له.
CREATE TABLE order_team_members (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                UUID          NOT NULL REFERENCES orders(id),
  technician_id           UUID          NOT NULL REFERENCES technician_profiles(id),
  -- وصف حر لدور العضو في الطلب ده تحديدًا (مثلاً: "سباك مساعد"، "حامل عدة") — مش enum مقفول
  -- عشان الأدوار الفعلية بتختلف حسب الصنعة والطلب، ومفيش قايمة أدوار موحّدة في القاموس.
  role_label              VARCHAR(100)  NOT NULL,
  added_by_technician_id  UUID          NOT NULL REFERENCES technician_profiles(id),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (order_id, technician_id)
);
CREATE INDEX idx_order_team_members_order_id ON order_team_members(order_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON order_team_members
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
