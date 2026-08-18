-- Script 5 Part 2/4/16 — حالة جلسة حية (ACTIVE/IDLE/OFFLINE) + وقت عمل فعلي. القرار المعماري
-- الكامل (ليه صف واحد لكل موظف/يوم بدل جدول heartbeats بلا حدود) في
-- docs/adr/0016-security-events-and-employee-activity.md §3.

-- last_seen_at الموجودة بتتحدّث بس وقت تدوير access token (~15 دقيقة) — مش heartbeat دقيق كفاية
-- لحساب idle gaps. عمود جديد منفصل، صفر تعديل على last_seen_at أو دلالتها الحالية (ADR-0011 §5).
ALTER TABLE refresh_tokens ADD COLUMN last_activity_at TIMESTAMPTZ NULL;

CREATE TABLE employee_daily_activity (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id                 UUID NOT NULL REFERENCES users(id),
  activity_date           DATE NOT NULL,
  first_login_at          TIMESTAMPTZ NULL,
  last_login_at           TIMESTAMPTZ NULL,
  last_activity_at        TIMESTAMPTZ NULL,
  last_logout_at          TIMESTAMPTZ NULL,
  active_seconds          INTEGER NOT NULL DEFAULT 0,
  sessions_count          INTEGER NOT NULL DEFAULT 0,
  actions_count           INTEGER NOT NULL DEFAULT 0,
  denied_sensitive_count  INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, activity_date)
);

-- Workforce summary (Part 2 §5) وDaily report (Part 16 §28) — دايمًا بيفلتروا بتاريخ اليوم/مدى
-- لكل الموظفين، أو بموظف واحد عبر الأيام. الفهرس المركّب (UNIQUE) فوق كافي للـupsert؛ ده إضافي
-- لاستعلامات "كل الموظفين النهاردة" (ORDER BY/WHERE activity_date بلا user_id محدد).
CREATE INDEX idx_employee_daily_activity_date ON employee_daily_activity (activity_date, user_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON employee_daily_activity
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
