-- baytak — 0013: المرحلة 4 — الشركات B2B (تصميم مبدئي، مش هيتفعل قبل بوابة P3)
-- مرجع: docs/02-data-dictionary.md §12 (المرحلة 4)

CREATE TABLE corporate_accounts (
  id                          UUID                        PRIMARY KEY DEFAULT uuid_generate_v7(),
  company_name                VARCHAR(160)                NOT NULL,
  commercial_register         VARCHAR(60)                 NULL,
  tax_id                      VARCHAR(60)                 NULL,
  account_type                corporate_account_type      NOT NULL,
  primary_contact_user_id     UUID                        NOT NULL REFERENCES users(id),
  billing_address_id          UUID                        NOT NULL REFERENCES addresses(id),
  contract_start_date         DATE                        NULL,
  contract_end_date           DATE                        NULL,
  credit_limit_cents          INTEGER                     NOT NULL DEFAULT 0,
  current_balance_cents       INTEGER                     NOT NULL DEFAULT 0,
  payment_terms_days          SMALLINT                    NOT NULL DEFAULT 30,
  discount_percentage         NUMERIC(5,2)                NOT NULL DEFAULT 0,
  sla_response_minutes        SMALLINT                    NULL,
  account_status              corporate_account_status    NOT NULL DEFAULT 'active',
  created_at                  TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ                 NULL
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON corporate_accounts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE corporate_users (
  id                        UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  corporate_account_id      UUID              NOT NULL REFERENCES corporate_accounts(id),
  user_id                   UUID              NOT NULL REFERENCES users(id),
  corporate_role            corporate_role    NOT NULL,
  department                VARCHAR(80)       NULL,
  monthly_budget_cents      INTEGER           NULL,
  requires_approval         BOOLEAN           NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ       NOT NULL DEFAULT now(),
  UNIQUE (corporate_account_id, user_id)
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON corporate_users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE corporate_properties (
  id                      UUID                      PRIMARY KEY DEFAULT uuid_generate_v7(),
  corporate_account_id    UUID                      NOT NULL REFERENCES corporate_accounts(id),
  property_name           VARCHAR(160)              NOT NULL,
  address_id              UUID                      NOT NULL REFERENCES addresses(id),
  units_count             INTEGER                   NULL,
  property_type           corporate_property_type   NOT NULL,
  created_at               TIMESTAMPTZ              NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ              NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ              NULL
);
CREATE INDEX idx_corporate_properties_account_id ON corporate_properties(corporate_account_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON corporate_properties
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE corporate_invoices (
  id                      UUID                      PRIMARY KEY DEFAULT uuid_generate_v7(),
  invoice_number          VARCHAR(24)               NOT NULL UNIQUE,
  corporate_account_id    UUID                      NOT NULL REFERENCES corporate_accounts(id),
  period_start            DATE                      NOT NULL,
  period_end              DATE                      NOT NULL,
  orders_count            INTEGER                   NOT NULL DEFAULT 0,
  subtotal_cents          INTEGER                   NOT NULL DEFAULT 0,
  tax_cents               INTEGER                   NOT NULL DEFAULT 0,
  total_cents             INTEGER                   NOT NULL DEFAULT 0,
  invoice_status          corporate_invoice_status  NOT NULL DEFAULT 'draft',
  due_date                DATE                      NULL,
  paid_at                 TIMESTAMPTZ               NULL,
  created_at              TIMESTAMPTZ               NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ               NOT NULL DEFAULT now()
);
CREATE INDEX idx_corporate_invoices_account_id ON corporate_invoices(corporate_account_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON corporate_invoices
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
