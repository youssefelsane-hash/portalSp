import { DataSource } from 'typeorm';
import { TechnicianEarningsService } from './technician-earnings.service';

// اختبار حي ضد Postgres حقيقي — كشف مستحقات الفني الشهري (ADR-0038، docs/08 §61).
//
// بيغطّي التلات قواعد اللي المالك حددها:
// 1) الشهر مستقل: طلب من الشهر اللي فات مابيظهرش في كشف الشهر الحالي خالص.
// 2) الكوبون مابيقللش مستحق الفني — والكشف بيعرض «خصم محمّل على الفني: 0» صراحةً.
// 3) الضمان بره مستحق الفني.
describe('كشف مستحقات الفني الشهري (ADR-0038)', () => {
  let dataSource: DataSource;
  let service: TechnicianEarningsService;

  const runId = Date.now().toString(36);
  const ids = { country: '', city: '', zone: '', category: '', service: '', customerUser: '', customerProfile: '', address: '', techUser: '', techProfile: '', techUser2: '', techProfile2: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  /** بيدخل طلب **مقفول** بتاريخ إقفال محدد، بأرقام تسوية زي ما التسوية الحقيقية بتسيبها. */
  async function insertClosedOrder(opts: {
    label: string;
    closedAt: string;
    totalAmountCents: number;
    discountCents: number;
    commissionableBaseCents: number;
    technicianEarningCents: number;
    levelPremiumCents?: number;
    warrantyPriceCents?: number;
  }) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
                           order_status, payment_status, payment_method, total_amount_cents, discount_amount_cents,
                           commissionable_base_cents, technician_earning_cents, platform_commission_cents,
                           commission_rate_applied, level_premium_cents, warranty_price_cents, closed_at, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,'completed','paid','cash',$7,$8,$9,$10,$11,15,$12,0,$13,$13) RETURNING id`,
      [
        `STMT${runId}-${opts.label}`.slice(0, 24),
        ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone,
        opts.totalAmountCents, opts.discountCents, opts.commissionableBaseCents,
        opts.technicianEarningCents, opts.totalAmountCents - opts.technicianEarningCents,
        opts.levelPremiumCents ?? 0, opts.closedAt,
      ],
    );
    return order.id as string;
  }

  async function insertSucceededPayment(orderId: string, amountCents: number, method: 'cash' | 'card') {
    const suffix = orderId.replace(/-/g, '').slice(-10);
    const [payment] = await q(
      `INSERT INTO payments
         (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status,
          idempotency_key, completed_at)
       VALUES ($1,$2,$3,$4,$5,'succeeded',$6,now()) RETURNING id`,
      [
        `PM${runId}${suffix}${method}`.slice(0, 24),
        orderId,
        ids.customerProfile,
        amountCents,
        method,
        `statement-${runId}-${orderId}-${method}`.slice(0, 80),
      ],
    );
    return payment.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
    service = new TechnicianEarningsService(dataSource);

    const [country] = await q(`INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,'+009','EGP') RETURNING id`,
      [`دولة كشف ${runId}`, `Stmt Country ${runId}`, runId.slice(-2).toUpperCase()]);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة كشف ${runId}`, `Stmt City ${runId}`, `stmt-city-${runId}`]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق كشف ${runId}`, `Stmt Zone ${runId}`]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة كشف ${runId}`, `Stmt Cat ${runId}`, `stmt-cat-${runId}`]);
    ids.category = category.id;
    const [svc] = await q(`INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days) VALUES ($1,$2,$3,'fixed',100000,15,0) RETURNING id`,
      [ids.category, `خدمة كشف ${runId}`, `stmt-svc-${runId}`]);
    ids.service = svc.id;
    const [cu] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [`+2060${runId}`.slice(0, 15), `عميل كشف ${runId}`]);
    ids.customerUser = cu.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = cp.id;
    const [addr] = await q(`INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`, [ids.customerUser, `شارع كشف ${runId}`]);
    ids.address = addr.id;
    const [tu] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [`+2061${runId}`.slice(0, 15), `فني كشف ${runId}`]);
    ids.techUser = tu.id;
    const [tp] = await q(`INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`, [ids.techUser, `TCSTMT${runId}`.slice(0, 20)]);
    ids.techProfile = tp.id;
    const [tu2] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [`+2062${runId}`.slice(0, 15), `فني كشف2 ${runId}`]);
    ids.techUser2 = tu2.id;
    const [tp2] = await q(`INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`, [ids.techUser2, `TCSTMT2${runId}`.slice(0, 20)]);
    ids.techProfile2 = tp2.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM refunds WHERE payment_id IN (SELECT id FROM payments WHERE order_id IN (SELECT id FROM orders WHERE technician_id = $1))`, [ids.techProfile]);
      await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE technician_id = $1)`, [ids.techProfile]);
      await q(`DELETE FROM order_earning_shares WHERE order_id IN (SELECT id FROM orders WHERE technician_id = $1)`, [ids.techProfile]);
      await q(`DELETE FROM orders WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile2]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.techUser2]);
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

  it('كل شهر حساب مستقل — طلب الشهر اللي فات مابيدخلش كشف الشهر الحالي', async () => {
    await insertClosedOrder({ label: 'prev', closedAt: '2026-07-10T09:00:00Z', totalAmountCents: 100_000, discountCents: 0, commissionableBaseCents: 100_000, technicianEarningCents: 85_000 });
    await insertClosedOrder({ label: 'cur', closedAt: '2026-08-10T09:00:00Z', totalAmountCents: 200_000, discountCents: 0, commissionableBaseCents: 200_000, technicianEarningCents: 170_000 });

    const july = await service.getMonthlyStatement(ids.techProfile, '2026-07');
    const august = await service.getMonthlyStatement(ids.techProfile, '2026-08');

    expect(july.jobsCount).toBe(1);
    expect(july.totals.netTechnicianDueCents).toBe(85_000);
    expect(august.jobsCount).toBe(1);
    // **مفيش ترحيل**: أغسطس فيه شغل أغسطس بس، مش 85 + 170.
    expect(august.totals.netTechnicianDueCents).toBe(170_000);
  });

  it('بلاغ المالك: كوبون 50% — الفني بياخد مستحقه كامل، والكشف بيعرض "خصم محمّل على الفني: 0"', async () => {
    // خدمة 1000، كوبون 50% → العميل دفع 500. الوعاء 1000، الفني 850 (ADR-0038).
    await insertClosedOrder({ label: 'coupon', closedAt: '2026-09-12T09:00:00Z', totalAmountCents: 50_000, discountCents: 50_000, commissionableBaseCents: 100_000, technicianEarningCents: 85_000 });

    const statement = await service.getMonthlyStatement(ids.techProfile, '2026-09');
    const job = statement.jobs[0];

    expect(job.originalPriceCents).toBe(100_000);   // السعر الأصلي
    expect(job.customerDiscountCents).toBe(50_000); // خصم العميل
    expect(job.customerPaidCents).toBe(50_000);     // اللي العميل دفعه
    expect(job.discountBorneByTechnicianCents).toBe(0); // الفني مادفعش من الخصم
    expect(job.netTechnicianDueCents).toBe(85_000); // مستحقه كامل من الـ1000
    // نصيب المنصة سالب — هي اللي مموّلة الكوبون.
    expect(job.platformCommissionCents).toBe(-35_000);
    expect(statement.totals.discountBorneByTechnicianCents).toBe(0);
  });

  it('الضمان بره مستحق الفني — إجمالي الطلب أعلى بس نصيبه على سعر الشغل بس', async () => {
    // شغل 1000 + ضمان 200 = 1200 إجمالي، الوعاء 1000، الفني 850.
    await insertClosedOrder({ label: 'warr', closedAt: '2026-10-05T09:00:00Z', totalAmountCents: 120_000, discountCents: 0, commissionableBaseCents: 100_000, technicianEarningCents: 85_000 });

    const statement = await service.getMonthlyStatement(ids.techProfile, '2026-10');
    expect(statement.jobs[0].commissionableBaseCents).toBe(100_000);
    expect(statement.totals.netTechnicianDueCents).toBe(85_000);
    // الشركة أخدت 150 عمولة + 200 ضمان.
    expect(statement.jobs[0].platformCommissionCents).toBe(35_000);
  });

  it('فرق الفني المميّز بيبان كسطر مستقل في تفاصيل الشغلانة', async () => {
    await insertClosedOrder({ label: 'prem', closedAt: '2026-11-05T09:00:00Z', totalAmountCents: 120_000, discountCents: 0, commissionableBaseCents: 120_000, technicianEarningCents: 102_000, levelPremiumCents: 20_000 });
    const statement = await service.getMonthlyStatement(ids.techProfile, '2026-11');
    expect(statement.jobs[0].levelPremiumCents).toBe(20_000);
    expect(statement.totals.levelPremiumCents).toBe(20_000);
  });

  it('طلب كاش كامل: الكشف يطابق المحفظة ويعرض عمولة مستحقة للمنصة بدل مستحق وهمي للفني', async () => {
    const orderId = await insertClosedOrder({
      label: 'cashnet', closedAt: '2027-01-05T09:00:00Z',
      totalAmountCents: 100_000, discountCents: 0,
      commissionableBaseCents: 100_000, technicianEarningCents: 85_000,
    });
    await insertSucceededPayment(orderId, 100_000, 'cash');

    const statement = await service.getMonthlyStatement(ids.techProfile, '2027-01');
    const job = statement.jobs.find((item) => item.orderId === orderId)!;

    expect(job.grossTechnicianEarningCents).toBe(85_000);
    expect(job.cashCollectedCents).toBe(100_000);
    expect(job.netTechnicianDueCents).toBe(-15_000);
    expect(statement.totals.netTechnicianDueCents).toBe(-15_000);
  });

  it('إيداع أونلاين + باقي كاش: المقاصة الشهرية تستخدم الكاش فقط ويصبح صافي الحركة صفرًا', async () => {
    const orderId = await insertClosedOrder({
      label: 'mixednet', closedAt: '2027-02-05T09:00:00Z',
      totalAmountCents: 100_000, discountCents: 0,
      commissionableBaseCents: 100_000, technicianEarningCents: 85_000,
    });
    await insertSucceededPayment(orderId, 15_000, 'card');
    await insertSucceededPayment(orderId, 85_000, 'cash');

    const statement = await service.getMonthlyStatement(ids.techProfile, '2027-02');
    const job = statement.jobs.find((item) => item.orderId === orderId)!;

    expect(job.grossTechnicianEarningCents).toBe(85_000);
    expect(job.cashCollectedCents).toBe(85_000);
    expect(job.netTechnicianDueCents).toBe(0);
  });

  it('استرداد جزئي لطلب كاش لا يمحو تاريخ استلام الكاش ويظل مطابقًا لصافي المحفظة', async () => {
    const orderId = await insertClosedOrder({
      label: 'cashrefund', closedAt: '2027-03-05T09:00:00Z',
      totalAmountCents: 100_000, discountCents: 0,
      commissionableBaseCents: 100_000, technicianEarningCents: 85_000,
    });
    const paymentId = await insertSucceededPayment(orderId, 100_000, 'cash');
    await q(`UPDATE payments SET payment_status = 'partially_refunded' WHERE id = $1`, [paymentId]);
    await q(
      `INSERT INTO refunds
         (refund_number, payment_id, order_id, amount_cents, refund_type, refund_method,
          refund_status, requested_by_user_id, requested_at, completed_at)
       VALUES ($1,$2,$3,40000,'partial','wallet_credit','completed',$4,now(),now())`,
      [`RF${runId}${orderId.replace(/-/g, '').slice(-8)}`.slice(0, 24), paymentId, orderId, ids.customerUser],
    );

    const statement = await service.getMonthlyStatement(ids.techProfile, '2027-03');
    const job = statement.jobs.find((item) => item.orderId === orderId)!;

    expect(job.cashCollectedCents).toBe(100_000);
    expect(job.refundReversalCents).toBe(34_000);
    expect(job.netTechnicianDueCents).toBe(-49_000); // -15,000 عمولة كاش - 34,000 عكس استرداد
  });

  it('شهر بلا شغل بيرجّع كشف صفر صحيح، مش خطأ', async () => {
    const statement = await service.getMonthlyStatement(ids.techProfile, '2020-01');
    expect(statement.jobsCount).toBe(0);
    expect(statement.totals.netTechnicianDueCents).toBe(0);
    expect(statement.monthStart).toBe('2020-01-01');
    expect(statement.monthEnd).toBe('2020-01-31');
  });

  it('آخر يوم في الشهر بيتحسب صح (فبراير والسنة الكبيسة)', async () => {
    expect((await service.getMonthlyStatement(ids.techProfile, '2024-02')).monthEnd).toBe('2024-02-29');
    expect((await service.getMonthlyStatement(ids.techProfile, '2026-02')).monthEnd).toBe('2026-02-28');
  });

  it('قايمة الشهور بترجّع الشهور اللي فيها شغل + الشهر الحالي دايمًا', async () => {
    const months = await service.listAvailableMonths(ids.techProfile);
    expect(months).toEqual(expect.arrayContaining(['2026-07', '2026-08', '2026-09']));
    expect(months).toContain(TechnicianEarningsService.currentMonthCairo());
    // الأحدث الأول.
    expect(months.indexOf('2026-09')).toBeLessThan(months.indexOf('2026-07'));
  });

  it('صيغة شهر غلط بترفض بوضوح بدل ما تتحط في SQL', async () => {
    await expect(service.getMonthlyStatement(ids.techProfile, "2026-13")).rejects.toThrow();
    await expect(service.getMonthlyStatement(ids.techProfile, "2026-8")).rejects.toThrow();
    await expect(service.getMonthlyStatement(ids.techProfile, "'; DROP TABLE orders; --")).rejects.toThrow();
  });

  // §90.1 (طلب مالك مباشر 2026-08-28) — "مستحقاتي" لازم يطابق "محفظتي" فعليًا. قبل الإصلاح ده،
  // الاستعلام كان بيفلتر على orders.technician_id بس: عضو الطاقم (مش القائد) ما كانش بيشوف
  // شغلانات اشتغل فيها خالص رغم إنه أخد فلوس فعلية في محفظته، والقائد كان بيشوف وعاء الطاقم كله
  // كأنه نصيبه هو. التستات دي بتتأكد إن كل واحد بيشوف بالظبط اللي نزل محفظته.
  describe('§90.1 — تطابق مع المحفظة: طاقم + استرداد', () => {
    async function insertCrewShares(orderId: string, poolCents: number, memberShareCents: number) {
      const leaderShareCents = poolCents - memberShareCents;
      await q(
        `INSERT INTO order_earning_shares (order_id, technician_id, participant_role, technician_level, share_weight, pool_cents, share_cents)
         VALUES ($1,$2,'leader','new',1.00,$3,$4), ($1,$5,'team_member','new',1.00,$3,$6)`,
        [orderId, ids.techProfile, poolCents, leaderShareCents, ids.techProfile2, memberShareCents],
      );
    }

    it('عضو الطاقم بيشوف نصيبه هو بس — مش صفر ومش وعاء القائد', async () => {
      const orderId = await insertClosedOrder({
        label: 'crew1', closedAt: '2026-12-05T09:00:00Z',
        totalAmountCents: 100_000, discountCents: 0, commissionableBaseCents: 100_000, technicianEarningCents: 85_000,
      });
      await insertCrewShares(orderId, 85_000, 20_000); // القائد 65,000 + العضو 20,000

      const leaderStatement = await service.getMonthlyStatement(ids.techProfile, '2026-12');
      const memberStatement = await service.getMonthlyStatement(ids.techProfile2, '2026-12');

      expect(leaderStatement.jobsCount).toBe(1);
      expect(leaderStatement.jobs[0].participantRole).toBe('leader');
      expect(leaderStatement.jobs[0].netTechnicianDueCents).toBe(65_000); // مش الـ85,000 كاملة

      expect(memberStatement.jobsCount).toBe(1); // قبل الإصلاح كان صفر
      expect(memberStatement.jobs[0].participantRole).toBe('team_member');
      expect(memberStatement.jobs[0].netTechnicianDueCents).toBe(20_000); // مش صفر
      expect(await service.listAvailableMonths(ids.techProfile2)).toContain('2026-12');
    });

    async function insertRefundedPayment(orderId: string, totalAmountCents: number, refundAmountCents: number) {
      // uuid_generate_v7() بيحط الطابع الزمني في أول بايتات الـUUID — طلبات اتعملت في نفس
      // الميلي ثانية ممكن يتشابه أولها، فبناخد آخر الحروف (الجزء العشوائي) بدل الأول عشان التفرّد.
      const shortOrderId = orderId.replace(/-/g, '').slice(-10);
      const [payment] = await q(
        `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, completed_at)
         VALUES ($1,$2,$3,$4,'card','succeeded',$5,now()) RETURNING id`,
        [`P${runId}${shortOrderId}`.slice(0, 24), orderId, ids.customerProfile, totalAmountCents, `idem-stmt-${runId}-${orderId}`.slice(0, 80)],
      );
      await q(
        `INSERT INTO refunds (refund_number, payment_id, order_id, amount_cents, refund_type, refund_method, refund_status, requested_by_user_id, requested_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,'wallet_credit','completed',$6,now(),now())`,
        [
          `R${runId}${shortOrderId}`.slice(0, 24), payment.id, orderId, refundAmountCents,
          refundAmountCents === totalAmountCents ? 'full' : 'partial', ids.customerUser,
        ],
      );
    }

    it('استرداد جزئي بيتعكس من مستحق الفني بنفس نسبة refundOrder() بالظبط', async () => {
      // طلب 1000، الفني 850. استرداد 400 (40% من الإجمالي) → عكس = round(850 * 400/1000) = 340.
      const orderId = await insertClosedOrder({
        label: 'refund1', closedAt: '2026-12-06T09:00:00Z',
        totalAmountCents: 100_000, discountCents: 0, commissionableBaseCents: 100_000, technicianEarningCents: 85_000,
      });
      await insertRefundedPayment(orderId, 100_000, 40_000);

      const statement = await service.getMonthlyStatement(ids.techProfile, '2026-12');
      const job = statement.jobs.find((j) => j.orderId === orderId)!;
      expect(job.refundReversalCents).toBe(34_000);
      expect(job.netTechnicianDueCents).toBe(85_000 - 34_000);
    });

    it('استرداد على طلب طاقم بيتعكس من القائد بس — عضو الطاقم مستحقه ما بيتأثرش (نفس سلوك المحفظة الفعلي)', async () => {
      const orderId = await insertClosedOrder({
        label: 'crewref', closedAt: '2026-12-07T09:00:00Z',
        totalAmountCents: 100_000, discountCents: 0, commissionableBaseCents: 100_000, technicianEarningCents: 85_000,
      });
      await insertCrewShares(orderId, 85_000, 20_000);
      await insertRefundedPayment(orderId, 100_000, 50_000); // 50% استرداد → عكس القائد = round(850*500/1000)=425

      const leaderStatement = await service.getMonthlyStatement(ids.techProfile, '2026-12');
      const memberStatement = await service.getMonthlyStatement(ids.techProfile2, '2026-12');
      const leaderJob = leaderStatement.jobs.find((j) => j.orderId === orderId)!;
      const memberJob = memberStatement.jobs.find((j) => j.orderId === orderId)!;

      expect(leaderJob.refundReversalCents).toBe(42_500);
      expect(leaderJob.netTechnicianDueCents).toBe(65_000 - 42_500);
      // العضو محفظته ما اتلمستش وقت الاسترداد فعليًا (payments.service.ts refundOrder)، فمستحقه هنا ثابت.
      expect(memberJob.refundReversalCents).toBe(0);
      expect(memberJob.netTechnicianDueCents).toBe(20_000);
    });
  });
});
