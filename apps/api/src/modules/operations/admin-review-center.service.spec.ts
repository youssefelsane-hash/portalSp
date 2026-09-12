import { DataSource } from 'typeorm';
import { AdminReviewCenterService } from './admin-review-center.service';

/**
 * مركز المراجعة والشواذ (ADR-0084، docs/08 §139) — حي على Postgres حقيقي.
 *
 * اللي بيتقاس هنا هو **الوعد اللي الشاشة قايمة عليه**: المالك قال «عايز أدوّر ورا الصنايعية
 * وأشوف إيه اللي ماشي مضبوط وإيه اللي فيه تلاعب». يعني مش كفاية إن الصف يظهر — لازم **النص
 * اللي الفني كتبه** يوصل بالحرف، والفلترة على فني بعينه تشتغل فعلاً.
 */
describe('AdminReviewCenterService — مركز المراجعة (ADR-0084) — حي', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let service: AdminReviewCenterService;
  const runId = Date.now().toString(36);
  const ids = {
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    techUserA: '',
    techProfileA: '',
    techUserB: '',
    techProfileB: '',
    orderItems: '',
    orderQuote: '',
    orderFailed: '',
    orderCash: '',
    complaint: '',
  };
  const q = <T = unknown>(sql: string, params: unknown[] = []): Promise<T> => ds.query(sql, params) as Promise<T>;

  async function makeTech(label: string) {
    const [user] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2088${runId.slice(-6)}${label}`.slice(0, 15), `فني مراجعة ${label} ${runId}`],
    );
    const [profile] = await q<{ id: string }[]>(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status, current_location)
       VALUES ($1,$2,'premium','approved', ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [user.id, `RV${runId}${label}`.slice(0, 20)],
    );
    return { userId: user.id, profileId: profile.id };
  }

  async function makeOrder(label: string, technicianProfileId: string, status = 'in_progress') {
    const [order] = await q<{ id: string }[]>(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id,
                           address_id, service_zone_id, order_status, payment_status, total_amount_cents,
                           technician_earning_cents, scheduled_at)
       VALUES (20,$1,$2,$3,$4,$5,$6,$7::order_status,'pending',50000,0, now()) RETURNING id`,
      [`TESTRVC-${label}`.slice(0, 24), ids.customerProfile, technicianProfileId, ids.service, ids.address, ids.zone, status],
    );
    return order.id;
  }

  beforeAll(async () => {
    ds = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    }).initialize();
    service = new AdminReviewCenterService(ds);

    const [country] = await q<{ id: string }[]>(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q<{ id: string }[]>(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة مراجعة ${runId}`, `Review City ${runId}`, `review-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q<{ id: string }[]>(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [city.id, `نطاق مراجعة ${runId}`, `Review Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q<{ id: string }[]>(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة مراجعة ${runId}`, `Review Cat ${runId}`, `review-cat-${runId}`],
    );
    ids.category = category.id;
    const [service_] = await q<{ id: string }[]>(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',50000,20,0) RETURNING id`,
      [category.id, `خدمة مراجعة ${runId}`, `review-service-${runId}`],
    );
    ids.service = service_.id;

    const [custUser] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2087${runId}`.slice(0, 15), `عميل مراجعة ${runId}`],
    );
    ids.customerUser = custUser.id;
    const [custProfile] = await q<{ id: string }[]>(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      custUser.id,
    ]);
    ids.customerProfile = custProfile.id;
    const [address] = await q<{ id: string }[]>(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [custUser.id, city.id, `شارع مراجعة ${runId}`],
    );
    ids.address = address.id;

    const techA = await makeTech('a');
    ids.techUserA = techA.userId;
    ids.techProfileA = techA.profileId;
    const techB = await makeTech('b');
    ids.techUserB = techB.userId;
    ids.techProfileB = techB.profileId;

    // ── فعل مالي ١: قطعة غيار من فني أ، بتبرير مكتوب ─────────────────────────
    ids.orderItems = await makeOrder(`items-${runId}`, ids.techProfileA);
    await q(
      `INSERT INTO order_items (order_id, item_type, name_ar, description, quantity, unit_price_cents,
                                total_price_cents, added_by_user_id, proposal_status)
       VALUES ($1,'spare_part','مواسير نحاس','المواسير القديمة متآكلة والتسريب من عندها — لازم تتغيّر بالكامل',2,15000,30000,$2,'pending')`,
      [ids.orderItems, ids.techUserA],
    );

    // ── فعل مالي ٢: عرض سعر بعد معاينة من فني ب ──────────────────────────────
    ids.orderQuote = await makeOrder(`quote-${runId}`, ids.techProfileB);
    const [quote] = await q<{ id: string }[]>(
      `INSERT INTO order_quotes (order_id, version, source, status, amount_cents, diagnosis,
                                 scope_included, scope_excluded, submitted_by_user_id, valid_until)
       VALUES ($1,1,'technician_onsite','pending_customer',120000,
               'الكومبريسور بايظ بالكامل ومحتاج تغيير، والفريون فاضي',
               'تغيير الكومبريسور + شحن فريون','الأعمال الكهربائية بره الوحدة',$2, now() + interval '2 days')
       RETURNING id`,
      [ids.orderQuote, ids.techUserB],
    );
    void quote;

    // ── نشو: زيارة فاشلة من فني أ ────────────────────────────────────────────
    ids.orderFailed = await makeOrder(`noshow-${runId}`, ids.techProfileA, 'disputed');
    await q(
      `INSERT INTO order_status_history (order_id, previous_status, new_status, changed_by_user_id,
                                         changed_by_role, change_source, reason)
       VALUES ($1,'technician_arrived','disputed',$2,'technician','technician',
               'وصلت الساعة ١٠ ومحدش فتح، اتصلت تلات مرات والتليفون مقفول')`,
      [ids.orderFailed, ids.techUserA],
    );

    // ── كاش ماوصلش، مع تأكيد العميل إنه دفع = تضارب صريح ─────────────────────
    ids.orderCash = await makeOrder(`cash-${runId}`, ids.techProfileA, 'disputed');
    await q(
      `UPDATE orders SET technician_cash_not_received_at = now(), customer_cash_confirmed_at = now() WHERE id = $1`,
      [ids.orderCash],
    );

    // ── شكوى مفتوحة بطرفين معروفين ───────────────────────────────────────────
    const [complaintNumber] = await q<{ next_human_readable_number: string }[]>(
      `SELECT next_human_readable_number('CMP')`,
    );
    const [complaint] = await q<{ id: string }[]>(
      `INSERT INTO complaints (complaint_number, order_id, filed_by_user_id, against_user_id, category,
                               severity, title, description, complaint_status, compensation_cents, sla_due_at)
       VALUES ($1,$2,$3,$4,'overcharging','high','سعر مبالغ فيه','الفني طلب مبلغ أكبر من المتفق عليه',
               'open',0, now() - interval '1 hour')
       RETURNING id`,
      [complaintNumber.next_human_readable_number, ids.orderItems, ids.customerUser, ids.techUserA],
    );
    ids.complaint = complaint.id;
  });

  afterAll(async () => {
    if (!ds?.isInitialized) return;
    try {
      await q(`DELETE FROM complaints WHERE id = $1`, [ids.complaint]);
      const orderIds = [ids.orderItems, ids.orderQuote, ids.orderFailed, ids.orderCash].filter(Boolean);
      await q(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM order_quotes WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [[ids.techProfileA, ids.techProfileB]]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
        [ids.customerUser, ids.techUserA, ids.techUserB].filter(Boolean),
      ]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await ds.destroy();
    }
  });

  it('الفعلين الماليين (قطعة غيار + عرض معاينة) بيظهروا في قايمة واحدة مرتبة', async () => {
    const result = await service.getReviewCenter({ sinceDays: 1 });
    // الفلترة بمعرّفات التشغيلة دي بالذات — البادئة المشتركة بتلقط بقايا تشغيلات سابقة فشل
    // تنظيفها، فالتست بيقيس حالة القاعدة مش السلوك (اتلقطت حيًا هنا).
    const mine = result.technician_money_actions.items.filter((i) =>
      [ids.orderItems, ids.orderQuote].includes(i.orderId),
    );

    expect(mine.map((i) => i.kind).sort()).toEqual(['order_item', 'quote']);
    expect(mine.every((i) => i.amountCents > 0)).toBe(true);
  });

  it('**النص اللي الفني كتبه بيوصل بالحرف** — ده كل الغرض من الشاشة', async () => {
    const result = await service.getReviewCenter({ sinceDays: 1 });

    const item = result.technician_money_actions.items.find((i) => i.kind === 'order_item' && i.nameAr === 'مواسير نحاس');
    expect(item?.justification).toBe('المواسير القديمة متآكلة والتسريب من عندها — لازم تتغيّر بالكامل');
    expect(item?.justificationMissing).toBe(false);

    const quote = result.technician_money_actions.items.find(
      (i) => i.kind === 'quote' && i.orderNumber.startsWith('TESTRVC-quote'),
    );
    expect(quote?.justification).toBe('الكومبريسور بايظ بالكامل ومحتاج تغيير، والفريون فاضي');
    expect(quote?.scopeIncluded).toBe('تغيير الكومبريسور + شحن فريون');
    expect(quote?.scopeExcluded).toBe('الأعمال الكهربائية بره الوحدة');
  });

  it('الفلترة على فني بعينه بتشتغل — «أدوّر ورا صنايعي معيّن»', async () => {
    const onlyB = await service.getReviewCenter({ technicianId: ids.techProfileB, sinceDays: 1 });
    const mine = onlyB.technician_money_actions.items.filter((i) =>
      [ids.orderItems, ids.orderQuote].includes(i.orderId),
    );

    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe('quote');
    expect(mine[0].technicianId).toBe(ids.techProfileB);
  });

  it('النشو بيظهر بسببه وبنص الفني الحرفي', async () => {
    const result = await service.getReviewCenter({ sinceDays: 1 });
    const visit = result.failed_visits.items.find((v) => v.orderId === ids.orderFailed);

    expect(visit).toBeDefined();
    expect(visit?.description).toBe('وصلت الساعة ١٠ ومحدش فتح، اتصلت تلات مرات والتليفون مقفول');
    expect(visit?.technicianName).toContain('فني مراجعة a');
    expect(visit?.customerName).toContain('عميل مراجعة');
  });

  it('الكاش اللي ماوصلش بيتعلّم كتضارب صريح لما العميل يكون مؤكّد إنه دفع', async () => {
    const result = await service.getReviewCenter({ sinceDays: 1 });
    const cash = result.cash_disputes.items.find((c) => c.orderId === ids.orderCash);

    expect(cash).toBeDefined();
    expect(cash?.isConflict).toBe(true);
    expect(cash?.technicianCashNotReceivedAt).not.toBeNull();
    expect(cash?.customerCashConfirmedAt).not.toBeNull();
    expect(result.cash_disputes.conflicts).toBeGreaterThanOrEqual(1);
  });

  it('الشكوى المفتوحة بترجّع **الطرفين بالاسم** — ده اللي كان محذوف من العقد أصلاً', async () => {
    const result = await service.getReviewCenter({ sinceDays: 1 });
    const complaint = result.unresolved_complaints.items.find((c) => c.complaintId === ids.complaint);

    expect(complaint).toBeDefined();
    expect(complaint?.filedByName).toContain('عميل مراجعة');
    expect(complaint?.filedByType).toBe('customer');
    expect(complaint?.againstName).toContain('فني مراجعة a');
    expect(complaint?.againstType).toBe('technician');
    // SLA عدّى بساعة في الفكسچر — لازم يتعلّم متأخر.
    expect(complaint?.isOverdue).toBe(true);
  });

  it('`pendingOnly` بيرجّع المعلّق بس — القايمة اللي محتاجة قرار دلوقتي', async () => {
    await q(`UPDATE order_items SET proposal_status = 'approved' WHERE order_id = $1`, [ids.orderItems]);
    const pending = await service.getReviewCenter({ sinceDays: 1, pendingOnly: true });
    const mine = pending.technician_money_actions.items.filter((i) =>
      [ids.orderItems, ids.orderQuote].includes(i.orderId),
    );

    expect(mine.every((i) => i.isPending)).toBe(true);
    expect(mine.some((i) => i.kind === 'order_item')).toBe(false);
    await q(`UPDATE order_items SET proposal_status = 'pending' WHERE order_id = $1`, [ids.orderItems]);
  });
});
