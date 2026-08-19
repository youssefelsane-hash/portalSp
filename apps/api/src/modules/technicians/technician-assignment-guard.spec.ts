import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { BookingMode, Order, OrderStatus } from '../orders/entities/order.entity';
import { TechnicianAssignmentGuardService } from './technician-assignment-guard.service';
import { TechnicianProfile } from './entities/technician-profile.entity';

// اختبار حي ضد Postgres حقيقي — بيثبت بَقّة حقيقية اتلقطت من بلاغ المالك (2026-08-19): تعيين
// فني له طلب نشط النهاردة لطلب تاني مجدول ليوم بعيد خالص (مثلاً بعد أسبوع) كان بيترفض غلط بحجة
// "الفني عنده طلب نشط بالفعل" أو "خارج الوردية حاليًا" — رغم إن الطلبين في وقتين مختلفين تمامًا
// ومفيش تعارض حقيقي بينهم. الإصلاح: الفحصين دول (isAvailable/isOnDuty والـactive-order) بقوا
// يسريان بس على طلبات ASAP (scheduledAt فاضي) — الطلبات المجدولة بتتفحص بالجدول الحقيقي
// (technician_schedule_slots) اللي أصلاً بيتفحص بتاريخ/وقت صحيح تحت في نفس الميثود.
describe('TechnicianAssignmentGuardService.assertEligible() — طلب مجدول ليوم مختلف لازم يعدي (docs/08، قرار 2026-08-19)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let guard: TechnicianAssignmentGuardService;

  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    technicianUser: '',
    technicianProfile: '',
    customerUser: '',
    customerProfile: '',
    address: '',
  };
  const orderIds: string[] = [];

  async function insertOrder(opts: {
    label: string;
    orderStatus: OrderStatus;
    scheduledAt: Date | null;
    assignedToTechnician?: boolean;
  }) {
    const [order] = await dataSource.query(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,10000,$8) RETURNING id`,
      [
        `TAG-${opts.label}-${runId}`.slice(0, 24),
        ids.customerProfile,
        opts.assignedToTechnician ? ids.technicianProfile : null,
        ids.service,
        ids.address,
        ids.zone,
        opts.orderStatus,
        opts.scheduledAt,
      ],
    );
    orderIds.push(order.id as string);
    return dataSource.getRepository(Order).findOneOrFail({ where: { id: order.id as string } });
  }

  async function setTechnicianOnline(online: boolean) {
    await dataSource.query(`UPDATE technician_profiles SET is_available = $1, is_on_duty = $1 WHERE id = $2`, [online, ids.technicianProfile]);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, TechnicianProfile],
    });
    await dataSource.initialize();
    guard = new TechnicianAssignmentGuardService();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة اختبار ${runId}`, `Test Country ${runId}`, Math.random().toString(36).slice(2, 4).toUpperCase(), '+000', 'EGP'],
    );
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة اختبار ${runId}`,
      `Test City ${runId}`,
      `test-city-tag-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق اختبار ${runId}`,
      `Test Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اختبار ${runId}`,
      `Test Category ${runId}`,
      `test-category-tag-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-tag-${runId}`],
    );
    ids.service = service.id;

    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+201${runId}`.slice(0, 14),
      `فني اختبار ${runId}`,
    ]);
    ids.technicianUser = user.id;
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
       VALUES ($1,$2,'new','approved',true,true,ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.technicianUser, `TAG${runId}`.slice(0, 20)],
    );
    ids.technicianProfile = profile.id;
    await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [ids.technicianProfile, ids.service]);
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [ids.technicianProfile, ids.zone]);

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2019${runId}`.slice(0, 14),
      `عميل اختبار ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM technician_zones WHERE technician_id = $1`, [ids.technicianProfile]);
    await q(`DELETE FROM technician_services WHERE technician_id = $1`, [ids.technicianProfile]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
    await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.customerUser, ids.technicianUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    await dataSource.destroy();
  });

  it('طلب مجدول بعد أسبوع مايترفضش بسبب طلب نشط تاني النهاردة (البَقّة الأساسية)', async () => {
    await insertOrder({ label: 'active-today', orderStatus: OrderStatus.ACCEPTED, scheduledAt: null, assignedToTechnician: true });
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const candidate = await insertOrder({ label: 'scheduled-week', orderStatus: OrderStatus.SEARCHING_TECHNICIAN, scheduledAt: weekFromNow });

    await dataSource.manager.transaction(async (manager) => {
      const technician = await guard.lockTechnician(manager, ids.technicianProfile);
      await expect(guard.assertEligible(manager, technician, candidate)).resolves.toBeUndefined();
    });
  });

  it('طلب مجدول بعد أسبوع مايترفضش لو الفني أوفلاين دلوقتي (isAvailable/isOnDuty=false)', async () => {
    await setTechnicianOnline(false);
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const candidate = await insertOrder({ label: 'scheduled-offline', orderStatus: OrderStatus.SEARCHING_TECHNICIAN, scheduledAt: weekFromNow });

    try {
      await dataSource.manager.transaction(async (manager) => {
        const technician = await guard.lockTechnician(manager, ids.technicianProfile);
        await expect(guard.assertEligible(manager, technician, candidate)).resolves.toBeUndefined();
      });
    } finally {
      await setTechnicianOnline(true);
    }
  });

  it('طلب ASAP (بلا scheduledAt) لسه بيترفض صح لو الفني أوفلاين — مفيش تراجع في السلوك القديم', async () => {
    await setTechnicianOnline(false);
    const candidate = await insertOrder({ label: 'asap-offline', orderStatus: OrderStatus.SEARCHING_TECHNICIAN, scheduledAt: null });

    try {
      await dataSource.manager.transaction(async (manager) => {
        const technician = await guard.lockTechnician(manager, ids.technicianProfile);
        await expect(guard.assertEligible(manager, technician, candidate)).rejects.toBeInstanceOf(ApiException);
      });
    } finally {
      await setTechnicianOnline(true);
    }
  });

  it('طلب ASAP (بلا scheduledAt) لسه بيترفض صح لو الفني عنده طلب نشط تاني — مفيش تراجع في السلوك القديم', async () => {
    // الفني أونلاين دلوقتي، بس عنده طلب "active-today" من الاختبار الأول لسه ACCEPTED.
    const candidate = await insertOrder({ label: 'asap-busy', orderStatus: OrderStatus.SEARCHING_TECHNICIAN, scheduledAt: null });

    await dataSource.manager.transaction(async (manager) => {
      const technician = await guard.lockTechnician(manager, ids.technicianProfile);
      await expect(guard.assertEligible(manager, technician, candidate)).rejects.toBeInstanceOf(ApiException);
    });
  });

  it('طلب طوارئ (EMERGENCY) بلا scheduledAt بيعدي حتى لو الفني أوفلاين — سلوك قديم متأثرش', async () => {
    // فحص "الفني عنده طلب نشط بالفعل" مالوش استثناء طوارئ (مايترفعش أصلاً — نفس السلوك قبل هذا
    // الإصلاح)، فلازم نقفل الطلب النشط من الاختبار الأول الأول عشان نعزل فحص isOnDuty/isAvailable
    // اللي فعلاً عنده استثناء الطوارئ (الفحص اللي إحنا بنتأكد منه هنا تحديدًا).
    await dataSource.query(`UPDATE orders SET order_status = 'completed' WHERE order_number = $1`, [`TAG-active-today-${runId}`.slice(0, 24)]);
    await setTechnicianOnline(false);
    const [order] = await dataSource.query(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,$6,10000,'emergency') RETURNING id`,
      [`TAG-emg-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, OrderStatus.SEARCHING_TECHNICIAN],
    );
    orderIds.push(order.id as string);
    const candidate = await dataSource.getRepository(Order).findOneOrFail({ where: { id: order.id as string } });
    expect(candidate.bookingMode).toBe(BookingMode.EMERGENCY);

    try {
      await dataSource.manager.transaction(async (manager) => {
        const technician = await guard.lockTechnician(manager, ids.technicianProfile);
        await expect(guard.assertEligible(manager, technician, candidate)).resolves.toBeUndefined();
      });
    } finally {
      await setTechnicianOnline(true);
    }
  });
});
