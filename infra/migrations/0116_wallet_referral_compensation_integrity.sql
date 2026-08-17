-- baytak - 0116: Phase 4 financial integrity for wallet adjustments and referral rewards.

CREATE TABLE wallet_adjustments (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_user_id         UUID        NOT NULL REFERENCES users(id),
  target_user_id        UUID        NOT NULL REFERENCES users(id),
  target_wallet_id      UUID        NOT NULL REFERENCES wallets(id),
  idempotency_key       VARCHAR(120) NOT NULL,
  amount_cents          INTEGER     NOT NULL CHECK (amount_cents > 0),
  direction             VARCHAR(10) NOT NULL CHECK (direction IN ('credit', 'debit')),
  reason_ar             TEXT        NOT NULL,
  wallet_debit_tx_id    UUID        NULL REFERENCES wallet_transactions(id),
  wallet_credit_tx_id   UUID        NULL REFERENCES wallet_transactions(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id, idempotency_key),
  CHECK (
    (wallet_debit_tx_id IS NULL AND wallet_credit_tx_id IS NULL)
    OR
    (wallet_debit_tx_id IS NOT NULL AND wallet_credit_tx_id IS NOT NULL)
  )
);
CREATE INDEX idx_wallet_adjustments_target ON wallet_adjustments(target_wallet_id, created_at DESC);

CREATE TABLE referral_rewards (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  referrer_user_id      UUID        NOT NULL REFERENCES users(id),
  milestone_count       INTEGER     NOT NULL CHECK (milestone_count > 0),
  promo_code_id         UUID        NOT NULL UNIQUE REFERENCES promo_codes(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referrer_user_id, milestone_count)
);
CREATE INDEX idx_referral_rewards_referrer ON referral_rewards(referrer_user_id, milestone_count);

-- Existing referral promo codes predate an explicit source table. Backfill only rows whose
-- generated Arabic name retains both the reward number and required-referral count. Rows that
-- cannot be proven are intentionally left for manual reconciliation rather than guessed.
INSERT INTO referral_rewards (referrer_user_id, milestone_count, promo_code_id)
SELECT
  p.restricted_to_user_id,
  (substring(p.name_ar FROM '#([0-9]+)'))::INTEGER
    * (substring(p.name_ar FROM '([0-9]+) ترشيحات'))::INTEGER,
  p.id
FROM promo_codes p
WHERE p.restricted_to_user_id IS NOT NULL
  AND p.name_ar LIKE 'مكافأة ترشيح #%'
  AND substring(p.name_ar FROM '#([0-9]+)') IS NOT NULL
  AND substring(p.name_ar FROM '([0-9]+) ترشيحات') IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO settings (key, value, value_type, group_name, description, is_public)
VALUES (
  'referral.recovery_batch_size',
  '25',
  'number',
  'referral',
  'أقصى عدد إحالات معلقة يفحصها مسار الاسترداد في الدورة الواحدة',
  false
)
ON CONFLICT (key) DO NOTHING;
