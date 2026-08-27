-- baytak — 0203: ملاحظات داخلية على الطلب لمركز الاتصال (docs/08 §73 بند 3، بلاغ مالك صريح:
-- "ملاحظات داخلية للكول سنتر لا يراها العميل أو الفني"). نفس نمط complaint_messages'
-- is_internal_note بالحرف، بس هنا كل الصفوف داخلية بتعريفها — مفيش رسائل عادية على الطلب نفسه،
-- التواصل الفعلي بيحصل عبر chat_threads الموجود. جدول مستقل بسيط، مش عمود إضافي على orders.

CREATE TABLE order_internal_notes (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id        uuid NOT NULL REFERENCES orders(id),
  author_user_id  uuid NOT NULL REFERENCES users(id),
  note            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_internal_notes_order_id ON order_internal_notes(order_id);
