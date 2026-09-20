#!/usr/bin/env node
/**
 * تدقيق ثوابت الفلوس على **كل** طلب في القاعدة (docs/08 §162، بلاغ مالك 2026-09-17:
 * «اتأكد كمان من المسارات المختلفة للفلوس إن كل حاجة بتتحسب بطريقة مظبوطة»).
 *
 * الفلسفة: كل ثابت هنا **مستخرج من الكود مش مخترع** — الملف والسطر مكتوبين مع كل ثابت، فلو
 * الكود اتغيّر يوم، اللي بيقرا التقرير يقدر يراجع المصدر بدل ما يصدّق رقم. وكل بلاغ بيطبع
 * `order_number` والقيم اللي كسرت الثابت، عشان يتحقّق بالإيد فورًا.
 *
 *   node scripts/audit-money-paths.js            # تقرير على كل الطلبات
 *   node scripts/audit-money-paths.js --verbose  # يطبع كل الصفوف المخالفة مش أول 5
 *
 * الخروج بكود 1 لو فيه أي خرق — صالح للـCI.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const VERBOSE = process.argv.includes('--verbose');

/**
 * **بَقّة أداة اتصلحت هنا (تدقيق شامل 2026-09-20)**: الافتراضي كان مكتوب بالإيد
 * `postgres://baytak:baytak@localhost:5432/baytak` — وقاعدة `baytak` القديمة **لسه موجودة**
 * على سيرفر التطوير. فتشغيل السكريبت بالطريقة الموثّقة (`node scripts/audit-money-paths.js`
 * من غير `export DATABASE_URL`) كان بيدقّق **٥٣ طلب في قاعدة قديمة** بدل ٥٢٢ في القاعدة
 * الحقيقية، ويطلّع «خرقين» سببهم إن عمودين مش موجودين هناك أصلاً.
 *
 * الحل: نفس مصدر الحقيقة اللي كل أدوات التدقيق التانية بتقراه (`scripts/lib/live-harness.js`)
 * — `apps/api/.env`. مفيش fallback مكتوب بالإيد خالص: لو مالقيناش DSN بنوقف بصوت عالي بدل
 * ما ندقّق حاجة مش دي.
 */
function resolveConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(__dirname, '../apps/api/.env');
  const fromFile = fs.existsSync(envPath)
    ? /^DATABASE_URL=(.*)$/m.exec(fs.readFileSync(envPath, 'utf8'))?.[1]?.trim()
    : undefined;
  if (fromFile) return fromFile;
  console.error(
    'مفيش DATABASE_URL — لا في البيئة ولا في apps/api/.env. وقفت بدل ما أدقّق قاعدة غلط.',
  );
  process.exit(2);
}

const CONN = resolveConnectionString();

/**
 * كل ثابت: عنوان، مصدره في الكود، واستعلام بيرجّع **الصفوف المخالفة بس**.
 * `expected` بيوصف المفروض بالعربي عشان البلاغ يبقى مفهوم بلا قراءة SQL.
 */
const INVARIANTS = [
  {
    title: 'حافز InstaPay جزء من إجمالي الخصم',
    source: 'payments.service.ts applyInstaPayDiscount(): discountAmountCents += discountCents',
    expected: 'instapay_discount_cents ≤ discount_amount_cents',
    sql: `SELECT order_number, discount_amount_cents, instapay_discount_cents
            FROM orders
           WHERE deleted_at IS NULL AND instapay_discount_cents > discount_amount_cents`,
  },
  {
    title: 'الإيداع مش أكبر من الإجمالي',
    source: 'order-financial-finalization.service.ts replaceUncommittedPrice() بترفض العكس',
    expected: 'deposit_amount_cents ≤ total_amount_cents',
    sql: `SELECT order_number, deposit_amount_cents, total_amount_cents
            FROM orders
           WHERE deleted_at IS NULL AND deposit_amount_cents IS NOT NULL
             AND deposit_amount_cents > total_amount_cents`,
  },
  {
    title: 'مراحل تكوين السعر بتجمع لسعر الشغل',
    source: 'migration 0352 chk_orders_price_formation_sums + ADR-0107',
    expected: 'work = engine_raw + zone_adj + tier_adj + clamp_delta',
    sql: `SELECT order_number, pricing_engine_raw_cents, pricing_zone_adjustment_cents,
                 pricing_tier_adjustment_cents, pricing_clamp_delta_cents, pricing_work_price_cents
            FROM orders
           WHERE deleted_at IS NULL AND pricing_work_price_cents IS NOT NULL
             AND pricing_work_price_cents <> pricing_engine_raw_cents
                 + COALESCE(pricing_zone_adjustment_cents, 0)
                 + COALESCE(pricing_tier_adjustment_cents, 0)
                 + COALESCE(pricing_clamp_delta_cents, 0)`,
  },
  {
    title: 'تقسيم الإيراد: مستحق الفني + عمولة المنصة = الإجمالي',
    source: 'commission-base.ts splitOrderRevenue() — الثابت الجبري المكتوب في تعليق الدالة',
    expected: 'technician_earning_cents + platform_commission_cents = total_amount_cents',
    sql: `SELECT order_number, technician_earning_cents, platform_commission_cents, total_amount_cents
            FROM orders
           WHERE deleted_at IS NULL AND closed_at IS NOT NULL
             AND technician_earning_cents IS NOT NULL AND platform_commission_cents IS NOT NULL
             AND technician_earning_cents + platform_commission_cents <> total_amount_cents`,
  },
  {
    title: 'وعاء العمولة مش أكبر من الإيراد الإجمالي قبل الخصم',
    source: 'commission-base.ts computeCommissionableBase() — مكوّناته كلها من نفس الطلب',
    expected: 'commissionable_base_cents ≤ total_amount_cents + discount_amount_cents',
    sql: `SELECT order_number, commissionable_base_cents, total_amount_cents, discount_amount_cents
            FROM orders
           WHERE deleted_at IS NULL AND commissionable_base_cents IS NOT NULL
             AND commissionable_base_cents > total_amount_cents + discount_amount_cents`,
  },
  {
    title: 'أصل التقسيط = مديونية العميل',
    source: 'installment-calculator.ts financeableOrderAmountCents() — الخصم كان بيتطرح مرتين',
    expected: 'installment_applications.service_price_cents = orders.total_amount_cents',
    sql: `SELECT o.order_number, a.service_price_cents, o.total_amount_cents, a.status,
                 a.created_at::date AS applied_on
            FROM installment_applications a
            JOIN orders o ON o.id = a.order_id
           WHERE a.deleted_at IS NULL AND a.status IN ('pending_review','approved')
             AND a.service_price_cents <> o.total_amount_cents`,
    // طلبات قدّمت قبل الإصلاح بتفضل بقيمتها المتعاقد عليها — الخطة المعتمدة لقطة مالية.
    historicalNote: 'خطة اتعمدت قبل الإصلاح = عقد قايم؛ الإصلاح بيسري على التقديمات الجديدة.',
  },
  {
    title: 'الاسترداد المكتمل مش أكبر من المدفوع',
    source: 'payments.service.ts getCollectionBreakdownForOrder() بتطرح الاسترداد من المدفوع',
    expected: 'SUM(refunds completed) ≤ SUM(payments succeeded)',
    sql: `WITH per_order AS (
            SELECT p.order_id,
                   SUM(p.amount_cents) FILTER (
                     WHERE p.payment_status IN ('succeeded','partially_refunded','refunded')
                   ) AS paid,
                   (SELECT COALESCE(SUM(r.amount_cents), 0) FROM refunds r
                     WHERE r.order_id = p.order_id AND r.refund_status = 'completed') AS refunded
              FROM payments p GROUP BY p.order_id
          )
          SELECT o.order_number, per_order.paid, per_order.refunded
            FROM per_order JOIN orders o ON o.id = per_order.order_id
           WHERE per_order.refunded > COALESCE(per_order.paid, 0)`,
  },
  {
    title: 'مجموع أنصبة الطاقم = مستحق الفني المسجّل',
    source: 'payments.service.ts settleAndComplete() — order_earning_shares هي التوزيع الفعلي',
    expected: 'SUM(order_earning_shares.share_cents) = orders.technician_earning_cents',
    sql: `SELECT o.order_number, SUM(oes.share_cents)::bigint AS shares_total,
                 o.technician_earning_cents
            FROM order_earning_shares oes
            JOIN orders o ON o.id = oes.order_id
           WHERE oes.deleted_at IS NULL AND o.deleted_at IS NULL AND o.closed_at IS NOT NULL
           GROUP BY o.id, o.order_number, o.technician_earning_cents
          HAVING SUM(oes.share_cents) <> o.technician_earning_cents`,
  },
  {
    title: 'مفيش مبالغ سالبة في أعمدة مستحيل تبقى سالبة',
    source: 'كل أعمدة القروش integer موجب بالتصميم (docs/01 §1.3)',
    expected: 'total/discount/inspection/surge/warranty ≥ 0',
    sql: `SELECT order_number, total_amount_cents, discount_amount_cents, inspection_fee_cents,
                 surge_amount_cents, warranty_price_cents
            FROM orders
           WHERE deleted_at IS NULL
             AND (total_amount_cents < 0 OR discount_amount_cents < 0 OR inspection_fee_cents < 0
                  OR surge_amount_cents < 0 OR warranty_price_cents < 0)`,
  },
];

(async () => {
  const client = new Client({ connectionString: CONN });
  await client.connect();
  const [{ count: orderCount }] = (await client.query('SELECT COUNT(*)::int AS count FROM orders WHERE deleted_at IS NULL')).rows;
  // اسم القاعدة مطبوع عمدًا — ده اللي كان هيكشف تشغيلة على القاعدة الغلط من أول سطر.
  const [{ current_database: dbName }] = (await client.query('SELECT current_database()')).rows;
  console.log(`## تدقيق مسارات الفلوس — قاعدة "${dbName}"، ${orderCount} طلب\n`);

  let violations = 0;
  // **«معرفتش أفحص» مش «خرق»** (تدقيق 2026-09-20): الاتنين كانوا بيتعدّوا في نفس العدّاد،
  // والمرآة دي خطر: عمود ناقص كان بيطلّع «خرق» كذب، ولو القاعدة الغلط صادف إن فيها الأعمدة،
  // ثابت مكسور فعلاً كان هيطلع أخضر. دلوقتي الاتنين منفصلين في التقرير — وبرضه الاتنين
  // بيخلّوا الخروج غير صفري، لأن ثابت مالحقناش نفحصه **مش** ثابت ناجح.
  let unchecked = 0;
  for (const inv of INVARIANTS) {
    let rows;
    try {
      rows = (await client.query(inv.sql)).rows;
    } catch (err) {
      console.log(`⚠️  ${inv.title}: **معرفتش أفحص** (مش خرق) — ${err.message}`);
      unchecked += 1;
      continue;
    }
    if (rows.length === 0) {
      console.log(`✅ ${inv.title}  (${inv.expected})`);
      continue;
    }
    violations += rows.length;
    console.log(`❌ ${inv.title} — ${rows.length} خرق`);
    console.log(`     المفروض: ${inv.expected}`);
    console.log(`     المصدر:  ${inv.source}`);
    if (inv.historicalNote) console.log(`     ملاحظة:  ${inv.historicalNote}`);
    for (const row of VERBOSE ? rows : rows.slice(0, 5)) {
      console.log(`     • ${JSON.stringify(row)}`);
    }
    if (!VERBOSE && rows.length > 5) console.log(`     … و${rows.length - 5} كمان (--verbose)`);
  }

  await client.end();
  if (violations === 0 && unchecked === 0) {
    console.log('\n✅ كل ثوابت الفلوس سليمة.');
  } else {
    if (violations > 0) console.log(`\n❌ ${violations} خرق محتاج مراجعة.`);
    if (unchecked > 0) {
      console.log(
        `\n⚠️  ${unchecked} ثابت **ما اتفحصش** (استعلامه فشل) — ده مش نجاح. غالبًا القاعدة الغلط ` +
          'أو مخطط قديم. شوف اسم القاعدة المطبوع فوق.',
      );
    }
  }
  process.exit(violations === 0 && unchecked === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
