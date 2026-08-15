-- baytak — 0112: طابور موافقة أرباح العمالة المنزلية (docs/08 §25.1) — قرار مالك صريح 2026-08-15:
-- أرباح الشغالة/العامل مينفعش تتحول تلقائي لرصيد قابل للصرف بمجرد قبول الحجز ولا قبل تنفيذ
-- الخدمة. تدخل "معلّقة" بعد الاكتمال، ومتترجعش رصيد فعلي إلا بموافقة أدمن/موظف مخوّل — الموافقة
-- مفروضة من الباك-إند نفسه (مش زرار واجهة بس)، الموافقة/الرفض المزدوج ممنوع بفحص حالة صريح، وأثر
-- تدقيق كامل (مين وافق، إمتى، وعلى كام) — نفس نمط payouts.adminApprove() بالحرف.

CREATE TYPE domestic_worker_earning_approval_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE domestic_worker_earning_approvals (
  id                    UUID                                      PRIMARY KEY DEFAULT uuid_generate_v7(),
  booking_id            UUID                                      NOT NULL REFERENCES domestic_worker_bookings(id),
  worker_user_id        UUID                                      NOT NULL REFERENCES users(id),
  amount_cents          INTEGER                                   NOT NULL CHECK (amount_cents > 0),
  status                domestic_worker_earning_approval_status   NOT NULL DEFAULT 'pending',
  reviewed_by_user_id   UUID                                      NULL REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ                               NULL,
  rejection_reason      TEXT                                      NULL,
  created_at            TIMESTAMPTZ                               NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ                               NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ                               NULL
);
CREATE INDEX idx_dw_earning_approvals_booking_id ON domestic_worker_earning_approvals(booking_id);
CREATE INDEX idx_dw_earning_approvals_worker_user_id ON domestic_worker_earning_approvals(worker_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_dw_earning_approvals_status ON domestic_worker_earning_approvals(status) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON domestic_worker_earning_approvals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO permissions (name, resource, action) VALUES
  ('domestic_workers.approve_earnings', 'domestic_workers', 'approve_earnings');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'domestic_workers.approve_earnings'
WHERE r.name = 'finance';
