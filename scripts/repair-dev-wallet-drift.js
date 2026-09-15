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
 *
 * ## ليه بيعيد بناء سلسلة الأرصدة كمان (تدقيق ماراثوني 2026-09-13)
 *
 * فحص المطابقة بيعدّ **تلات أنواع** مخالفات: فرق رصيد، حساب صف غلط، و**كسر السلسلة**
 * (`balance_before` لصف ≠ `balance_after` للصف اللي قبله على نفس المحفظة). إصلاح الرصيد
 * وحده بيقفل النوع الأول بس — وأول حركة جديدة على محفظة منحرفة بتاخد `balance_before` من
 * الرصيد المنحرف، فتولّد **كسر سلسلة دائم** في الصف نفسه، والعدّاد يرجع أحمر تاني من غير أي
 * عطل حقيقي. اتقاس فعلاً: أول تسوية على محفظة المنصة بعد الانحراف ولّدت `TXN-2026-019435`
 * بفرق ١٢٤١٠ ج.م بالظبط = قيمة الانحراف نفسه.
 *
 * فالسكربت بيعيد حساب `balance_before/after` لكل صفوف المحافظ المتأثرة كمجموع تراكمي من صفر
 * — نفس منطق `scripts/lib/live-harness.js` بالحرف. لوحة بتقيس ثابت وأداة بتصلّح تلته معناها
 * إنذار كاذب دائم، والإنذار الكاذب الدائم = لوحة بتتجاهل.
 */
'use strict';

const { Client } = require('pg');
const { DATABASE_URL } = require('./lib/live-harness');

const CONFIRM = process.argv.includes('--confirm');
const egp = (c) => `${(Number(c) / 100).toFixed(2)} ج.م`;

// كسر السلسلة: `balance_before` لصف ≠ `balance_after` للصف اللي قبله على نفس المحفظة.
const CHAIN_SQL = `
  WITH ordered AS (
    SELECT t.id, t.wallet_id, t.balance_before_cents,
           LAG(t.balance_after_cents) OVER (PARTITION BY t.wallet_id ORDER BY t.created_at, t.id) AS previous_after
      FROM wallet_transactions t
  )
  SELECT wallet_id, COUNT(*)::int AS breaks
    FROM ordered
   WHERE previous_after IS NOT NULL AND balance_before_cents <> previous_after
   GROUP BY wallet_id`;

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
    const { rows: chainRows } = await db.query(CHAIN_SQL);
    if (rows.length === 0 && chainRows.length === 0) {
      console.log('🟢 مفيش أي محفظة رصيدها مخالف لمجموع حركاتها، ولا أي كسر في سلسلة الأرصدة.');
      return;
    }
    if (chainRows.length) {
      console.log(`فيه ${chainRows.length} محفظة فيها كسر في سلسلة الأرصدة:`);
      for (const row of chainRows) console.log(`  ${row.wallet_id} — ${row.breaks} صف`);
      console.log('');
    }

    if (rows.length) console.log(`لقينا ${rows.length} محفظة رصيدها مش مطابق لمجموع حركاتها:\n`);
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
    const affectedWallets = [...new Set([...rows.map((r) => r.id), ...chainRows.map((r) => r.wallet_id)])];

    const { rowCount } = await db.query(
      `UPDATE wallets w
          SET balance_cents = s.expected_ledger_cents - w.reserved_balance_cents
         FROM (${MISMATCH_SQL}) s
        WHERE w.id = s.id`,
    );
    console.log(`✅ اتصلحت ${rowCount} محفظة.`);

    // إعادة بناء السلسلة على المحافظ المتأثرة بس — نفس منطق
    // `live-harness.deleteWalletTransactions()`: مجموع تراكمي من صفر بترتيب (created_at, id).
    const { rowCount: rechained } = await db.query(
      `UPDATE wallet_transactions t
          SET balance_before_cents = c.before_cents, balance_after_cents = c.after_cents
         FROM (
           SELECT x.id,
                  COALESCE(SUM(x.effect) OVER (
                    PARTITION BY x.wallet_id ORDER BY x.created_at, x.id
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::bigint AS before_cents,
                  SUM(x.effect) OVER (PARTITION BY x.wallet_id ORDER BY x.created_at, x.id)::bigint AS after_cents
             FROM (
               SELECT id, wallet_id, created_at,
                      CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END AS effect
                 FROM wallet_transactions WHERE wallet_id = ANY($1::uuid[])
             ) x
         ) c
        WHERE t.id = c.id
          AND (t.balance_before_cents <> c.before_cents OR t.balance_after_cents <> c.after_cents)`,
      [affectedWallets],
    );
    console.log(`✅ اتعاد بناء سلسلة الأرصدة في ${rechained} صف حركة.`);

    const { rows: after } = await db.query(MISMATCH_SQL);
    const { rows: chainAfter } = await db.query(CHAIN_SQL);
    const clean = after.length === 0 && chainAfter.length === 0;
    console.log(
      clean
        ? '🟢 الفحص بقى نضيف: مفيش مخالفة رصيد ولا كسر سلسلة.'
        : `🔴 لسه فيه ${after.length} مخالفة رصيد و${chainAfter.length} محفظة بكسر سلسلة — محتاجة فحص يدوي.`,
    );
    process.exit(clean ? 0 : 1);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
