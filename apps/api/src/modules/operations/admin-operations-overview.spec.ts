import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { OrderStatus } from '../orders/entities/order.entity';
import { AdminOperationsOverviewService } from './admin-operations-overview.service';

// نفس افتراض full_day_job_minutes الحقيقي في migration 0153 — settingsServiceStub بيرجّعه دايمًا
// (نفس نمط crew-shortage-escalation.spec.ts).
const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback } as unknown as SettingsService;

// اختبار حي — نظرة عامة تشغيلية (docs/08 §36.2). كل رقم بيتحقّق ضد Postgres حقيقي: طلبات محتاجة
// توزيع، نقص طاقم مفتوح، توزيع القدرة الاستيعابية اليوم (LIGHT/MEANINGFUL/HEAVY/BLOCKED)، وأونلاين
// (عبر registry stub بسيط بدل WebSocket حقيقي — نفس مستوى العزل المستخدم في specs تانية للـ
// activity/online، مش محتاجين اتصال socket فعلي لاختبار الاستعلام نفسه).
describe('AdminOperationsOverviewService.getOverview() (docs/08 §36.2)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = {
    country: '',
    city: '',
    zoneA: '',
    categoryA: '',
    categoryB: '',
    serviceA: '',
    serviceB: '',
    customerProfile: '',
    address: '',
  };
  const users: string[] = [];
  const technicianProfiles: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  function overviewService(onlineUserIds: string[]) {
    return new AdminOperationsOverviewService(dataSource, settingsServiceStub, {
      onlineUserIds: () => onlineUserIds,
    } as never);
  }

  async function insertTechnician(label: string, categoryId: string) {
    // رقم فريد لكل نداء — `runId` وحده (10 حروف) بيملأ حد الـ15 حرف تقريبًا، فأي لاحقة بعده كانت
    // بتتقطع بالـslice وتسبب تصادم unique constraint. عدّاد `users.length` بيضمن تفرّد حقيقي.
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+20${String(users.length).padStart(2, '0')}${runId}`.slice(0, 15),
      `فني عمليات ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,'new','approved',true) RETURNING id`,
      [user.id, `OPSOV${label}${runId}`.slice(0, 20)],
    );
    technicianProfiles.push(profile.id);
    await q(
      `INSERT INTO technician_categories (technician_id, category_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`,
      [profile.id, categoryId],
    );
    return { userId: user.id as string, profileId: profile.id as string };
  }

  async function insertOrder(opts: {
    label: string;
    technicianId: string | null;
    serviceId: string;
    orderStatus: OrderStatus;
    crewShortageEscalated?: boolean;
    scheduledToday?: boolean;
  }) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, scheduled_at, crew_shortage_escalated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',30000,0,$8,$9) RETURNING id`,
      [
        `TESTOPS-${opts.label}`.slice(0, 24),
        ids.customerProfile,
        opts.technicianId,
        opts.serviceId,
        ids.address,
        ids.zoneA,
        opts.orderStatus,
        opts.scheduledToday === false ? null : new Date(),
        opts.crewShortageEscalated ? new Date() : null,
      ],
    );
    return order.id as string;
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
      `مدينة عمليات ${runId}`,
      `Ops City ${runId}`,
      `test-ops-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zoneA] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق عمليات ${runId}`,
      `Ops Zone ${runId}`,
    ]);
    ids.zoneA = zoneA.id;
    const [categoryA] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة عمليات أ ${runId}`,
      `Ops Category A ${runId}`,
      `test-ops-cat-a-${runId}`,
    ]);
    ids.categoryA = categoryA.id;
    const [categoryB] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة عمليات ب ${runId}`,
      `Ops Category B ${runId}`,
      `test-ops-cat-b-${runId}`,
    ]);
    ids.categoryB = categoryB.id;
    const [serviceA] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',30000,20,0,60) RETURNING id`,
      [ids.categoryA, `خدمة عمليات أ ${runId}`, `test-ops-svc-a-${runId}`],
    );
    ids.serviceA = serviceA.id;
    const [serviceB] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',30000,20,0,60) RETURNING id`,
      [ids.categoryB, `خدمة عمليات ب ${runId}`, `test-ops-svc-b-${runId}`],
    );
    ids.serviceB = serviceB.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2061${runId}`.slice(0, 15),
      `عميل عمليات ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع عمليات ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTOPS-%`]);
      await q(`DELETE FROM technician_categories WHERE technician_id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.serviceA, ids.serviceB]]);
      await q(`DELETE FROM service_categories WHERE id = ANY($1)`, [[ids.categoryA, ids.categoryB]]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zoneA]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  }, 15000);

  it('dispatch_pending_count بيعدّ SEARCHING_TECHNICIAN وAWAITING_TECHNICIAN_RESELECTION بس', async () => {
    await insertOrder({ label: 'searching-1', technicianId: null, serviceId: ids.serviceA, orderStatus: OrderStatus.SEARCHING_TECHNICIAN });
    await insertOrder({
      label: 'reselect-1',
      technicianId: null,
      serviceId: ids.serviceA,
      orderStatus: OrderStatus.AWAITING_TECHNICIAN_RESELECTION,
    });
    await insertOrder({ label: 'completed-1', technicianId: null, serviceId: ids.serviceA, orderStatus: OrderStatus.COMPLETED });

    const overview = await overviewService([]).getOverview({ categoryId: ids.categoryA });
    expect(overview.dispatchPendingCount).toBe(2);
  });

  it('crew_shortage_open_count بيعدّ الطلبات المُصعَّدة اللي لسه في حالة قابلة للتصعيد بس', async () => {
    await insertOrder({
      label: 'crew-open-1',
      technicianId: null,
      serviceId: ids.serviceA,
      orderStatus: OrderStatus.TECHNICIAN_ASSIGNED,
      crewShortageEscalated: true,
    });
    await insertOrder({
      label: 'crew-closed-1',
      technicianId: null,
      serviceId: ids.serviceA,
      orderStatus: OrderStatus.COMPLETED,
      crewShortageEscalated: true,
    });

    const overview = await overviewService([]).getOverview({ categoryId: ids.categoryA });
    expect(overview.crewShortageOpenCount).toBe(1);
  });

  it('فلتر category_id بيفصل بين فئتين مختلفتين تمامًا', async () => {
    await insertOrder({ label: 'cat-a', technicianId: null, serviceId: ids.serviceA, orderStatus: OrderStatus.SEARCHING_TECHNICIAN });
    await insertOrder({ label: 'cat-b', technicianId: null, serviceId: ids.serviceB, orderStatus: OrderStatus.SEARCHING_TECHNICIAN });

    const overviewA = await overviewService([]).getOverview({ categoryId: ids.categoryA });
    const overviewB = await overviewService([]).getOverview({ categoryId: ids.categoryB });
    // كل فئة شافت طلبها بس، مش طلب الفئة التانية.
    expect(overviewA.dispatchPendingCount).toBeGreaterThanOrEqual(1);
    expect(overviewB.dispatchPendingCount).toBe(1);
  });

  it('capacity_today — فني من غير طلبات النهاردة بيتصنّف LIGHT', async () => {
    const tech = await insertTechnician('light', ids.categoryA);
    const overview = await overviewService([]).getOverview({ categoryId: ids.categoryA });
    expect(overview.capacityToday.light).toBeGreaterThanOrEqual(1);
    expect(tech.profileId).toBeTruthy();
  });

  it('capacity_today — فني عنده طلب ENGAGED (in_progress) النهاردة بيتصنّف HEAVY', async () => {
    const tech = await insertTechnician('heavy', ids.categoryA);
    await insertOrder({ label: 'heavy-order', technicianId: tech.profileId, serviceId: ids.serviceA, orderStatus: OrderStatus.IN_PROGRESS });

    const overview = await overviewService([]).getOverview({ categoryId: ids.categoryA });
    expect(overview.capacityToday.heavy).toBeGreaterThanOrEqual(1);
  });

  it('capacity_today — فني عنده طلب ACCEPTED خفيف النهاردة (مش ENGAGED) بيتصنّف MEANINGFUL', async () => {
    const tech = await insertTechnician('meaningful', ids.categoryA);
    await insertOrder({ label: 'meaningful-order', technicianId: tech.profileId, serviceId: ids.serviceA, orderStatus: OrderStatus.ACCEPTED });

    const overview = await overviewService([]).getOverview({ categoryId: ids.categoryA });
    expect(overview.capacityToday.meaningful).toBeGreaterThanOrEqual(1);
  });

  it('capacity_today — فني حاظر النهاردة صراحة بيتصنّف BLOCKED', async () => {
    const tech = await insertTechnician('blocked', ids.categoryA);
    // CURRENT_DATE بيتحسب بتوقيت جلسة Postgres (UTC عادةً)، لكن classifyTechnicianCapacity()
    // بتحسب "اليوم" بتوقيت القاهرة (technician-eligibility.sql.ts) — لازم نفس التحويل هنا.
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, (now() AT TIME ZONE 'Africa/Cairo')::date, '00:00', '23:59', 'blocked')`,
      [tech.profileId],
    );

    const overview = await overviewService([]).getOverview({ categoryId: ids.categoryA });
    expect(overview.capacityToday.blocked).toBeGreaterThanOrEqual(1);
  });

  it('technicians_online_count بيعدّ بس اليوزرز الموجودين في onlineUserIds()', async () => {
    const tech = await insertTechnician('online', ids.categoryA);
    const overviewOnline = await overviewService([tech.userId]).getOverview({ categoryId: ids.categoryA });
    const overviewOffline = await overviewService([randomUUID()]).getOverview({ categoryId: ids.categoryA });
    expect(overviewOnline.techniciansOnlineCount).toBeGreaterThanOrEqual(1);
    expect(overviewOffline.techniciansOnlineCount).toBe(0);
  });
});
