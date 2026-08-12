-- baytak (صُنّاع) — 0058: جدولة الفني الحقيقية (Scheduler)
-- راجع docs/08-pricing-engine-and-platform-vision.md §2 وdocs/adr/0002-technician-scheduler.md
-- للقرار المعماري الكامل. خلاصة القرار: سلوتات كصفوف منفصلة صريحة (مش نمط تكراري) — كل سلوت
-- تاريخ + وقت بداية/نهاية + حالة، الحجز بتحديث الصف نفسه بقفل ذرّي.

CREATE TYPE technician_schedule_slot_status AS ENUM ('available', 'booked', 'blocked');

CREATE TABLE technician_schedule_slots (
  id             UUID                              PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id  UUID                              NOT NULL REFERENCES technician_profiles(id),
  slot_date      DATE                              NOT NULL,
  start_time     TIME                              NOT NULL,
  end_time       TIME                              NOT NULL,
  status         technician_schedule_slot_status   NOT NULL DEFAULT 'available',
  -- 'blocked' = إجازة/غير متاح بقرار الفني نفسه (مش بسبب حجز) — order_id يفضل NULL في الحالة دي.
  -- 'booked' = مرتبط بطلب فعلي، order_id لازم يكون موجود.
  order_id       UUID                              NULL REFERENCES orders(id),
  notes_ar       VARCHAR(200)                      NULL,
  created_at     TIMESTAMPTZ                       NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ                       NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ                       NULL,
  CHECK (end_time > start_time)
);

-- منع تداخل سلوتين للفني نفسه في نفس التاريخ — فحص بسيط (بداية سلوت ما تقعش جوّه سلوت تاني
-- لنفس الفني بنفس التاريخ) بيتم على مستوى الكود (TechnicianScheduleService) وقت الإنشاء، مش
-- constraint قاعدة بيانات (PostgreSQL مالوش EXCLUDE constraint بسيط على range زمني من غير
-- امتداد btree_gist، وتجنّبنا امتداد جديد لسلوت أول نسخة). الفهرس تحت بس للأداء، مش لمنع التداخل.
CREATE INDEX idx_technician_schedule_slots_lookup
  ON technician_schedule_slots(technician_id, slot_date, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_schedule_slots_order_id
  ON technician_schedule_slots(order_id) WHERE order_id IS NOT NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_schedule_slots
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
