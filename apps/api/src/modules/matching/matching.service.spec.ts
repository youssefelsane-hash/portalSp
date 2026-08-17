import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MatchingService } from './matching.service';
import { Order } from '../orders/entities/order.entity';
import { OrderAssignment } from './entities/order-assignment.entity';

// اختبار حي ضد Postgres حقيقي (نفس فلسفة المشروع: مفيش mocks لاستعلامات SQL خام) — بيثبت
// إصلاح البَقّة الموثّقة: استعلام استبعاد "الفني عنده طلب نشط بالفعل" في findEligibleTechnicians()
// كان بيفحص order_status بس، من غير فلترة deleted_at IS NULL. طلب اتعمله soft-delete لكن
// order_status فضل على قيمة نشطة (accepted) كان بيخلي الفني "محبوس" كمشغول للأبد رغم إن الطلب
// نفسه مش ظاهر لحد. الإصلاح: AND deleted_at IS NULL على نفس الاستعلام (matching.service.ts
// وassistant-matching.service.ts الاتنين).
describe('MatchingService — استبعاد طلب soft-deleted من فحص "الفني مشغول" (regression)', () => {
  let dataSource: DataSource;
  let matchingService: MatchingService;
  let queueAdd: jest.Mock;

  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
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
    blockingOrder: '',
    recoveredOrder: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment],
    });
    await dataSource.initialize();

    // matching.service.ts's findEligibleTechnicians() بتستخدم this.dataSource بس (التبعيات
    // التانية في الـconstructor مش مُستخدمة في الدالة دي) — نفس نمط FakeRepository في
        // auth.service.spec.ts، تركيب يدوي خفيف بدل تشغيل موديول NestJS كامل.
    queueAdd = jest.fn().mockResolvedValue(undefined);
    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      {} as never,
      { getNumber: jest.fn(async (_key: string, fallback: number) => fallback) } as never,
      { emit: jest.fn() } as never,
      { add: queueAdd } as never,
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The matching integration fixture requires the seeded EG country');
    ids.country = country.id;

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-${runId}`],
    );
    ids.city = city.id;

    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق اختبار ${runId}`, `Test Zone ${runId}`],
    );
    ids.zone = zone.id;

    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-${runId}`],
    );
    ids.category = category.id;

    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-${runId}`],
    );
    ids.service = service.id;

    const [technicianUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2010${runId}1`.slice(0, 14), `فني اختبار ${runId}`],
    );
    ids.technicianUser = technicianUser.id;

    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
       VALUES ($1,$2,'new','approved',true,true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography)
       RETURNING id`,
      [ids.technicianUser, `TST${runId}`.slice(0, 20)],
    );
    ids.technicianProfile = technicianProfile.id;

    await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [
      ids.technicianProfile,
      ids.service,
    ]);
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      ids.technicianProfile,
      ids.zone,
    ]);

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2011${runId}1`.slice(0, 14), `عميل اختبار ${runId}`],
    );
    ids.customerUser = customerUser.id;

    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.customerUser,
    ]);
    ids.customerProfile = customerProfile.id;

    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    // الطلب "المشغول" — accepted فعليًا (الحالة النشطة اللي بتستبعد الفني)، وهيتعمله soft-delete
    // في كل test لوحده (مش هنا) عشان الاختبارين يفضلوا مستقلين عن بعض.
    const [blockingOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted') RETURNING id`,
      [`TEST-${runId}`.slice(0, 24), ids.customerProfile, ids.technicianProfile, ids.service, ids.address, ids.zone],
    );
    ids.blockingOrder = blockingOrder.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      if (ids.recoveredOrder) await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.recoveredOrder]);
      if (ids.recoveredOrder) await q(`DELETE FROM orders WHERE id = $1`, [ids.recoveredOrder]);
      if (ids.blockingOrder) await q(`DELETE FROM orders WHERE id = $1`, [ids.blockingOrder]);
      if (ids.technicianProfile) {
        await q(`DELETE FROM technician_zones WHERE technician_id = $1`, [ids.technicianProfile]);
        await q(`DELETE FROM technician_services WHERE technician_id = $1`, [ids.technicianProfile]);
      }
      if (ids.address) await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      if (ids.customerProfile) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (ids.customerUser) await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      if (ids.technicianProfile) await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
      if (ids.technicianUser) await q(`DELETE FROM users WHERE id = $1`, [ids.technicianUser]);
      if (ids.service) await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      if (ids.category) await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      if (ids.zone) await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      if (ids.city) await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  const findCandidates = () => {
    const order = { id: ids.blockingOrder, serviceId: ids.service, serviceZoneId: ids.zone, addressId: ids.address } as Order;
    // findEligibleTechnicians خاصة (private) — بنستدعيها زي ما هي فعليًا (مش نسخة معاد كتابتها)
    // عشان أي تراجع مستقبلي عن الإصلاح يكسر الاختبار ده فورًا.
    return (matchingService as unknown as { findEligibleTechnicians: (...args: unknown[]) => Promise<{ technician_id: string }[]> })
      .findEligibleTechnicians(order, 50, null, false, null);
  };

  it('طلب accepted غير محذوف: الفني بيتستبعد صح (السلوك الأصلي محفوظ)', async () => {
    const candidates = await findCandidates();
    expect(candidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(false);
  });

  it('نفس الطلب بعد soft-delete: الفني مبيتستبعدش — مبقاش "محبوس" كمشغول للأبد', async () => {
    await dataSource.query(`UPDATE orders SET deleted_at = now() WHERE id = $1`, [ids.blockingOrder]);

    const candidates = await findCandidates();
    expect(candidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(true);

    // نرجّع الحالة الأصلية عشان اختبار تاني (لو اتعاد تشغيله) يلاقي نفس السطر الأول.
    await dataSource.query(`UPDATE orders SET deleted_at = NULL WHERE id = $1`, [ids.blockingOrder]);
  });

  it('نداءا recovery متتاليان لنفس الطلب لا ينشئان جولتين بينما العرض الأول ما زال حيًا', async () => {
    await dataSource.query(`UPDATE orders SET deleted_at = now() WHERE id = $1`, [ids.blockingOrder]);
    const [order] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, placed_at)
       VALUES ($1, $2, $3, $4, $5, 'searching_technician', now())
       RETURNING id`,
      [`REC-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    ids.recoveredOrder = order.id;

    await matchingService.dispatchNextRound(ids.recoveredOrder);
    await matchingService.dispatchNextRound(ids.recoveredOrder);

    const [state] = await dataSource.query(
      `SELECT count(*)::integer AS assignment_count,
              max(assignment_round)::integer AS max_round
       FROM order_assignments
       WHERE order_id = $1`,
      [ids.recoveredOrder],
    );
    expect(state).toEqual({ assignment_count: 1, max_round: 1 });
    expect(queueAdd).toHaveBeenCalledTimes(1);

    await dataSource.query(`UPDATE orders SET deleted_at = NULL WHERE id = $1`, [ids.blockingOrder]);
  });
});
