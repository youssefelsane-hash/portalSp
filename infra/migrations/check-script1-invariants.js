#!/usr/bin/env node

const { Client } = require('pg');

const checks = [
  {
    name: 'wallet transaction arithmetic is valid',
    sql: `
      SELECT id
      FROM wallet_transactions
      WHERE
        (transaction_type = 'withdrawal' AND direction = 'debit' AND balance_before_cents <> balance_after_cents)
        OR
        (transaction_type <> 'withdrawal' AND direction = 'debit'
          AND balance_before_cents - balance_after_cents <> amount_cents)
        OR
        (direction = 'credit' AND balance_after_cents - balance_before_cents <> amount_cents)
      LIMIT 20
    `,
  },
  {
    name: 'wallet reserved balances are non-negative',
    sql: `SELECT id FROM wallets WHERE reserved_balance_cents < 0 LIMIT 20`,
  },
  {
    name: 'processing and completed refunds do not exceed their payment',
    sql: `
      SELECT p.id
      FROM payments p
      JOIN refunds r ON r.payment_id = p.id
        AND r.refund_status IN ('processing', 'completed')
      GROUP BY p.id, p.amount_cents
      HAVING SUM(r.amount_cents) > p.amount_cents
      LIMIT 20
    `,
  },
  {
    name: 'every completed refund has a provider or customer-wallet effect',
    sql: `
      SELECT r.id
      FROM refunds r
      WHERE r.refund_status = 'completed'
        AND (
          (r.refund_method = 'original_method' AND r.provider_refund_id IS NULL)
          OR
          (r.refund_method = 'wallet_credit' AND NOT EXISTS (
            SELECT 1
            FROM wallet_transactions wt
            JOIN wallets w ON w.id = wt.wallet_id
            WHERE wt.reference_type = 'refund'
              AND wt.reference_id = r.id
              AND wt.direction = 'credit'
              AND wt.transaction_type = 'refund'
              AND wt.amount_cents = r.amount_cents
              AND w.owner_type = 'customer'
          ))
        )
      LIMIT 20
    `,
  },
  {
    name: 'technician referral bonuses retain coherent ledger references',
    sql: `
      SELECT b.id
      FROM technician_referral_bonuses b
      LEFT JOIN wallet_transactions debit ON debit.id = b.wallet_debit_tx_id
      LEFT JOIN wallet_transactions credit ON credit.id = b.wallet_credit_tx_id
      WHERE
        (b.status = 'credited' AND (debit.id IS NULL OR credit.id IS NULL))
        OR
        (b.status = 'revoked' AND (
          debit.id IS NULL OR credit.id IS NULL
          OR debit.is_reversed = false OR credit.is_reversed = false
          OR debit.reversal_transaction_id IS NULL OR credit.reversal_transaction_id IS NULL
        ))
      LIMIT 20
    `,
  },
  {
    name: 'completed payouts have one net-amount double entry',
    sql: `
      SELECT p.id
      FROM payouts p
      WHERE p.payout_status = 'completed'
        AND (
          SELECT COUNT(*)
          FROM wallet_transactions wt
          WHERE wt.reference_type = 'payout'
            AND wt.reference_id = p.id
            AND wt.amount_cents = p.net_amount_cents
        ) <> 2
      LIMIT 20
    `,
  },
  {
    name: 'additional-work payments map to an order-item batch on the same order',
    sql: `
      SELECT p.id
      FROM payments p
      WHERE p.order_item_batch_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM order_items oi
          WHERE oi.batch_id = p.order_item_batch_id
            AND oi.order_id = p.order_id
        )
      LIMIT 20
    `,
  },
  {
    name: 'wallet adjustments retain one referenced double entry',
    sql: `
      SELECT a.id
      FROM wallet_adjustments a
      LEFT JOIN wallet_transactions debit ON debit.id = a.wallet_debit_tx_id
      LEFT JOIN wallet_transactions credit ON credit.id = a.wallet_credit_tx_id
      WHERE debit.id IS NULL OR credit.id IS NULL
        OR debit.reference_type <> 'admin_adjustment'
        OR credit.reference_type <> 'admin_adjustment'
        OR debit.reference_id <> a.id OR credit.reference_id <> a.id
        OR debit.amount_cents <> a.amount_cents OR credit.amount_cents <> a.amount_cents
      LIMIT 20
    `,
  },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let failed = false;

  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    for (const check of checks) {
      const { rows } = await client.query(check.sql);
      if (rows.length === 0) {
        console.log(`PASS ${check.name}`);
        continue;
      }

      failed = true;
      console.error(`FAIL ${check.name}: ${rows.length} sample violation(s)`);
      console.error(rows.map((row) => row.id).join(', '));
    }
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }

  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
