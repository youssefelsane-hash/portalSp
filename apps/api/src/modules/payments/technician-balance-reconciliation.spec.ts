import { DataSource } from 'typeorm';
import { TechnicianEarningsService } from './technician-earnings.service';

// اختبار حي ضد Postgres حقيقي — docs/08 §95 (سؤال مالك مباشر بلقطتين شاشة).
//
// المالك شاف في صفحة الفني عند الأدمن رقمين أحمر جنب بعض: "المديونية الحالية 185.50" و"مديونية
// الفني للمنصة من شغل الشهر 285.50"، وسأل: ده تضارب زي اللي كان بين المستحقات والمحفظة، ولا أنا
// مش عارف أقراهم؟
//
// الإجابة: **الحساب سليم تمامًا** — الرقمين بيقيسوا حاجتين مختلفتين (رصيد كل الزمن مقابل صافي شهر
// واحد)، فاختلافهم متوقع في أي وقت فيه حركة برّه شغل الشهر. الاختبار ده بيعيد إنتاج السيناريو
// بالظبط (فرق 100 ج.م جاي من حركة برّه الشهر) ويتأكد إن المطابقة بتفسّره بالكامل.
describe('TechnicianEarningsService.getBalanceReconciliation() — تفسير الفرق (docs/08 §95)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  let service: TechnicianEarningsService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    techUser: '',
    techProfile: '',
    walletId: '',
  };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  const MONTH = '2026-05';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
    service = new TechnicianEarningsService(dataSource);

    // `iso_code` عمود بحرفين وعليه UNIQUE، يعني مساحة الأسماء ١٢٩٦ قيمة بس. أي تشغيلة اتقطعت
    // قبل `afterAll` بتسيب صف وراها، وأول ما حرفين يتكرروا السبيك بتفشل بـduplicate key من غير
    // أي علاقة بالمنطق اللي بتختبره. حصلت فعلاً (صف متروك من 2026-09-02). التنظيف الاستباقي هنا
    // على أسماء السبيك نفسها بس — مابيلمسش أي دولة حقيقية.
    await q(`DELETE FROM countries WHERE name_en LIKE 'RecCountry%' AND iso_code = $1`, [
      runId.slice(-2).toUpperCase(),
    ]);
    const [country] = await q(
      `INSERT INTO countries (name_ar,name_en,iso_code,phone_prefix,currency_code) VALUES ($1,$2,$3,'+009','EGP') RETURNING id`,
      [`دولة مطابقة ${runId}`, `RecCountry${runId}`, runId.slice(-2).toUpperCase()],
    );
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة مطابقة ${runId}`, `RecCity${runId}`, `rec-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id,name_ar,name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق مطابقة ${runId}`,
      `RecZone${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة مطابقة ${runId}`,
      `RecCat${runId}`,
      `rec-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,commission_percentage,warranty_days)
       VALUES ($1,$2,$3,'formula',100000,15,0) RETURNING id`,
      [ids.category, `خدمة مطابقة ${runId}`, `rec-svc-${runId}`],
    );
    ids.service = svc.id;
    const [cu] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2071${runId}`.slice(0, 15),
      `عميل مطابقة ${runId}`,
    ]);
    ids.customerUser = cu.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id,street_name,location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع مطابقة ${runId}`],
    );
    ids.address = addr.id;
    const [tu] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2072${runId}`.slice(0, 15),
      `فني مطابقة ${runId}`,
    ]);
    ids.techUser = tu.id;
    const [tp] = await q(
      `INSERT INTO technician_profiles (user_id,technician_code,years_of_experience,current_level)
       VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCREC${runId}`.slice(0, 20)],
    );
    ids.techProfile = tp.id;

    const [wallet] = await q(
      `INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ($1,'technician',0) RETURNING id`,
      [ids.techUser],
    );
    ids.walletId = wallet.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM wallet_transactions WHERE wallet_id = $1`, [ids.walletId]);
      await q(`DELETE FROM wallets WHERE id = $1`, [ids.walletId]);
      await q(`DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE technician_id = $1)`, [ids.techProfile]);
      await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE technician_id = $1)`, [ids.techProfile]);
      await q(`DELETE FROM orders WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.techUser]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
      await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    } finally {
      await dataSource.destroy();
    }
  });

  /** حركة محفظة حقيقية بنفس شكل اللي التسوية بتعملها (قيد مزدوج، رصيد قبل/بعد). */
  async function addWalletTx(opts: {
    direction: 'credit' | 'debit';
    type: string;
    amountCents: number;
    referenceType?: string | null;
    referenceId?: string | null;
    label: string;
  }) {
    const [{ balance_cents: before }] = await q(`SELECT balance_cents FROM wallets WHERE id = $1`, [ids.walletId]);
    const signed = opts.direction === 'credit' ? opts.amountCents : -opts.amountCents;
    const after = Number(before) + signed;
    await q(
      `INSERT INTO wallet_transactions
         (wallet_id, transaction_number, direction, transaction_type, amount_cents,
          balance_before_cents, balance_after_cents, reference_type, reference_id, description_ar)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        ids.walletId,
        `WTX${runId}${opts.label}`.slice(0, 24),
        opts.direction,
        opts.type,
        opts.amountCents,
        Number(before),
        after,
        opts.referenceType ?? null,
        opts.referenceId ?? null,
        opts.label,
      ],
    );
    await q(`UPDATE wallets SET balance_cents = $2 WHERE id = $1`, [ids.walletId, after]);
  }

  it('الفرق بين رصيد المحفظة وصافي شغل الشهر بيتفسّر بالكامل ومصدره بيبان بالاسم', async () => {
    // شغلانة كاش في الشهر ده: الفني نصيبه 8,500 لكن استلم كاش 10,000 → مديونية 1,500 على الفني.
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
                           order_status, payment_status, payment_method, total_amount_cents, discount_amount_cents,
                           commissionable_base_cents, technician_earning_cents, platform_commission_cents,
                           commission_rate_applied, level_premium_cents, warranty_price_cents, closed_at, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,'completed','paid','cash',100000,0,100000,85000,15000,15,0,0,$7,$7) RETURNING id`,
      [`REC${runId}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone, `${MONTH}-10T09:00:00Z`],
    );
    const [payment] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, completed_at)
       VALUES ($1,$2,$3,100000,'cash','succeeded',$4,now()) RETURNING id`,
      [`PREC${runId}`.slice(0, 24), order.id, ids.customerProfile, `rec-${runId}`.slice(0, 80)],
    );
    // حركة المحفظة المقابلة: خصم 1,500 (عمولة الكاش) — مربوطة بالطلب ده.
    await addWalletTx({ direction: 'debit', type: 'commission_deduction', amountCents: 15000, referenceType: 'order', referenceId: order.id, label: 'comm' });

    // **حركة برّه شغل الشهر** — دي بالظبط مصدر الفرق اللي حيّر المالك: سداد مديونية 10,000.
    await addWalletTx({ direction: 'credit', type: 'adjustment', amountCents: 10000, label: 'settle' });

    const rec = await service.getBalanceReconciliation(ids.techProfile, MONTH);

    // صافي شغل الشهر = نصيبه (85,000) − الكاش اللي استلمه (100,000) = −15,000.
    expect(rec.monthNetCents).toBe(-15000);
    // والدفتر بيقول نفس الرقم بالظبط لنفس الشهر — يعني مفيش خلل.
    expect(rec.monthLedgerCents).toBe(-15000);
    expect(rec.monthMatchesLedger).toBe(true);

    // الرصيد الحالي = −15,000 + 10,000 = −5,000 (مديونية 50 ج.م).
    expect(rec.currentBalanceCents).toBe(-5000);
    // والفرق بين الاتنين (10,000) مفسَّر بالكامل، ومصدره ظاهر بالاسم.
    expect(rec.outsideMonthCents).toBe(10000);
    expect(rec.outsideMonthBreakdown).toEqual([
      { transactionType: 'adjustment', labelAr: 'تسويات وسدادات مديونية', amountCents: 10000 },
    ]);
    // الضمانة النهائية: صافي الشهر + اللي برّه الشهر = الرصيد الحالي بالظبط.
    expect(rec.monthLedgerCents + rec.outsideMonthCents).toBe(rec.currentBalanceCents);

    // استرداد 100 ج.م من الطلب يعكس 85 ج.م من مستحق الفني. حركة المحفظة مرجعها refund.id،
    // وليست order.id؛ دي كانت الفجوة التي أظهرت إنذارًا كاذبًا في شاشة المالك.
    const [refund] = await q(
      `INSERT INTO refunds
         (refund_number,payment_id,order_id,amount_cents,refund_type,refund_method,refund_status,
          requested_by_user_id,requested_at,completed_at)
       VALUES ($1,$2,$3,10000,'partial','wallet_credit','completed',$4,now(),now()) RETURNING id`,
      [`RREC${runId}`.slice(0, 24), payment.id, order.id, ids.customerUser],
    );
    await addWalletTx({
      direction: 'debit',
      type: 'refund',
      amountCents: 8500,
      referenceType: 'refund',
      referenceId: refund.id,
      label: 'refund',
    });

    const afterRefund = await service.getBalanceReconciliation(ids.techProfile, MONTH);
    expect(afterRefund.monthNetCents).toBe(-23500);
    expect(afterRefund.monthLedgerCents).toBe(-23500);
    expect(afterRefund.monthMatchesLedger).toBe(true);
    expect(afterRefund.outsideMonthBreakdown).toEqual([
      { transactionType: 'adjustment', labelAr: 'تسويات وسدادات مديونية', amountCents: 10000 },
    ]);
    expect(afterRefund.monthLedgerCents + afterRefund.outsideMonthCents).toBe(afterRefund.currentBalanceCents);
  });
});
