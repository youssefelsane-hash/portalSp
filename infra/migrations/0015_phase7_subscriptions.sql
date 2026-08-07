-- baytak — 0015: المرحلة 7 — الاشتراكات (تصميم مبدئي)
-- مرجع: docs/02-data-dictionary.md §12 (المرحلة 7)

CREATE TABLE subscription_plans (
  id                            UUID                    PRIMARY KEY DEFAULT uuid_generate_v7(),
  name_ar                       VARCHAR(120)            NOT NULL,
  plan_type                     subscription_plan_type  NOT NULL,
  billing_cycle                 billing_cycle           NOT NULL,
  price_cents                   INTEGER                 NOT NULL,
  free_inspections_count        SMALLINT                NOT NULL DEFAULT 0,
  discount_percentage           NUMERIC(5,2)            NOT NULL DEFAULT 0,
  priority_matching             BOOLEAN                 NOT NULL DEFAULT false,
  extended_warranty_days        SMALLINT                NOT NULL DEFAULT 0,
  included_services             JSONB                   NOT NULL DEFAULT '[]',
  is_active                     BOOLEAN                 NOT NULL DEFAULT true,
  created_at                    TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ             NOT NULL DEFAULT now(),
  deleted_at                    TIMESTAMPTZ             NULL
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON subscription_plans
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE subscriptions (
  id                            UUID                  PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id                       UUID                  NOT NULL REFERENCES users(id),
  plan_id                       UUID                  NOT NULL REFERENCES subscription_plans(id),
  subscription_status           subscription_status   NOT NULL DEFAULT 'active',
  started_at                    TIMESTAMPTZ           NOT NULL DEFAULT now(),
  current_period_start          TIMESTAMPTZ           NOT NULL,
  current_period_end            TIMESTAMPTZ           NOT NULL,
  auto_renew                    BOOLEAN               NOT NULL DEFAULT true,
  cancelled_at                  TIMESTAMPTZ           NULL,
  cancellation_reason           TEXT                  NULL,
  remaining_free_inspections    SMALLINT              NOT NULL DEFAULT 0,
  total_saved_cents             INTEGER               NOT NULL DEFAULT 0,
  created_at                    TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ           NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(subscription_status);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
