-- baytak (صُنّاع) — 0064: الجدولة المستقبلية/المتكررة (docs/08 §11)
-- order_type='recurring' كان قيمة enum موجودة من الأول (migration 0002) بس بلا أي آلية حقيقية
-- توليد طلبات متكررة — مجرد تصنيف يدوي ممكن حد يحطه على طلب واحد عادي، مش نظام تكرار فعلي.
-- الجدول ده هو التخطيط الفعلي: قالب متكرر بيولّد طلب حقيقي جديد (order_type=recurring) في كل
-- موعد مستحق، عبر فحص دوري (نفس فلسفة order_auto_cancel_service.ts بالحرف — مش BullMQ repeatable
-- job، عشان الـ Worker recovery bug الموثّق في technicians/README.md).
CREATE TYPE recurring_order_frequency AS ENUM ('weekly', 'monthly', 'yearly');

CREATE TABLE recurring_order_templates (
  id                        UUID                        PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_id               UUID                        NOT NULL REFERENCES customer_profiles(id),
  service_id                UUID                        NOT NULL REFERENCES services(id),
  address_id                UUID                        NOT NULL REFERENCES addresses(id),
  booking_mode              booking_mode                NOT NULL DEFAULT 'individual',
  -- تفضيل نفس الفني في كل مرة — تفضيل بس زي requested_technician_id العادي في orders، مش ضمان.
  -- لو مش متاح وقت التوليد، الطلب المولّد بيرجع للتوزيع العادي زي أي طلب تاني بالظبط.
  requested_technician_id   UUID                        NULL REFERENCES technician_profiles(id),
  frequency                 recurring_order_frequency  NOT NULL,
  problem_description       TEXT                        NULL,
  next_run_at                TIMESTAMPTZ                NOT NULL,
  last_generated_order_id   UUID                        NULL REFERENCES orders(id),
  is_active                 BOOLEAN                     NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ                 NULL
);
CREATE INDEX idx_recurring_order_templates_customer_id ON recurring_order_templates(customer_id);
CREATE INDEX idx_recurring_order_templates_due ON recurring_order_templates(next_run_at) WHERE is_active = true;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON recurring_order_templates
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
