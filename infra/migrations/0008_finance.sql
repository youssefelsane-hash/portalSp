-- baytak — 0008: المال
-- مرجع: docs/02-data-dictionary.md §7
-- قاعدة حاكمة: wallet_transactions لا يُحذف ولا يُعدّل أبداً — الغلط يتصحح بقيد عكسي جديد.

CREATE TABLE wallets (
  id                        UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  owner_user_id             UUID                NOT NULL UNIQUE REFERENCES users(id),
  owner_type                wallet_owner_type   NOT NULL,
  balance_cents             INTEGER             NOT NULL DEFAULT 0,
  pending_balance_cents     INTEGER             NOT NULL DEFAULT 0,
  reserved_balance_cents    INTEGER             NOT NULL DEFAULT 0,
  total_earned_cents        INTEGER             NOT NULL DEFAULT 0,
  total_withdrawn_cents     INTEGER             NOT NULL DEFAULT 0,
  currency_code             VARCHAR(3)          NOT NULL DEFAULT 'EGP',
  is_frozen                 BOOLEAN             NOT NULL DEFAULT false,
  frozen_reason             TEXT                NULL,
  created_at                TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ         NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ         NULL
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE wallet_transactions (
  id                        UUID                  PRIMARY KEY DEFAULT uuid_generate_v7(),
  wallet_id                 UUID                  NOT NULL REFERENCES wallets(id),
  transaction_number        VARCHAR(24)           NOT NULL UNIQUE,   -- TXN-2026-000123
  direction                 wallet_tx_direction   NOT NULL,
  transaction_type          wallet_tx_type        NOT NULL,
  amount_cents              INTEGER               NOT NULL CHECK (amount_cents > 0),
  balance_before_cents      INTEGER               NOT NULL,
  balance_after_cents       INTEGER               NOT NULL,
  reference_type            VARCHAR(40)           NULL,
  reference_id               UUID                 NULL,
  description_ar            VARCHAR(255)          NULL,
  performed_by_user_id      UUID                  NULL REFERENCES users(id),
  is_reversed                BOOLEAN              NOT NULL DEFAULT false,
  reversal_transaction_id   UUID                  NULL REFERENCES wallet_transactions(id),
  created_at                TIMESTAMPTZ           NOT NULL DEFAULT now()
);
CREATE INDEX idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_transactions_reference ON wallet_transactions(reference_type, reference_id);
-- ممنوع أي UPDATE أو DELETE على القيود المالية — التصحيح بقيد عكسي جديد بس
REVOKE UPDATE, DELETE ON wallet_transactions FROM PUBLIC;

CREATE TABLE payments (
  id                        UUID                    PRIMARY KEY DEFAULT uuid_generate_v7(),
  payment_number            VARCHAR(24)             NOT NULL UNIQUE,   -- PAY-2026-000123
  order_id                  UUID                    NOT NULL REFERENCES orders(id),
  customer_id               UUID                    NOT NULL REFERENCES customer_profiles(id),
  amount_cents              INTEGER                 NOT NULL,
  currency_code             VARCHAR(3)              NOT NULL DEFAULT 'EGP',
  payment_method            payment_method          NOT NULL,
  payment_gateway           VARCHAR(40)             NULL,   -- paymob | fawry | manual
  gateway_transaction_id    VARCHAR(120)            NULL,
  gateway_reference         VARCHAR(120)            NULL,
  gateway_response          JSONB                   NULL,   -- بدون أي بيانات كارت أبداً
  card_last_four            VARCHAR(4)              NULL,
  card_brand                VARCHAR(20)             NULL,
  payment_status            payment_gateway_status  NOT NULL DEFAULT 'pending',
  failure_code              VARCHAR(60)             NULL,
  failure_message           TEXT                    NULL,
  idempotency_key           VARCHAR(80)             NOT NULL UNIQUE,
  initiated_at              TIMESTAMPTZ             NOT NULL DEFAULT now(),
  completed_at              TIMESTAMPTZ             NULL,
  failed_at                 TIMESTAMPTZ             NULL,
  collected_by_user_id      UUID                    NULL REFERENCES users(id)
);
CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_customer_id ON payments(customer_id);
CREATE INDEX idx_payments_status ON payments(payment_status);

CREATE TABLE refunds (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  refund_number           VARCHAR(24)   NOT NULL UNIQUE,
  payment_id              UUID          NOT NULL REFERENCES payments(id),
  order_id                UUID          NOT NULL REFERENCES orders(id),
  amount_cents            INTEGER       NOT NULL,
  refund_type             refund_type   NOT NULL,
  refund_reason_code      VARCHAR(60)   NULL,
  reason_notes            TEXT          NULL,
  refund_method           refund_method NOT NULL,
  refund_status           refund_status NOT NULL DEFAULT 'pending',
  gateway_refund_id       VARCHAR(120)  NULL,
  requested_by_user_id    UUID          NOT NULL REFERENCES users(id),
  approved_by_user_id     UUID          NULL REFERENCES users(id),
  requested_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  approved_at             TIMESTAMPTZ   NULL,
  completed_at            TIMESTAMPTZ   NULL
);
CREATE INDEX idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX idx_refunds_order_id ON refunds(order_id);

CREATE TABLE payouts (
  id                      UUID            PRIMARY KEY DEFAULT uuid_generate_v7(),
  payout_number           VARCHAR(24)     NOT NULL UNIQUE,
  technician_id           UUID            NOT NULL REFERENCES technician_profiles(id),
  wallet_id               UUID            NOT NULL REFERENCES wallets(id),
  amount_cents            INTEGER         NOT NULL,
  fee_cents               INTEGER         NOT NULL DEFAULT 0,
  net_amount_cents        INTEGER         NOT NULL,
  payout_method           payout_method   NOT NULL,
  destination_masked      VARCHAR(40)     NULL,   -- ****1234
  payout_status           payout_status   NOT NULL DEFAULT 'requested',
  period_start_date       DATE            NULL,
  period_end_date         DATE            NULL,
  orders_count            INTEGER         NOT NULL DEFAULT 0,
  requested_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
  reviewed_at              TIMESTAMPTZ    NULL,
  completed_at            TIMESTAMPTZ     NULL,
  reviewed_by_user_id     UUID            NULL REFERENCES users(id),
  rejection_reason        TEXT            NULL,
  external_reference      VARCHAR(120)    NULL
);
CREATE INDEX idx_payouts_technician_id ON payouts(technician_id);
CREATE INDEX idx_payouts_status ON payouts(payout_status);

CREATE TABLE payout_order_items (
  id                UUID    PRIMARY KEY DEFAULT uuid_generate_v7(),
  payout_id         UUID    NOT NULL REFERENCES payouts(id),
  order_id          UUID    NOT NULL REFERENCES orders(id),
  earning_cents     INTEGER NOT NULL,
  commission_cents  INTEGER NOT NULL,
  UNIQUE (payout_id, order_id)
);
CREATE INDEX idx_payout_order_items_payout_id ON payout_order_items(payout_id);
