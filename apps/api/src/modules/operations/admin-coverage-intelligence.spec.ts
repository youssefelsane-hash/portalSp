import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { OrderStatus } from '../orders/entities/order.entity';
import { AdminCoverageIntelligenceService } from './admin-coverage-intelligence.service';

const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback } as unknown as SettingsService;

// اختبار حي — ذكاء تغطية القوى العاملة (docs/08 §36.10). كل صف بيتحقّق ضد Postgres حقيقي —
// عرض (تصنيف قدرة حقيقي) وطلب (dispatch pending حقيقي) لكل زوج (منطقة، فئة).
describe('AdminCoverageIntelligenceService.getCoverage() (docs/08 §36.10)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = {
    country: '',
    city: '',
    zoneA: '',
    zoneB: '',
    zoneC: '',
    categoryA: '',
    serviceA: '',
    customerProfile: '',
    address: '',
  };
  const users: string[] = [];
  const technicianProfiles: string[] = [];
  const orderIds: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  function service() {
    return new AdminCoverageIntelligenceService(dataSource, settingsServiceStub);
  }

  async function insertTechnician(label: string, zoneId: string) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+21${String(users.length).padStart(2, '0')}${runId}`.slice(0, 15),
      `فني تغطية ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,'new','approved',true) RETURNING id`,
      [user.id, `OPSCOV${label}${runId}`.slice(0, 20)],
    );
    technicianProfiles.push(profile.id);
    await q(
      `INSERT INTO technician_categories (technician_id, category_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`,
      [profile.id, ids.categoryA],
    );
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profile.id, zoneId]);
    return profile.id as string;
  }

  async function insertOrder(opts: { zoneId: string; technicianId?: string; orderStatus: OrderStatus }) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',30000,0) RETURNING id`,
      [
        `TESTCOV-${randomUUID().slice(0, 8)}`,
        ids.customerProfile,
        opts.technicianId ?? null,
        ids.serviceA,
        ids.address,
        opts.zoneId,
        opts.orderStatus,
      ],
    );
    orderIds.push(order.id);
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
      `مدينة تغطية ${runId}`,
      `Coverage City ${runId}`,
      `test-cov-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zoneA] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تغطية أ ${runId}`,
      `Coverage Zone A ${runId}`,
    ]);
    ids.zoneA = zoneA.id;
    const [zoneB] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تغطية ب ${runId}`,
      `Coverage Zone B ${runId}`,
    ]);
    ids.zoneB = zoneB.id;
    const [zoneC] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تغطية ج ${runId}`,
      `Coverage Zone C ${runId}`,
    ]);
    ids.zoneC = zoneC.id;
    const [categoryA] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تغطية ${runId}`,
      `Coverage Category ${runId}`,
      `test-cov-cat-${runId}`,
    ]);
    ids.categoryA = categoryA.id;
    const [serviceA] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',30000,20,0,60) RETURNING id`,
      [ids.categoryA, `خدمة تغطية ${runId}`, `test-cov-svc-${runId}`],
    );
    ids.serviceA = serviceA.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2065${runId}`.slice(0, 15),
      `عميل تغطية ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع تغطية ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      if (orderIds.length) await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM technician_categories WHERE technician_id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.serviceA]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.categoryA]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1)`, [[ids.zoneA, ids.zoneB, ids.zoneC]]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  }, 15000);

  it('فني LIGHT واحد بلا طلبات بتدوّر — healthy', async () => {
    await insertTechnician('healthy', ids.zoneA);

    const { items } = await service().getCoverage({ categoryId: ids.categoryA, zoneId: ids.zoneA, page: 1, perPage: 50 });
    const row = items.find((r) => r.zoneId === ids.zoneA)!;
    expect(row.techniciansLight).toBeGreaterThanOrEqual(1);
    expect(row.dispatchPendingCount).toBe(0);
    expect(row.coverageStatus).toBe('healthy');
  });

  it('صفر فني خالص + طلب بيدوّر — critical (أخطر حالة، لازم تظهر رغم صفر فني)', async () => {
    await insertOrder({ zoneId: ids.zoneB, orderStatus: OrderStatus.SEARCHING_TECHNICIAN });

    const { items } = await service().getCoverage({ categoryId: ids.categoryA, zoneId: ids.zoneB, page: 1, perPage: 50 });
    const row = items.find((r) => r.zoneId === ids.zoneB)!;
    expect(row).toBeDefined();
    expect(row.techniciansTotal).toBe(0);
    expect(row.dispatchPendingCount).toBeGreaterThanOrEqual(1);
    expect(row.coverageStatus).toBe('critical');
  });

  it('طلبات بتدوّر أكتر من الفنيين المتاحين — tight', async () => {
    const tech = await insertTechnician('tight', ids.zoneC);
    await insertOrder({ zoneId: ids.zoneC, orderStatus: OrderStatus.SEARCHING_TECHNICIAN });
    await insertOrder({ zoneId: ids.zoneC, orderStatus: OrderStatus.AWAITING_TECHNICIAN_RESELECTION });
    // شغّل الفني (MEANINGFUL) عشان يبقى فني متاح واحد بس مقابل طلبين بيدوروا.
    await insertOrder({ zoneId: ids.zoneC, technicianId: tech, orderStatus: OrderStatus.ACCEPTED });

    const { items } = await service().getCoverage({ categoryId: ids.categoryA, zoneId: ids.zoneC, page: 1, perPage: 50 });
    const row = items.find((r) => r.zoneId === ids.zoneC)!;
    expect(row.dispatchPendingCount).toBe(2);
    expect(row.techniciansLight + row.techniciansMeaningful).toBe(1);
    expect(row.coverageStatus).toBe('tight');
  });

  it('ترقيم الصفحات (meta.total) بيعكس العدد الكلي الحقيقي', async () => {
    const full = await service().getCoverage({ categoryId: ids.categoryA, page: 1, perPage: 1000 });
    const paged = await service().getCoverage({ categoryId: ids.categoryA, page: 1, perPage: 1 });
    expect(paged.meta.total).toBe(full.meta.total);
    expect(paged.items).toHaveLength(1);
  });
});
