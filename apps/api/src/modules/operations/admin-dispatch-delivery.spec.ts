import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AdminDispatchDeliveryService } from './admin-dispatch-delivery.service';

// اختبار حي — مراقبة تسليم الطلبات (docs/08 §36.7). بيتحقّق من order_assignments +
// technician_work_opportunities الحقيقيين، بلا أي بيانات تسليم مصطنعة.
describe('AdminDispatchDeliveryService.getDeliveryObservability() (docs/08 §36.7)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = {
    country: '',
    city: '',
    zoneA: '',
    zoneB: '',
    categoryA: '',
    categoryB: '',
    serviceA: '',
    serviceB: '',
    customerProfile: '',
    address: '',
  };
  const users: string[] = [];
  const technicianProfiles: string[] = [];
  const orderIds: string[] = [];
  const assignmentIds: string[] = [];
  const workOpportunityIds: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  function service() {
    return new AdminDispatchDeliveryService(dataSource);
  }

  async function insertTechnician(label: string) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+21${String(users.length).padStart(2, '0')}${runId}`.slice(0, 15),
      `فني تسليم ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,'new','approved',true) RETURNING id`,
      [user.id, `OPSDD${label}${runId}`.slice(0, 20)],
    );
    technicianProfiles.push(profile.id);
    return profile.id as string;
  }

  async function insertOrder(categoryId: string, serviceId: string, zoneId: string) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,'searching_technician','pending',30000,0) RETURNING id`,
      [`TESTDD-${randomUUID().slice(0, 8)}`, ids.customerProfile, serviceId, ids.address, zoneId],
    );
    orderIds.push(order.id);
    return order.id as string;
  }

  async function insertAssignment(opts: {
    orderId: string;
    technicianId: string;
    status: 'sent' | 'viewed' | 'accepted' | 'rejected' | 'timeout' | 'cancelled';
    sentAgoMinutes: number;
    expiresInMinutes: number;
  }) {
    const [row] = await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,$3, now() - ($4::text || ' minutes')::interval, now() + ($5::text || ' minutes')::interval)
       RETURNING id`,
      [opts.orderId, opts.technicianId, opts.status, opts.sentAgoMinutes, opts.expiresInMinutes],
    );
    assignmentIds.push(row.id);
    return row.id as string;
  }

  async function insertWorkOpportunity(opts: {
    orderId: string;
    technicianId: string;
    status: 'offered' | 'accepted' | 'declined' | 'closed';
    offeredAgoMinutes: number;
    context?: 'assignment' | 'crew_recruit';
  }) {
    const [row] = await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, capacity_tier_at_offer, status, context, offered_at)
       VALUES ($1,$2,'MEANINGFUL',$3,$4, now() - ($5::text || ' minutes')::interval)
       RETURNING id`,
      [opts.orderId, opts.technicianId, opts.status, opts.context ?? 'assignment', opts.offeredAgoMinutes],
    );
    workOpportunityIds.push(row.id);
    return row.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak' });
    await dataSource.initialize();

    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة تسليم ${runId}`,
      `Delivery City ${runId}`,
      `test-dd-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zoneA] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تسليم أ ${runId}`,
      `Delivery Zone A ${runId}`,
    ]);
    ids.zoneA = zoneA.id;
    const [zoneB] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تسليم ب ${runId}`,
      `Delivery Zone B ${runId}`,
    ]);
    ids.zoneB = zoneB.id;
    const [categoryA] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تسليم أ ${runId}`,
      `Delivery Category A ${runId}`,
      `test-dd-cat-a-${runId}`,
    ]);
    ids.categoryA = categoryA.id;
    const [categoryB] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تسليم ب ${runId}`,
      `Delivery Category B ${runId}`,
      `test-dd-cat-b-${runId}`,
    ]);
    ids.categoryB = categoryB.id;
    const [serviceA] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'formula',30000,20,0,60) RETURNING id`,
      [ids.categoryA, `خدمة تسليم أ ${runId}`, `test-dd-svc-a-${runId}`],
    );
    ids.serviceA = serviceA.id;
    const [serviceB] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'formula',30000,20,0,60) RETURNING id`,
      [ids.categoryB, `خدمة تسليم ب ${runId}`, `test-dd-svc-b-${runId}`],
    );
    ids.serviceB = serviceB.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2063${runId}`.slice(0, 15),
      `عميل تسليم ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع تسليم ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      if (assignmentIds.length) await q(`DELETE FROM order_assignments WHERE id = ANY($1::uuid[])`, [assignmentIds]);
      if (workOpportunityIds.length) await q(`DELETE FROM technician_work_opportunities WHERE id = ANY($1::uuid[])`, [workOpportunityIds]);
      if (orderIds.length) await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.serviceA, ids.serviceB]]);
      await q(`DELETE FROM service_categories WHERE id = ANY($1)`, [[ids.categoryA, ids.categoryB]]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1)`, [[ids.zoneA, ids.zoneB]]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  }, 15000);

  it('يعدّ كل حالات order_assignments الحقيقية الست صح', async () => {
    const tech = await insertTechnician('states');
    const order = await insertOrder(ids.categoryA, ids.serviceA, ids.zoneA);
    await insertAssignment({ orderId: order, technicianId: tech, status: 'sent', sentAgoMinutes: 1, expiresInMinutes: 10 });
    await insertAssignment({ orderId: order, technicianId: tech, status: 'viewed', sentAgoMinutes: 2, expiresInMinutes: 10 });
    await insertAssignment({ orderId: order, technicianId: tech, status: 'accepted', sentAgoMinutes: 3, expiresInMinutes: 10 });
    await insertAssignment({ orderId: order, technicianId: tech, status: 'rejected', sentAgoMinutes: 4, expiresInMinutes: 10 });
    await insertAssignment({ orderId: order, technicianId: tech, status: 'timeout', sentAgoMinutes: 5, expiresInMinutes: 10 });
    await insertAssignment({ orderId: order, technicianId: tech, status: 'cancelled', sentAgoMinutes: 6, expiresInMinutes: 10 });

    const { summary, feed } = await service().getDeliveryObservability({
      categoryId: ids.categoryA,
      hours: 24,
      page: 1,
      perPage: 50,
    });
    expect(summary.assignments).toMatchObject({ sent: 1, viewed: 1, accepted: 1, rejected: 1, timeout: 1, cancelled: 1 });
    expect(feed.items.filter((i) => i.kind === 'assignment')).toHaveLength(6);
  });

  it('assignment لسه sent وعدّى معاده — stale_sent_count + is_stale=true', async () => {
    const tech = await insertTechnician('stale');
    const order = await insertOrder(ids.categoryA, ids.serviceA, ids.zoneA);
    const assignmentId = await insertAssignment({ orderId: order, technicianId: tech, status: 'sent', sentAgoMinutes: 20, expiresInMinutes: -5 });

    const { summary, feed } = await service().getDeliveryObservability({
      categoryId: ids.categoryA,
      hours: 24,
      page: 1,
      perPage: 50,
    });
    expect(summary.assignments.staleSentCount).toBeGreaterThanOrEqual(1);
    const row = feed.items.find((i) => i.id === assignmentId)!;
    expect(row.isStale).toBe(true);
  });

  // docs/08 §72 (بلاغ مالك: «الطلب لما يتبعت لكذا حد ما بيبانليش اتبعت لكام»).
  it('كل صف بيحمل رقم الطلب وعدد الفنيين المختلفين اللي الطلب اتبعتلهم إجماليًا', async () => {
    const techA = await insertTechnician('fanout-a');
    const techB = await insertTechnician('fanout-b');
    const techC = await insertTechnician('fanout-c');
    const order = await insertOrder(ids.categoryB, ids.serviceB, ids.zoneB);
    const [{ order_number: orderNumber }] = await q(`SELECT order_number FROM orders WHERE id = $1`, [order]);

    const assignmentId = await insertAssignment({ orderId: order, technicianId: techA, status: 'sent', sentAgoMinutes: 3, expiresInMinutes: 10 });
    await insertAssignment({ orderId: order, technicianId: techB, status: 'rejected', sentAgoMinutes: 4, expiresInMinutes: 10 });
    // نفس الفني في جولة تانية ما يتعدّش مرتين، وفرصة شغل لفني تالت تتعدّ.
    await insertWorkOpportunity({ orderId: order, technicianId: techB, status: 'declined', offeredAgoMinutes: 2 });
    await insertWorkOpportunity({ orderId: order, technicianId: techC, status: 'offered', offeredAgoMinutes: 1 });

    const { feed } = await service().getDeliveryObservability({ categoryId: ids.categoryB, hours: 24, page: 1, perPage: 50 });
    const row = feed.items.find((i) => i.id === assignmentId)!;
    expect(row.orderNumber).toBe(orderNumber);
    expect(row.orderTechnicianCount).toBe(3);
  });

  it('assignment لسه sent وقدام معاده — مش stale', async () => {
    const tech = await insertTechnician('fresh');
    const order = await insertOrder(ids.categoryA, ids.serviceA, ids.zoneA);
    const assignmentId = await insertAssignment({ orderId: order, technicianId: tech, status: 'sent', sentAgoMinutes: 1, expiresInMinutes: 10 });

    const { feed } = await service().getDeliveryObservability({ categoryId: ids.categoryA, hours: 24, page: 1, perPage: 50 });
    const row = feed.items.find((i) => i.id === assignmentId)!;
    expect(row.isStale).toBe(false);
    expect(row.expiresAt).not.toBeNull();
  });

  it('technician_work_opportunities الحقيقية بتتعدّ صح، وexpires_at دايمًا null ليها (مفيش مفهوم انتهاء)', async () => {
    const tech = await insertTechnician('wo');
    const order = await insertOrder(ids.categoryA, ids.serviceA, ids.zoneA);
    await insertWorkOpportunity({ orderId: order, technicianId: tech, status: 'offered', offeredAgoMinutes: 1 });
    await insertWorkOpportunity({ orderId: order, technicianId: tech, status: 'accepted', offeredAgoMinutes: 5 });
    const closedId = await insertWorkOpportunity({
      orderId: order,
      technicianId: tech,
      status: 'closed',
      offeredAgoMinutes: 8,
      context: 'crew_recruit',
    });

    const { summary, feed } = await service().getDeliveryObservability({
      categoryId: ids.categoryA,
      hours: 24,
      page: 1,
      perPage: 50,
    });
    expect(summary.workOpportunities).toMatchObject({ offered: 1, accepted: 1, declined: 0, closed: 1 });
    const row = feed.items.find((i) => i.id === closedId)!;
    expect(row.kind).toBe('work_opportunity');
    expect(row.context).toBe('crew_recruit');
    expect(row.expiresAt).toBeNull();
    expect(row.isStale).toBe(false);
  });

  it('فلتر category_id بيقصر النتيجة على فئة الطلب المرتبط بس', async () => {
    const techA = await insertTechnician('cat-a');
    const techB = await insertTechnician('cat-b');
    const orderA = await insertOrder(ids.categoryA, ids.serviceA, ids.zoneA);
    const orderB = await insertOrder(ids.categoryB, ids.serviceB, ids.zoneA);
    const idA = await insertAssignment({ orderId: orderA, technicianId: techA, status: 'sent', sentAgoMinutes: 1, expiresInMinutes: 10 });
    const idB = await insertAssignment({ orderId: orderB, technicianId: techB, status: 'sent', sentAgoMinutes: 1, expiresInMinutes: 10 });

    const { feed } = await service().getDeliveryObservability({ categoryId: ids.categoryA, hours: 24, page: 1, perPage: 100 });
    const resultIds = feed.items.map((i) => i.id);
    expect(resultIds).toContain(idA);
    expect(resultIds).not.toContain(idB);
  });

  it('فلتر zone_id بيقصر النتيجة على نطاق الطلب المرتبط بس', async () => {
    const techA = await insertTechnician('zone-a');
    const techB = await insertTechnician('zone-b');
    const orderA = await insertOrder(ids.categoryA, ids.serviceA, ids.zoneA);
    const orderB = await insertOrder(ids.categoryA, ids.serviceA, ids.zoneB);
    const idA = await insertAssignment({ orderId: orderA, technicianId: techA, status: 'sent', sentAgoMinutes: 1, expiresInMinutes: 10 });
    const idB = await insertAssignment({ orderId: orderB, technicianId: techB, status: 'sent', sentAgoMinutes: 1, expiresInMinutes: 10 });

    const { feed } = await service().getDeliveryObservability({
      categoryId: ids.categoryA,
      zoneId: ids.zoneA,
      hours: 24,
      page: 1,
      perPage: 100,
    });
    const resultIds = feed.items.map((i) => i.id);
    expect(resultIds).toContain(idA);
    expect(resultIds).not.toContain(idB);
  });

  it('فلتر hours (نافذة الرجوع) بيستبعد صفوف اتبعتت قبل النافذة', async () => {
    const tech = await insertTechnician('old');
    const order = await insertOrder(ids.categoryA, ids.serviceA, ids.zoneA);
    const oldId = await insertAssignment({ orderId: order, technicianId: tech, status: 'sent', sentAgoMinutes: 500, expiresInMinutes: -400 });
    const recentId = await insertAssignment({ orderId: order, technicianId: tech, status: 'sent', sentAgoMinutes: 1, expiresInMinutes: 10 });

    const { feed } = await service().getDeliveryObservability({ categoryId: ids.categoryA, hours: 1, page: 1, perPage: 100 });
    const resultIds = feed.items.map((i) => i.id);
    expect(resultIds).not.toContain(oldId);
    expect(resultIds).toContain(recentId);
  });

  it('ترقيم الصفحات (meta.total) بيعكس العدد الكلي الحقيقي بغض النظر عن per_page', async () => {
    const tech = await insertTechnician('paging');
    const order = await insertOrder(ids.categoryA, ids.serviceA, ids.zoneA);
    await insertAssignment({ orderId: order, technicianId: tech, status: 'sent', sentAgoMinutes: 1, expiresInMinutes: 10 });
    await insertAssignment({ orderId: order, technicianId: tech, status: 'viewed', sentAgoMinutes: 2, expiresInMinutes: 10 });

    const full = await service().getDeliveryObservability({ categoryId: ids.categoryA, hours: 24, page: 1, perPage: 1000 });
    const paged = await service().getDeliveryObservability({ categoryId: ids.categoryA, hours: 24, page: 1, perPage: 1 });
    expect(paged.feed.meta.total).toBe(full.feed.meta.total);
    expect(paged.feed.items).toHaveLength(1);
  });
});
