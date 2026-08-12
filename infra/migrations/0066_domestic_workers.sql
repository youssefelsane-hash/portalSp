-- baytak (صُنّاع) — 0066: قطاع الخدمات المنزلية (docs/08 §12، ADR-0004)
-- كيان مستقل بالكامل عن technicians/orders — القرار الكامل وأسبابه في
-- docs/adr/0004-domestic-workers-vertical.md.

-- قيمة جديدة فوق user_type الموجود — مش إعادة استخدام 'technician' (هيخلط مع فنيي الصيانة في
-- @Roles(TECHNICIAN) guards) ولا 'partner' (موثّقة في docs/02-data-dictionary.md لـ laundry_partners،
-- مفهوم تاني).
ALTER TYPE user_type ADD VALUE 'domestic_worker';
-- محفظة الشغالة/المربية نوعها الخاص — مش 'technician' (تصنيف مختلف) ولا 'partner' (laundry_partners،
-- مفهوم تاني موثّق في docs/02-data-dictionary.md).
ALTER TYPE wallet_owner_type ADD VALUE 'domestic_worker';

CREATE TYPE domestic_worker_specialty AS ENUM ('cleaning_hourly', 'babysitting_hourly', 'live_in_maid_monthly');
CREATE TYPE domestic_worker_verification_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE domestic_worker_booking_type AS ENUM ('hourly', 'monthly_live_in');
CREATE TYPE domestic_worker_booking_status AS ENUM (
  'pending_confirmation', 'confirmed', 'active', 'completed', 'cancelled'
);

CREATE TABLE domestic_worker_profiles (
  id                        UUID                                   PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id                   UUID                                   NOT NULL UNIQUE REFERENCES users(id),
  worker_code               VARCHAR(20)                            NOT NULL UNIQUE,   -- DW-2026-000001
  bio                       TEXT                                   NULL,
  years_of_experience       SMALLINT                               NOT NULL DEFAULT 0,
  specialties                domestic_worker_specialty[]           NOT NULL DEFAULT '{}',
  hourly_rate_cents         INTEGER                                NULL,   -- لازم موجود لو عندها specialty بالساعة
  monthly_rate_cents        INTEGER                                NULL,   -- لازم موجود لو عندها live_in_maid_monthly
  verification_status       domestic_worker_verification_status    NOT NULL DEFAULT 'pending',
  verification_notes        TEXT                                   NULL,
  approved_at                TIMESTAMPTZ                           NULL,
  approved_by_user_id       UUID                                   NULL REFERENCES users(id),
  is_available               BOOLEAN                                NOT NULL DEFAULT true,
  current_location           GEOGRAPHY(POINT)                      NULL,
  average_rating             NUMERIC(3,2)                          NOT NULL DEFAULT 0,
  total_ratings_count        INTEGER                                NOT NULL DEFAULT 0,
  completed_bookings_count   INTEGER                                NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ                           NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ                           NOT NULL DEFAULT now(),
  deleted_at                 TIMESTAMPTZ                           NULL
);
CREATE INDEX idx_domestic_worker_profiles_verification_status ON domestic_worker_profiles(verification_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_domestic_worker_profiles_current_location ON domestic_worker_profiles USING GIST(current_location);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON domestic_worker_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE domestic_worker_bookings (
  id                       UUID                              PRIMARY KEY DEFAULT uuid_generate_v7(),
  booking_number           VARCHAR(24)                       NOT NULL UNIQUE,   -- DWB-2026-000001
  customer_id              UUID                              NOT NULL REFERENCES customer_profiles(id),
  worker_id                UUID                              NOT NULL REFERENCES domestic_worker_profiles(id),
  address_id               UUID                              NOT NULL REFERENCES addresses(id),
  specialty                domestic_worker_specialty         NOT NULL,
  booking_type             domestic_worker_booking_type      NOT NULL,
  scheduled_at             TIMESTAMPTZ                       NOT NULL,   -- بالساعة: وقت الزيارة. شهري: تاريخ بدء العقد.
  duration_hours           SMALLINT                          NULL,       -- لازم موجود لو booking_type='hourly'
  auto_renew               BOOLEAN                           NOT NULL DEFAULT false,   -- معنى بس لو booking_type='monthly_live_in'
  current_period_end_at    TIMESTAMPTZ                       NULL,       -- شهري بس — الفحص الدوري بيقارن بيه للتجديد
  price_cents              INTEGER                           NOT NULL,   -- محسوبة وقت التأكيد (ساعة×سعر أو السعر الشهري الثابت)
  status                   domestic_worker_booking_status    NOT NULL DEFAULT 'pending_confirmation',
  customer_notes           TEXT                              NULL,
  confirmed_at             TIMESTAMPTZ                       NULL,
  completed_at             TIMESTAMPTZ                       NULL,
  cancelled_at             TIMESTAMPTZ                       NULL,
  cancellation_reason      TEXT                              NULL,
  created_at               TIMESTAMPTZ                       NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ                       NOT NULL DEFAULT now()
);
CREATE INDEX idx_domestic_worker_bookings_customer_id ON domestic_worker_bookings(customer_id);
CREATE INDEX idx_domestic_worker_bookings_worker_id ON domestic_worker_bookings(worker_id);
CREATE INDEX idx_domestic_worker_bookings_renewal_due
  ON domestic_worker_bookings(current_period_end_at)
  WHERE status = 'active' AND booking_type = 'monthly_live_in' AND auto_renew = true;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON domestic_worker_bookings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- عمولة منصة منفصلة (docs/08 §12) — نفس فلسفة commission.emergency_adjustment_percentage
-- (migration 0052): قيمة افتراضية معقولة قابلة للتعديل الفوري من /admin/settings، مش نهائية.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('commission.domestic_worker_percentage', '15', 'number', 'commission', 'عمولة المنصة من حجوزات الخدمات المنزلية (شغالة/مربية/مقيمة) — قيمة افتراضية تجريبية مش نهائية', false);
