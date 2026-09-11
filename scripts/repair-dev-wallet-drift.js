#!/usr/bin/env node
/**
 * **إصلاح لمرة واحدة لانحراف أرصدة المحافظ على قاعدة تطوير** — مش أداة تشغيلية.
 *
 * ## السبب
 *
 * تنظيف السبيكات كان بيمسح `wallet_transactions` من غير ما يرجّع أثرها على الرصيد، ومحفظة
 * المنصة المشتركة مابتتمسحش أبدًا فالانحراف اتراكم على كل تشغيلة. السبب اتقفل بنيويًا في
 * `apps/api/src/modules/payments/wallet-cleanup.testing.ts` — السكربت ده بس بينضّف اللي
 * اتراكم **قبل** الإصلاح.
 *
 * ## حراسة مقصودة
 *
 * ده بيكتب على أرصدة محافظ. مايتشغّلش في الإنتاج تحت أي ظرف:
 * - بيرفض لو `NODE_ENV=production`.
 * - محتاج `--confirm` صراحةً؛ من غيرها بيطبع اللي هيتغيّر وبس (dry-run).
 *
 * **ما بيلمسش غير المحافظ اللي رصيدها مش مطابق لمجموع حركاتها**، وبيساويه بالمجموع — وده
 * التعريف الحرفي للثابت اللي `/admin/analytics/money/reconciliation` بيقيسه.
 */
'use strict';

const { Client } = require('pg');
const { DATABASE_URL } = require('./lib/live-harness');

const CONFIRM = process.argv.includes('--confirm');
const egp = (c) => `${(Number(c) / 100).toFixed(2)} ج.م`;

// الاستعلام ده هو **نفس** الثابت اللي الفحص المالي في لوحة الأدمن بيقيسه بالحرف.
const MISMATCH_SQL = `
  SELECT w.id,
         w.owner_type,
         w.balance_cents,
         w.reserved_balance_cents,
         COALESCE(SUM(CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END)
                  FILTER (WHERE t.is_reversed = false), 0) AS expected_ledger_cents
    FROM wallets w
    LEFT JOIN wallet_transactions t ON t.wallet_id = w.id
   WHERE w.deleted_at IS NULL
   GROUP BY w.id
  HAVING w.balance_cents + w.reserved_balance_cents <> COALESCE(SUM(
           CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END
         ) FILTER (WHERE t.is_reversed = false), 0)
   ORDER BY ABS(w.balance_cents + w.reserved_balance_cents - COALESCE(SUM(
           CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END
         ) FILTER (WHERE t.is_reversed = false), 0)) DESC`;

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ ممنوع في الإنتاج. ده سكربت إصلاح بيانات تطوير بس.');
    process.exit(1);
  }

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query(MISMATCH_SQL);
    if (rows.length === 0) {
      console.log('🟢 مفيش أي محفظة رصيدها مخالف لمجموع حركاتها.');
      return;
    }

    console.log(`لقينا ${rows.length} محفظة رصيدها مش مطابق لمجموع حركاتها:\n`);
    for (const row of rows) {
      const actual = Number(row.balance_cents) + Number(row.reserved_balance_cents);
      const expected = Number(row.expected_ledger_cents);
      console.log(
        `  ${row.owner_type.padEnd(10)} ${row.id}\n` +
        `     الرصيد الحالي : ${egp(actual)}\n` +
        `     مجموع الحركات: ${egp(expected)}\n` +
        `     الفرق        : ${egp(actual - expected)}\n`,
      );
    }

    if (!CONFIRM) {
      console.log('ℹ️  ده عرض بس. للتنفيذ الفعلي: node scripts/repair-dev-wallet-drift.js --confirm');
      return;
    }

    // `reserved` مابيتلمسش: هو فلوس محجوزة لصرف قيد التنفيذ، والثابت بيقول
    // `balance + reserved = مجموع الحركات` — فالتصحيح بيقع على `balance` وحده.
    const { rowCount } = await db.query(
      `UPDATE wallets w
          SET balance_cents = s.expected_ledger_cents - w.reserved_balance_cents
         FROM (${MISMATCH_SQL}) s
        WHERE w.id = s.id`,
    );
    console.log(`✅ اتصلحت ${rowCount} محفظة.`);

    const { rows: after } = await db.query(MISMATCH_SQL);
    console.log(
      after.length === 0
        ? '🟢 الفحص بقى نضيف: مفيش أي مخالفة رصيد.'
        : `🔴 لسه فيه ${after.length} مخالفة — محتاجة فحص يدوي.`,
    );
    process.exit(after.length === 0 ? 0 : 1);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
