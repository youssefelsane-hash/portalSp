-- baytak — 0011: النظام والحوكمة
-- مرجع: docs/02-data-dictionary.md §11

CREATE TABLE audit_logs (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_user_id     UUID          NULL REFERENCES users(id),
  actor_role        VARCHAR(40)   NULL,
  actor_ip          INET          NULL,
  action            VARCHAR(80)   NOT NULL,   -- order.cancelled | payout.approved | user.blocked
  entity_type       VARCHAR(60)   NOT NULL,
  entity_id         UUID          NOT NULL,
  old_values        JSONB         NULL,
  new_values        JSONB         NULL,
  user_agent        TEXT          NULL,
  request_id        VARCHAR(60)   NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
-- سجل تدقيق — ممنوع أي تعديل أو حذف عليه
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;

CREATE TABLE settings (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  key                   VARCHAR(80)   NOT NULL UNIQUE,
  value                 JSONB         NOT NULL,
  value_type            VARCHAR(20)   NOT NULL,
  group_name            VARCHAR(40)   NOT NULL,   -- pricing | matching | notifications | limits
  description           TEXT          NULL,
  is_public             BOOLEAN       NOT NULL DEFAULT false,
  updated_by_user_id    UUID          NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE webhook_events (
  id                    UUID                        PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider              VARCHAR(40)                 NOT NULL,
  event_type            VARCHAR(80)                 NOT NULL,
  external_event_id     VARCHAR(120)                NOT NULL UNIQUE,
  payload               JSONB                       NOT NULL,
  signature_valid       BOOLEAN                     NOT NULL,
  processing_status     webhook_processing_status   NOT NULL DEFAULT 'received',
  processed_at          TIMESTAMPTZ                 NULL,
  error_message         TEXT                        NULL,
  retry_count           SMALLINT                    NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ                 NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_events_provider ON webhook_events(provider, processing_status);

CREATE TABLE feature_flags (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  key                     VARCHAR(60)   NOT NULL UNIQUE,
  is_enabled              BOOLEAN       NOT NULL DEFAULT false,
  rollout_percentage      SMALLINT      NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
  enabled_for_user_ids    UUID[]        NULL,
  enabled_for_zone_ids    UUID[]        NULL,
  description             TEXT          NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- الإعدادات الأساسية (§11.2 في القاموس)
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.radius_km_initial',          '5',    'number', 'matching',      'نطاق البحث الأول عن فني بالكيلومتر', false),
  ('matching.radius_km_max',              '15',   'number', 'matching',      'أقصى نطاق بحث', false),
  ('matching.batch_size',                 '5',    'number', 'matching',      'عدد الفنيين في كل دفعة توزيع', false),
  ('matching.response_timeout_seconds',   '30',   'number', 'matching',      'مهلة رد الفني على الطلب', false),
  ('matching.max_rounds',                 '4',    'number', 'matching',      'أقصى عدد دفعات توزيع', false),
  ('orders.auto_cancel_after_minutes',    '20',   'number', 'limits',        'إلغاء تلقائي لو مفيش فني قبل', false),
  ('orders.cancellation_free_window_min', '5',    'number', 'limits',        'مهلة الإلغاء المجاني بالدقايق', true),
  ('pricing.default_commission_percent',  '15',   'number', 'pricing',       'نسبة العمولة الافتراضية', false),
  ('payouts.min_amount_cents',            '20000','number', 'limits',        'أقل مبلغ صرف مسموح', false),
  ('payouts.auto_approve_limit_cents',    '100000','number','limits',        'أقصى مبلغ صرف بدون مراجعة بشرية', false),
  ('otp.expiry_minutes',                  '5',    'number', 'limits',        'صلاحية كود الـ OTP', false),
  ('warranty.default_days',               '14',   'number', 'pricing',       'مدة الضمان الافتراضية', true);
