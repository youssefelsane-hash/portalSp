-- Script 5 (SONNA3_Admin_Workforce_Security_Operations.md) Part 5/18/19 — نموذج Security Event
-- المركزي. تفاصيل القرار المعماري الكامل في docs/adr/0016-security-events-and-employee-activity.md.
-- audit_logs (0011) فاضل immutable بتصميمه (REVOKE UPDATE/DELETE) — الـlifecycle هنا (open→
-- acknowledged→...) يحتاج UPDATE بطبيعته، فده جدول منفصل مش تعديل على audit_logs.

CREATE TYPE security_event_type AS ENUM (
  'privilege_escalation_attempt',
  'unauthorized_role_change',
  'unauthorized_permission_grant',
  'repeated_permission_denial',
  'mfa_failure_burst',
  'sensitive_action_denied',
  'session_reuse_after_revoke',
  'blocked_account_access_attempt',
  'security_setting_change'
);

CREATE TYPE security_event_severity AS ENUM ('info', 'warning', 'high', 'critical');

CREATE TYPE security_event_status AS ENUM ('open', 'acknowledged', 'investigating', 'resolved', 'false_positive');

CREATE TABLE security_events (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_type             security_event_type NOT NULL,
  severity               security_event_severity NOT NULL,
  status                 security_event_status NOT NULL DEFAULT 'open',
  actor_user_id          UUID NULL REFERENCES users(id),
  actor_role             VARCHAR(60) NULL,
  target_user_id         UUID NULL REFERENCES users(id),
  target_type            VARCHAR(60) NULL,
  target_id              UUID NULL,
  session_id             UUID NULL REFERENCES refresh_tokens(id),
  ip_address              INET NULL,
  action                 VARCHAR(80) NULL,
  -- بلا أسرار/توكنات — قيمة صغيرة توضيحية بس (زي {"attempted_role": "super_admin"})، مذكور صراحة
  -- في السكريبت ("Do not store secrets or raw authorization tokens").
  attempted_value        JSONB NULL,
  occurrence_count       INTEGER NOT NULL DEFAULT 1,
  first_occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by_user_id UUID NULL REFERENCES users(id),
  acknowledged_at        TIMESTAMPTZ NULL,
  resolved_by_user_id    UUID NULL REFERENCES users(id),
  resolved_at            TIMESTAMPTZ NULL,
  resolution_note        TEXT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- تجميع/dedup (Part 5 §13) — البحث عن حدث مفتوح مطابق جوّه نافذة زمنية عشان نزوّد occurrence_count
-- بدل صف جديد. Part 21 index review: actor+type+action+status هو نمط البحث الفعلي في recordDenial().
CREATE INDEX idx_security_events_dedup_lookup
  ON security_events (actor_user_id, event_type, action, status, last_occurred_at DESC);

-- Security Center: فلترة بـseverity/status (Part 11 §22-23)، وبـactor للـEmployee Security tab.
CREATE INDEX idx_security_events_severity_status ON security_events (severity, status, created_at DESC);
CREATE INDEX idx_security_events_target_user ON security_events (target_user_id) WHERE target_user_id IS NOT NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON security_events
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ملاحظات تحقيق يدوية (Part 18) — append-only، صفر UPDATE/DELETE مسموح في الكود (نفس فلسفة
-- audit_logs، بس هنا مفيش داعي قيد REVOKE على مستوى القاعدة لأن التطبيق مش هيعرض تعديل/حذف أصلاً).
CREATE TABLE security_event_notes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  security_event_id UUID NOT NULL REFERENCES security_events(id),
  author_user_id    UUID NOT NULL REFERENCES users(id),
  note              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_security_event_notes_event ON security_event_notes (security_event_id, created_at);
