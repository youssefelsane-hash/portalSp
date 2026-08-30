import { DataSource } from 'typeorm';
import { classifyTechnicianCapacity, describeTechnicianCapacity } from './technician-eligibility.sql';
import { OrderStatus } from '../orders/entities/order.entity';

// تصنيف القدرة الاستيعابية 4 مستويات (docs/08 §34.1، ADR-0020 §1) — اختبار حي ضد Postgres حقيقي.
// نفس فلسفة technicianAvailabilityCondition() (استخدامها فعليًا مؤكّد بـmatching-accept-
// concurrency.spec.ts وغيره) — هنا بنتحقق إن الدالة الجديدة بترجّع التصنيف الصح لكل حالة بدل
// بوليان بسيط.
describe('classifyTechnicianCapacity — تصنيف القدرة الاستيعابية 4 مستويات', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36);
  const ids = {
    city: '', zone: '', category: '', service: '', technician: '', technicianUser: '',
    customer: '', customerUser: '', address: '',
  };
  const orderIds: string[] = [];
  const FULL_DAY_MINUTES = 360;

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  async function insertOrder(status: OrderStatus, opts: { scheduledAt?: Date | null; durationDays?: number | null } = {}) {
    const [order] = await q(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status,
          total_amount_cents, scheduled_at, estimated_duration_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,10000,$8,$9) RETURNING id`,
      [
        `CAP-${orderIds.length}-${runId}`.slice(0, 24),
        ids.customer,
        ids.technician,
        ids.service,
        ids.address,
        ids.zone,
        status,
        opts.scheduledAt ?? null,
        opts.durationDays ?? null,
      ],
    );
    orderIds.push(order.id as string);
    return order.id as string;
  }

  async function classify(scheduledAt: Date | null, durationMinutes = 60) {
    const [candidate] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,'searching_technician',10000,$6) RETURNING id`,
      [`CAND-${orderIds.length}-${runId}`.slice(0, 24), ids.customer, ids.service, ids.address, ids.zone, scheduledAt],
    );
    orderIds.push(candidate.id as string);
    return classifyTechnicianCapacity(dataSource, {
      technicianId: ids.technician,
      scheduledAt,
      excludeOrderId: candidate.id as string,
      serviceDurationMinutes: durationMinutes,
      fullDayThresholdMinutes: FULL_DAY_MINUTES,
    });
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The fixture requires the seeded EG country');
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة قدرة ${runId}`, `Cap City ${runId}`, `cap-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      city.id,
      `نطاق قدرة ${runId}`,
      `Cap Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة قدرة ${runId}`,
      `Cap Category ${runId}`,
      `cap-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',10000,60) RETURNING id`,
      [category.id, `خدمة قدرة ${runId}`, `cap-service-${runId}`],
    );
    ids.service = service.id;

    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+201${runId}`.slice(0, 14),
      `فني قدرة ${runId}`,
    ]);
    ids.technicianUser = user.id;
    const [technician] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status, current_location)
       VALUES ($1,$2,'approved', ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [user.id, `CAP${runId}`.slice(0, 20)],
    );
    ids.technician = technician.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+202${runId}`.slice(0, 14),
      `عميل قدرة ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customer = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [customerUser.id, `شارع قدرة ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.technician]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technician]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customer]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.technicianUser, ids.customerUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('LIGHT — الفني بلا أي شغل خالص النهاردة', async () => {
    expect(await classify(null)).toBe('LIGHT');
  });

  it('MEANINGFUL — طلب accepted قصير موجود نفس اليوم لسه ما بدأش', async () => {
    await insertOrder(OrderStatus.ACCEPTED, { durationDays: null });
    expect(await classify(null)).toBe('MEANINGFUL');
  });

  it('HEAVY — الفني منشغل جسديًا فعليًا دلوقتي (technician_on_way)', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = $1`, [ids.technician]);
    await insertOrder(OrderStatus.TECHNICIAN_ON_WAY);
    expect(await classify(null)).toBe('HEAVY');
  });

  it('HEAVY — طلب يوم كامل (estimated_duration_days>=1) بيغطي اليوم المطلوب', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = $1`, [ids.technician]);
    await insertOrder(OrderStatus.ACCEPTED, { durationDays: 3 });
    expect(await classify(null)).toBe('HEAVY');
  });

  it('LIGHT — طلب اليوم الكامل مش بيغطي يوم تاني بعيد (بلا تعارض كاذب)', async () => {
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    expect(await classify(farFuture)).toBe('LIGHT');
  });

  it('BLOCKED — الفني حظر اليوم صراحة، بياخد الأولوية فوق أي تصنيف تاني', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = $1`, [ids.technician]);
    // "اليوم" هنا لازم يتحسب بتوقيت القاهرة زي بالظبط classifyTechnicianCapacity()
    // (technician-eligibility.sql.ts: `now() AT TIME ZONE 'Africa/Cairo'`) — مش UTC خام. فرق
    // التوقيت الصيفي (+3 مش +2) بيخلق نافذة ساعتين كل ليلة تاريخ القاهرة بيبقى فيها يوم قدّام
    // UTC، فأي حساب UTC هنا كان بيسجّل الحجب على تاريخ غلط ويخلي الاختبار fail بس في الفترة دي.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1,$2,'00:00:00','23:59:59','blocked')`,
      [ids.technician, today],
    );
    expect(await classify(null)).toBe('BLOCKED');
  });

  // describeTechnicianCapacity() — نسخة شفافية الأدمن (docs/08 §34.4، ADR-0020 §W)، بترجع سبب
  // مقروء + نطاق أيام بدل تصنيف خام. نفس الفكستشر، بتعيد استخدام ids.technician/today (بتوقيت
  // القاهرة، نفس السبب أعلاه).
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  it('describeTechnicianCapacity: LIGHT — سبب واضح، بلا نطاق أيام مشغول', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = $1`, [ids.technician]);
    await q(`UPDATE technician_schedule_slots SET deleted_at = now() WHERE technician_id = $1`, [ids.technician]);
    const description = await describeTechnicianCapacity(dataSource, {
      technicianId: ids.technician,
      date: today,
      fullDayThresholdMinutes: FULL_DAY_MINUTES,
    });
    expect(description.tier).toBe('LIGHT');
    expect(description.reasonAr.length).toBeGreaterThan(0);
    expect(description.occupiedFrom).toBeNull();
  });

  it('describeTechnicianCapacity: HEAVY — سبب فيه رقم الطلب + نطاق أيام صحيح لمشروع 3 أيام', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = $1`, [ids.technician]);
    const orderId = await insertOrder(OrderStatus.ACCEPTED, { durationDays: 3 });
    const [order] = await q(`SELECT order_number FROM orders WHERE id = $1`, [orderId]);

    const description = await describeTechnicianCapacity(dataSource, {
      technicianId: ids.technician,
      date: today,
      fullDayThresholdMinutes: FULL_DAY_MINUTES,
    });
    expect(description.tier).toBe('HEAVY');
    expect(description.reasonAr).toContain(order.order_number);
    expect(description.occupiedFrom).toBe(today);
    // جمع تقويمي بحت على تاريخ `today` (بتوقيت القاهرة بالفعل) بدل Date.now() UTC خام — نفس سبب
    // إصلاح `today` نفسه أعلاه.
    const expectedTo = new Date(new Date(`${today}T00:00:00Z`).getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect(description.occupiedTo).toBe(expectedTo);
  });

  it('describeTechnicianCapacity: BLOCKED — سبب "حظر بنفسه"، نطاق يوم الحظر بالظبط', async () => {
    await q(`UPDATE orders SET deleted_at = now() WHERE technician_id = $1`, [ids.technician]);
    await q(`UPDATE technician_schedule_slots SET deleted_at = now() WHERE technician_id = $1`, [ids.technician]);
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1,$2,'00:00:00','23:59:59','blocked')`,
      [ids.technician, today],
    );
    const description = await describeTechnicianCapacity(dataSource, {
      technicianId: ids.technician,
      date: today,
      fullDayThresholdMinutes: FULL_DAY_MINUTES,
    });
    expect(description.tier).toBe('BLOCKED');
    expect(description.occupiedFrom).toBe(today);
    expect(description.occupiedTo).toBe(today);
  });
});

// ADR-0057 (تعميق) — بَقّة حقيقية اتلقطت حي: classifyTechnicianCapacity()/describeTechnicianCapacity()
// كانا بيفحصوا `orders.technician_id = X` بس ("الشخص قائد الطلب") — التزام الشخص كـ**عضو طاقم**
// (`order_team_members`، حالة المساعد الطبيعية دايمًا) كان غير مرئي تمامًا. النتيجة: مساعد
// مشغول فعليًا بشغلانتين في نفس اليوم (كعضو طاقم) كان بيصنَّف LIGHT — بالظبط بلاغ المالك
// («مساعد اتضاف لتلات شغلانات كبار، والسيستم ما جابش إن هو شغول»).
describe('classifyTechnicianCapacity — عضوية الطاقم لازم تتحسب زي قيادة الطلب بالظبط (ADR-0057)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36);
  const ids = {
    city: '', zone: '', category: '', service: '',
    leader: '', leaderUser: '', member: '', memberUser: '',
    customer: '', customerUser: '', address: '',
  };
  const orderIds: string[] = [];
  const FULL_DAY_MINUTES = 360;

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The fixture requires the seeded EG country');
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة عضوية ${runId}`,
      `Membership City ${runId}`,
      `member-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      city.id,
      `نطاق عضوية ${runId}`,
      `Membership Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة عضوية ${runId}`,
      `Membership Category ${runId}`,
      `member-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',10000,60) RETURNING id`,
      [category.id, `خدمة عضوية ${runId}`, `member-service-${runId}`],
    );
    ids.service = service.id;

    const [leaderUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+203${runId}`.slice(0, 14),
      `قائد عضوية ${runId}`,
    ]);
    ids.leaderUser = leaderUser.id;
    const [leader] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status, current_location)
       VALUES ($1,$2,'approved', ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [leaderUser.id, `MEMLD${runId}`.slice(0, 20)],
    );
    ids.leader = leader.id;

    const [memberUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+204${runId}`.slice(0, 14),
      `مساعد عضوية ${runId}`,
    ]);
    ids.memberUser = memberUser.id;
    const [member] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status, technician_kind, current_location)
       VALUES ($1,$2,'approved','assistant', ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [memberUser.id, `MEMAS${runId}`.slice(0, 20)],
    );
    ids.member = member.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+205${runId}`.slice(0, 14),
      `عميل عضوية ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customer = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [customerUser.id, `شارع عضوية ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM order_team_members WHERE order_id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [[ids.leader, ids.member]]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customer]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.leaderUser, ids.memberUser, ids.customerUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('LIGHT قبل أي التزام — الأساس اللي هنقيس عليه', async () => {
    const tier = await classifyTechnicianCapacity(dataSource, {
      technicianId: ids.member,
      scheduledAt: null,
      excludeOrderId: null,
      serviceDurationMinutes: 60,
      fullDayThresholdMinutes: FULL_DAY_MINUTES,
    });
    expect(tier).toBe('LIGHT');
  });

  it('MEANINGFUL/HEAVY — عضو طاقم (مساعد) على طلب حد تاني نفس اليوم، بالظبط زي القائد', async () => {
    // طلب طوله ساعة بس (مش شاغل يوم كامل) — عشان نتأكد الالتزام اتحسب أصلاً كـ"عضو"، مش قائد.
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted',10000, now()) RETURNING id`,
      [`MEMB-1-${runId}`.slice(0, 24), ids.customer, ids.leader, ids.service, ids.address, ids.zone],
    );
    orderIds.push(order.id as string);
    // العضو (مساعد) بيتضاف كعضو طاقم — مش orders.technician_id، ده بالظبط شكل التزام المساعد
    // الطبيعي في الإنتاج.
    await q(`INSERT INTO order_team_members (order_id, technician_id, role_label, added_by_technician_id, member_type) VALUES ($1,$2,$3,$4,$5)`, [
      order.id,
      ids.member,
      'مساعد',
      ids.leader,
      'assistant',
    ]);

    const tier = await classifyTechnicianCapacity(dataSource, {
      technicianId: ids.member,
      scheduledAt: null,
      excludeOrderId: null,
      serviceDurationMinutes: 60,
      fullDayThresholdMinutes: FULL_DAY_MINUTES,
    });
    expect(['MEANINGFUL', 'HEAVY']).toContain(tier);

    // نفس الالتزام بالظبط لازم يُحسب لو الشخص هو القائد بدل ما يكون عضو — إثبات إن قاعدة
    // "التزام حقيقي" واحدة موحّدة، مش قاعدتين مختلفتين للدورين.
    await q(`DELETE FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [order.id, ids.member]);
    await q(`UPDATE orders SET technician_id = $1 WHERE id = $2`, [ids.member, order.id]);
    const tierAsLeader = await classifyTechnicianCapacity(dataSource, {
      technicianId: ids.member,
      scheduledAt: null,
      excludeOrderId: null,
      serviceDurationMinutes: 60,
      fullDayThresholdMinutes: FULL_DAY_MINUTES,
    });
    expect(tierAsLeader).toBe(tier);

    // رجّع الحالة زي ما كانت — الاختبار ده بيسيب الطلب موجود لحد afterAll، وباقي الاختبارات
    // في الملف بتفترض ids.member نضيف من أي التزام لسه ما بيتحققش صراحة.
    await q(`UPDATE orders SET technician_id = $1 WHERE id = $2`, [ids.leader, order.id]);
  });

  it('عضو طاقم على طلب اتلغى/اتشال مايتحسبش خالص — مصدر الحقيقة هو الصف الحالي بس', async () => {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted',10000, now()) RETURNING id`,
      [`MEMB-2-${runId}`.slice(0, 24), ids.customer, ids.leader, ids.service, ids.address, ids.zone],
    );
    orderIds.push(order.id as string);
    await q(`INSERT INTO order_team_members (order_id, technician_id, role_label, added_by_technician_id, member_type) VALUES ($1,$2,$3,$4,$5)`, [
      order.id,
      ids.member,
      'مساعد',
      ids.leader,
      'assistant',
    ]);
    // الأدمن/القائد أزال العضو ده من الطاقم — الصف بيتحذف فعليًا (order_team_members مفيهوش
    // soft-delete)، فمفروض الالتزام يختفي معاه فورًا.
    await q(`DELETE FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [order.id, ids.member]);

    const tier = await classifyTechnicianCapacity(dataSource, {
      technicianId: ids.member,
      scheduledAt: null,
      excludeOrderId: null,
      serviceDurationMinutes: 60,
      fullDayThresholdMinutes: FULL_DAY_MINUTES,
    });
    expect(tier).toBe('LIGHT');
  });
});
