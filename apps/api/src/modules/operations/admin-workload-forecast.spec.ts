import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { OrderStatus } from '../orders/entities/order.entity';
import { AdminWorkloadForecastService } from './admin-workload-forecast.service';

const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback, getBoolean: async (_key: string, fallback: boolean) => fallback } as unknown as SettingsService;

// اختبار حي — عرض الحمل القريب 7 أيام (docs/08 §36.4). كل يوم بيتحقّق ضد Postgres حقيقي بنفس
// أولوية classifyTechnicianCapacity() بالحرف (BLOCKED > HEAVY > MEANINGFUL > LIGHT)، بس bulk
// aggregate لكل الأيام السبعة مرة واحدة.
describe('AdminWorkloadForecastService.getForecast() (docs/08 §36.4)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = {
    country: '',
    city: '',
    zoneA: '',
    zoneB: '',
    categoryA: '',
    serviceA: '',
    customerProfile: '',
    address: '',
  };
  const users: string[] = [];
  const technicianProfiles: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  function forecastService() {
    return new AdminWorkloadForecastService(dataSource, settingsServiceStub);
  }

  async function insertTechnician(label: string, zoneId: string | null) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+21${String(users.length).padStart(2, '0')}${runId}`.slice(0, 15),
      `فني حمل ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,'new','approved',true) RETURNING id`,
      [user.id, `OPSWL${label}${runId}`.slice(0, 20)],
    );
    technicianProfiles.push(profile.id);
    await q(
      `INSERT INTO technician_categories (technician_id, category_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`,
      [profile.id, ids.categoryA],
    );
    if (zoneId) {
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profile.id, zoneId]);
    }
    return { userId: user.id as string, profileId: profile.id as string };
  }

  /** طلب مجدول لليوم رقم dayOffset من "النهاردة" (بتوقيت القاهرة، الساعة 12 ظهرًا — بعيد عن حدود منتصف الليل). */
  async function insertOrder(opts: {
    label: string;
    technicianId: string;
    orderStatus: OrderStatus;
    dayOffset: number;
    estimatedDurationDays?: number;
  }) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, scheduled_at, estimated_duration_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',30000,0,
         (((now() AT TIME ZONE 'Africa/Cairo')::date + ($8::int * INTERVAL '1 day') + INTERVAL '12 hours') AT TIME ZONE 'Africa/Cairo'),
         $9)
       RETURNING id`,
      [
        `TESTWL-${opts.label}`.slice(0, 24),
        ids.customerProfile,
        opts.technicianId,
        ids.serviceA,
        ids.address,
        ids.zoneA,
        opts.orderStatus,
        opts.dayOffset,
        opts.estimatedDurationDays ?? null,
      ],
    );
    return order.id as string;
  }

  async function blockDay(technicianId: string, dayOffset: number) {
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, (now() AT TIME ZONE 'Africa/Cairo')::date + $2::int, '00:00', '23:59', 'blocked')`,
      [technicianId, dayOffset],
    );
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
      `مدينة حمل ${runId}`,
      `Workload City ${runId}`,
      `test-wl-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zoneA] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق حمل أ ${runId}`,
      `Workload Zone A ${runId}`,
    ]);
    ids.zoneA = zoneA.id;
    const [zoneB] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق حمل ب ${runId}`,
      `Workload Zone B ${runId}`,
    ]);
    ids.zoneB = zoneB.id;
    const [categoryA] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة حمل ${runId}`,
      `Workload Category ${runId}`,
      `test-wl-cat-${runId}`,
    ]);
    ids.categoryA = categoryA.id;
    const [serviceA] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',30000,20,0,60) RETURNING id`,
      [ids.categoryA, `خدمة حمل ${runId}`, `test-wl-svc-${runId}`],
    );
    ids.serviceA = serviceA.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2062${runId}`.slice(0, 15),
      `عميل حمل ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع حمل ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTWL-%`]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM technician_categories WHERE technician_id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.serviceA]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.categoryA]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1)`, [[ids.zoneA, ids.zoneB]]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  }, 15000);

  it('فني من غير أي طلب/حظر — كل الـ7 أيام LIGHT', async () => {
    const tech = await insertTechnician('free', ids.zoneA);
    const { items } = await forecastService().getForecast({ categoryId: ids.categoryA, page: 1, perPage: 50 });
    const row = items.find((r) => r.id === tech.profileId)!;
    expect(row.days).toHaveLength(7);
    expect(row.days.every((d) => d.tier === 'LIGHT' && !d.isMultiDay)).toBe(true);
  });

  it('طلب ACCEPTED خفيف يوم 3 — اليوم ده بس MEANINGFUL، الباقي LIGHT', async () => {
    const tech = await insertTechnician('meaningful', ids.zoneA);
    await insertOrder({ label: 'meaningful-3', technicianId: tech.profileId, orderStatus: OrderStatus.ACCEPTED, dayOffset: 3 });

    const { items } = await forecastService().getForecast({ categoryId: ids.categoryA, page: 1, perPage: 50 });
    const row = items.find((r) => r.id === tech.profileId)!;
    expect(row.days[3].tier).toBe('MEANINGFUL');
    expect(row.days.filter((_, i) => i !== 3).every((d) => d.tier === 'LIGHT')).toBe(true);
  });

  it('طلب IN_PROGRESS يوم 0 (النهاردة) — HEAVY (انشغال جسدي فعلي)', async () => {
    const tech = await insertTechnician('heavy-today', ids.zoneA);
    await insertOrder({ label: 'heavy-today', technicianId: tech.profileId, orderStatus: OrderStatus.IN_PROGRESS, dayOffset: 0 });

    const { items } = await forecastService().getForecast({ categoryId: ids.categoryA, page: 1, perPage: 50 });
    const row = items.find((r) => r.id === tech.profileId)!;
    expect(row.days[0].tier).toBe('HEAVY');
  });

  it('طلب ACCEPTED مدته يومين (estimated_duration_days=2) يوم 1 — HEAVY + is_multi_day=true يوم البداية بس', async () => {
    const tech = await insertTechnician('multiday', ids.zoneA);
    await insertOrder({
      label: 'multiday-1',
      technicianId: tech.profileId,
      orderStatus: OrderStatus.ACCEPTED,
      dayOffset: 1,
      estimatedDurationDays: 2,
    });

    const { items } = await forecastService().getForecast({ categoryId: ids.categoryA, page: 1, perPage: 50 });
    const row = items.find((r) => r.id === tech.profileId)!;
    expect(row.days[1]).toMatchObject({ tier: 'HEAVY', isMultiDay: true });
    // اكتشاف مهم موثّق في admin-workload-forecast.service.ts: اليوم التاني (day2) مش محسوب busy
    // تلقائيًا — محرك المطابقة الحقيقي (classifyTechnicianCapacity) مابيعملش date-range spanning،
    // بيفحص scheduled_at::date بس. الاختبار ده بيقفل السلوك الحالي صراحة، مش يصلّحه ضمنيًا.
    expect(row.days[2]).toMatchObject({ tier: 'LIGHT', isMultiDay: false });
  });

  it('حظر صريح يوم 5 بياخد أولوية BLOCKED حتى لو فيه طلب تاني نفس اليوم', async () => {
    const tech = await insertTechnician('blocked', ids.zoneA);
    await insertOrder({ label: 'blocked-order', technicianId: tech.profileId, orderStatus: OrderStatus.ACCEPTED, dayOffset: 5 });
    await blockDay(tech.profileId, 5);

    const { items } = await forecastService().getForecast({ categoryId: ids.categoryA, page: 1, perPage: 50 });
    const row = items.find((r) => r.id === tech.profileId)!;
    expect(row.days[5].tier).toBe('BLOCKED');
  });

  it('فلتر zone_id بيقصر النتيجة على فنيين النطاق ده بس', async () => {
    const techA = await insertTechnician('zone-a', ids.zoneA);
    const techB = await insertTechnician('zone-b', ids.zoneB);

    const { items } = await forecastService().getForecast({ categoryId: ids.categoryA, zoneId: ids.zoneA, page: 1, perPage: 100 });
    const resultIds = items.map((r) => r.id);
    expect(resultIds).toContain(techA.profileId);
    expect(resultIds).not.toContain(techB.profileId);
  });

  it('ترقيم الصفحات (meta.total) بيعكس العدد الكلي الحقيقي بغض النظر عن per_page', async () => {
    const full = await forecastService().getForecast({ categoryId: ids.categoryA, page: 1, perPage: 1000 });
    const paged = await forecastService().getForecast({ categoryId: ids.categoryA, page: 1, perPage: 2 });
    expect(paged.meta.total).toBe(full.meta.total);
    expect(paged.items).toHaveLength(2);
  });
});
