import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AdminOrderTraceService } from './admin-order-trace.service';
import { SettingsService } from '../settings/settings.service';

const MAX_ROUNDS = 3;
const settingsServiceStub = {
  getNumber: async (key: string, fallback: number) => (key === 'matching.max_rounds' ? MAX_ROUNDS : fallback),
} as unknown as SettingsService;

// اختبار حي — تتبّع الطلب في المطابقة. الحاجة الوحيدة الجديدة في الخدمة دي هي **اشتقاق الخطوة
// الجاية** من حالة موجودة في الداتابيز، فالاختبارات دي بتغطي الخمس فروع بالظبط + التجميع حسب
// الجولة + إن `viewed_at` بيوصل للواجهة. ضد Postgres حقيقي، بلا mocks.
describe('AdminOrderTraceService (تتبّع الطلب في المطابقة)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = { city: '', zone: '', category: '', service: '', customerProfile: '', address: '' };
  const users: string[] = [];
  const technicianProfiles: string[] = [];
  const orderIds: string[] = [];
  const assignmentIds: string[] = [];
  let techSeq = 0;

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  function service() {
    return new AdminOrderTraceService(dataSource, settingsServiceStub);
  }

  async function insertTechnician() {
    techSeq += 1;
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+22${String(techSeq).padStart(2, '0')}${runId}`.slice(0, 15),
      `فني تتبّع ${techSeq} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,'new','approved',true) RETURNING id`,
      [user.id, `TRC${techSeq}${runId}`.slice(0, 20)],
    );
    technicianProfiles.push(profile.id);
    return profile.id as string;
  }

  async function insertOrder(orderStatus: string, orderType: 'scheduled' | 'emergency' = 'scheduled') {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, order_type, payment_status,
         booking_mode, total_amount_cents, technician_earning_cents, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','individual',50000,0, now() + interval '2 hours')
       RETURNING id`,
      [`TESTTRC-${randomUUID().slice(0, 8)}`, ids.customerProfile, ids.service, ids.address, ids.zone, orderStatus, orderType],
    );
    orderIds.push(order.id);
    return order.id as string;
  }

  /** `expansionMinutes` موجب = المهلة عدّت من كام دقيقة؛ سالب = لسه جاية. */
  async function insertAssignment(opts: {
    orderId: string;
    technicianId: string;
    round: number;
    status: string;
    expansionMinutes: number;
    viewed?: boolean;
  }) {
    const [row] = await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at, viewed_at, distance_km)
       VALUES ($1,$2,$3,$4::order_assignment_status, now() - interval '40 minutes',
               now() - ($5::text || ' minutes')::interval,
               CASE WHEN $6::boolean THEN now() - interval '35 minutes' ELSE NULL END,
               4.25)
       RETURNING id`,
      [opts.orderId, opts.technicianId, opts.round, opts.status, opts.expansionMinutes, opts.viewed ?? false],
    );
    assignmentIds.push(row.id);
    return row.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak' });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة تتبّع ${runId}`,
      `Trace City ${runId}`,
      `test-trace-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تتبّع ${runId}`,
      `Trace Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تتبّع ${runId}`,
      `Trace Category ${runId}`,
      `test-trace-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'formula',50000,20,0,60) RETURNING id`,
      [ids.category, `خدمة تتبّع ${runId}`, `test-trace-svc-${runId}`],
    );
    ids.service = svc.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2065${runId}`.slice(0, 15),
      `عميل تتبّع ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع تتبّع ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      if (assignmentIds.length) await q(`DELETE FROM order_assignments WHERE id = ANY($1::uuid[])`, [assignmentIds]);
      if (orderIds.length) await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      if (technicianProfiles.length) await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  }, 15000);

  it('بيجمّع العروض حسب الجولة وبيطلّع viewed_at — مش مجرد حالة "اتشاف"', async () => {
    const orderId = await insertOrder('searching_technician');
    const t1 = await insertTechnician();
    const t2 = await insertTechnician();
    const t3 = await insertTechnician();
    await insertAssignment({ orderId, technicianId: t1, round: 1, status: 'rejected', expansionMinutes: 20, viewed: true });
    await insertAssignment({ orderId, technicianId: t2, round: 1, status: 'timeout', expansionMinutes: 15 });
    await insertAssignment({ orderId, technicianId: t3, round: 2, status: 'sent', expansionMinutes: -10, viewed: true });

    const trace = await service().getForOrder(orderId);

    expect(trace).not.toBeNull();
    expect(trace!.rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(trace!.rounds[0].technicians).toHaveLength(2);
    expect(trace!.currentRound).toBe(2);
    expect(trace!.techniciansContacted).toBe(3);
    expect(trace!.counts).toMatchObject({ sent: 1, rejected: 1, timeout: 1 });

    // `viewed_at` (migration 0255) بيوصل لكل فني على حدة — قبله كانت الحالة بتتحول لـ'viewed'
    // من غير ما حد يسجّل إمتى، فمكانش ينفع تقيس «قعد قد إيه قبل ما يرفض».
    const viewedTech = trace!.rounds[0].technicians.find((t) => t.technicianId === t1);
    expect(viewedTech!.viewedAt).not.toBeNull();
    expect(trace!.rounds[0].technicians.find((t) => t.technicianId === t2)!.viewedAt).toBeNull();

    // مهلة التوسيع للجولة = **أكبر** expires_at جوّاها. الجولة 1 فيها مهلتين: من 20 دقيقة ومن
    // 15 دقيقة — الحدود دي بتعدّي على 15 وبس، فلو الكود أخد الأقدم (20) الاختبار بيقع.
    const dueAt = new Date(trace!.rounds[0].expansionDueAt).getTime();
    expect(dueAt).toBeGreaterThan(Date.now() - 16 * 60_000);
    expect(dueAt).toBeLessThan(Date.now() - 14 * 60_000);
  });

  it('مهلة آخر جولة لسه جاية → مستني رد الفنيين، بلا تأخير', async () => {
    const orderId = await insertOrder('searching_technician');
    await insertAssignment({ orderId, technicianId: await insertTechnician(), round: 1, status: 'sent', expansionMinutes: -10 });

    const trace = await service().getForOrder(orderId);
    expect(trace!.nextAction).toBe('waiting_technician_response');
    expect(trace!.delaySeconds).toBe(0);
  });

  it('المهلة عدّت وفي جولات فاضلة → المفروض توسيع، والتأخير محسوب بالثواني', async () => {
    const orderId = await insertOrder('searching_technician');
    await insertAssignment({ orderId, technicianId: await insertTechnician(), round: 1, status: 'sent', expansionMinutes: 5 });

    const trace = await service().getForOrder(orderId);
    expect(trace!.nextAction).toBe('expand_next_round');
    expect(trace!.maxRounds).toBe(MAX_ROUNDS);
    // ~5 دقايق، بهامش للتنفيذ.
    expect(trace!.delaySeconds).toBeGreaterThanOrEqual(280);
    expect(trace!.delaySeconds).toBeLessThan(400);
  });

  it('المهلة عدّت وخلصت الجولات → المطابقة استنفدت (مش «مستني توسيع» للأبد)', async () => {
    const orderId = await insertOrder('searching_technician');
    await insertAssignment({ orderId, technicianId: await insertTechnician(), round: MAX_ROUNDS, status: 'timeout', expansionMinutes: 5 });

    const trace = await service().getForOrder(orderId);
    expect(trace!.nextAction).toBe('matching_exhausted');
  });

  it('في عرض مقبول → اتعيّن، مهما كانت المهل', async () => {
    const orderId = await insertOrder('searching_technician');
    await insertAssignment({ orderId, technicianId: await insertTechnician(), round: 1, status: 'accepted', expansionMinutes: 99 });

    const trace = await service().getForOrder(orderId);
    expect(trace!.nextAction).toBe('assigned');
    expect(trace!.delaySeconds).toBe(0);
  });

  it('الطلب مش في مرحلة بحث → مفيش مطابقة مطلوبة', async () => {
    const orderId = await insertOrder('cancelled_by_customer');
    await insertAssignment({ orderId, technicianId: await insertTechnician(), round: 1, status: 'cancelled', expansionMinutes: 99 });

    const trace = await service().getForOrder(orderId);
    expect(trace!.nextAction).toBe('no_matching_required');
  });

  it('طلب بيدوّر ولسه ما اتبعتش لحد → صفر جولات بلا انهيار', async () => {
    const orderId = await insertOrder('searching_technician');

    const trace = await service().getForOrder(orderId);
    expect(trace!.rounds).toEqual([]);
    expect(trace!.currentRound).toBeNull();
    expect(trace!.techniciansContacted).toBe(0);
    expect(trace!.nextAction).toBe('waiting_technician_response');
  });

  it('listSearchingOrders بيرجّع كل الطلبات الباحثة في نداء واحد، والملغي مش فيهم', async () => {
    const searchingA = await insertOrder('searching_technician');
    const searchingB = await insertOrder('searching_technician', 'emergency');
    const cancelled = await insertOrder('cancelled_by_customer');
    await insertAssignment({ orderId: searchingB, technicianId: await insertTechnician(), round: 1, status: 'sent', expansionMinutes: -5 });

    const traces = await service().listSearchingOrders(200);
    const found = new Map(traces.map((t) => [t.orderId, t]));

    expect(found.has(searchingA)).toBe(true);
    expect(found.has(searchingB)).toBe(true);
    expect(found.has(cancelled)).toBe(false);
    expect(found.get(searchingB)!.isEmergency).toBe(true);
    expect(found.get(searchingA)!.isEmergency).toBe(false);
  });
});
