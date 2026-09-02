import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { BookingMode, Order, OrderStatus } from '../orders/entities/order.entity';
import { TechnicianAssignmentGuardService } from './technician-assignment-guard.service';
import { TechnicianProfile } from './entities/technician-profile.entity';

// اختبار حي ضد Postgres حقيقي — بيثبت بَقّتين حقيقيتين اتلقطوا من بلاغات المالك:
// (2026-08-19) تعيين فني له طلب نشط النهاردة لطلب تاني مجدول ليوم بعيد خالص (مثلاً بعد أسبوع)
// كان بيترفض غلط بحجة "الفني عنده طلب نشط بالفعل" — رغم إن الطلبين في يومين مختلفين تمامًا
// ومفيش تعارض حقيقي بينهم؛
// (2026-08-20، docs/08 §32) عكسها بالظبط لطلبات ASAP نفس اليوم — كان أي طلب accepted نشط
// (حتى لو قصير ولسه ما بدأش) بيستبعد الفني من *أي* طلب ASAP جديد، رغم إن نفس الفني كان مؤهّل
// تمامًا لطلب مجدول لنفس اليوم بالظبط. الإصلاح الموحّد: ASAP بقى يتبع بالحرف نفس قاعدة الطلب
// المجدول (يوم = النهاردة) — استبعاد بس لو (أ) الفني منشغل جسديًا فعليًا دلوقتي، أو (ب) فيه
// تعارض يوم كامل حقيقي. isAvailable/isOnDuty مش متفحوصين خالص هنا (ADR-0017 بند 3 — اتشالوا
// من الأهلية بالكامل، الفني متاح افتراضيًا Opt-out).
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
  let activeTodayOrderId = '';

  const nextOrderNumber = () => `TAG-${runId.slice(-8)}-${orderIds.length}`;

  async function insertOrder(opts: {
    label: string;
    orderStatus: OrderStatus;
    scheduledAt: Date | null;
    durationHours?: number;
    assignedToTechnician?: boolean;
  }) {
    const [order] = await dataSource.query(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, scheduled_at, duration_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7,10000,$8,$9) RETURNING id`,
      [
        nextOrderNumber(),
        ids.customerProfile,
        opts.assignedToTechnician ? ids.technicianProfile : null,
        ids.service,
        ids.address,
        ids.zone,
        opts.orderStatus,
        opts.scheduledAt,
        opts.durationHours ?? null,
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
    guard = new TechnicianAssignmentGuardService({
      getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
    } as never);

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The fixture requires the seeded EG country');
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
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
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
    await q(`DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE order_id = ANY($1::uuid[]))`, [orderIds]);
    await q(`DELETE FROM chat_threads WHERE order_id = ANY($1::uuid[])`, [orderIds]);
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
    await dataSource.destroy();
  });

  it('طلب مجدول بعد أسبوع مايترفضش بسبب طلب نشط تاني النهاردة (البَقّة الأساسية)', async () => {
    activeTodayOrderId = (
      await insertOrder({
        label: 'active-today',
        orderStatus: OrderStatus.ACCEPTED,
        scheduledAt: null,
        assignedToTechnician: true,
      })
    ).id;
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const candidate = await insertOrder({
      label: 'scheduled-week',
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
      scheduledAt: weekFromNow,
    });

    await dataSource.manager.transaction(async (manager) => {
      const technician = await guard.lockTechnician(manager, ids.technicianProfile);
      await expect(guard.assertEligible(manager, technician, candidate)).resolves.toBeUndefined();
    });
  });

  it('طلب مجدول بعد أسبوع مايترفضش لو الفني أوفلاين دلوقتي (isAvailable/isOnDuty=false)', async () => {
    await setTechnicianOnline(false);
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const candidate = await insertOrder({
      label: 'scheduled-offline',
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
      scheduledAt: weekFromNow,
    });

    try {
      await dataSource.manager.transaction(async (manager) => {
        const technician = await guard.lockTechnician(manager, ids.technicianProfile);
        await expect(guard.assertEligible(manager, technician, candidate)).resolves.toBeUndefined();
      });
    } finally {
      await setTechnicianOnline(true);
    }
  });

  it('عضو الطاقم يترفض عند تداخل الساعات ويتقبل في موعد مجاور', async () => {
    const start = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    start.setUTCHours(9, 0, 0, 0);
    await insertOrder({
      label: 'precise-existing',
      orderStatus: OrderStatus.ACCEPTED,
      scheduledAt: start,
      durationHours: 2,
      assignedToTechnician: true,
    });
    const overlapping = await insertOrder({
      label: 'precise-overlap',
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
      scheduledAt: new Date(start.getTime() + 60 * 60 * 1000),
      durationHours: 2,
    });
    const adjacent = await insertOrder({
      label: 'precise-adjacent',
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
      scheduledAt: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      durationHours: 2,
    });

    await dataSource.manager.transaction(async (manager) => {
      await expect(guard.isScheduleAvailable(manager, ids.technicianProfile, overlapping)).resolves.toBe(false);
      await expect(guard.isScheduleAvailable(manager, ids.technicianProfile, adjacent)).resolves.toBe(true);
    });
  });

  // إصلاح بَقّة حقيقية (docs/08 §32، بلاغ مالك 2026-08-20): قبل الإصلاح، طلب ASAP كان بيترفض لمجرد
  // إن الفني عنده *أي* طلب accepted نشط تاني — حتى لو قصير ولسه ما بدأش، رغم إن نفس الفني ده كان
  // بيفضل مؤهّل تمامًا لطلب *مجدول* لنفس اليوم. النتيجة: العميل يدوس "في أقرب وقت ممكن" فيلاقي
  // "مفيش فنيين متاحين" رغم وجود فنيين فاضيين فعلاً. الإصلاح: ASAP بقى يتبع بالحرف نفس قاعدة
  // الطلب المجدول (يوم = النهاردة) — طلب accepted قصير لسه ما بدأش مايستبعدش خالص.
  it('ASAP بقى يتقبل رغم إن الفني عنده طلب accepted تاني النهاردة (قصير، لسه ما بدأش) — إصلاح البَقّة (docs/08 §32)', async () => {
    // الفني أونلاين دلوقتي، وعنده طلب "active-today" من الاختبار الأول لسه ACCEPTED (قصير، مش
    // شاغل يوم كامل، ولسه ما بدأش يتحرّك ليه — بالضبط زي المطلوب مايستبعدش تحته).
    const candidate = await insertOrder({
      label: 'asap-short-busy',
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
      scheduledAt: null,
    });

    await dataSource.manager.transaction(async (manager) => {
      const technician = await guard.lockTechnician(manager, ids.technicianProfile);
      await expect(guard.assertEligible(manager, technician, candidate)).resolves.toBeUndefined();
    });
  });

  it('ASAP لسه بيترفض صح لو الفني منشغل جسديًا فعليًا دلوقتي (technician_on_way) — الحماية الحقيقية اتحافظ عليها', async () => {
    // نفس طلب "active-today" بس بقى في الطريق فعليًا دلوقتي — ده الحالة الوحيدة اللي المفروض
    // تستبعد فني من طلب ASAP جديد (ازدواج حجز حقيقي: فني واحد ياخد شغلانتين فوريتين في نفس اللحظة).
    await dataSource.query(`UPDATE orders SET order_status = 'technician_on_way' WHERE id = $1`, [activeTodayOrderId]);
    try {
      const candidate = await insertOrder({
        label: 'asap-engaged',
        orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
        scheduledAt: null,
      });

      await dataSource.manager.transaction(async (manager) => {
        const technician = await guard.lockTechnician(manager, ids.technicianProfile);
        await expect(guard.assertEligible(manager, technician, candidate)).rejects.toBeInstanceOf(ApiException);
      });
    } finally {
      await dataSource.query(`UPDATE orders SET order_status = 'accepted' WHERE id = $1`, [activeTodayOrderId]);
    }
  });

  it('طلب طوارئ (EMERGENCY) بلا scheduledAt بيعدي حتى لو الفني أوفلاين — سلوك قديم متأثرش', async () => {
    // فحص "الفني عنده طلب نشط بالفعل" مالوش استثناء طوارئ (مايترفعش أصلاً — نفس السلوك قبل هذا
    // الإصلاح)، فلازم نقفل الطلب النشط من الاختبار الأول الأول عشان نعزل فحص isOnDuty/isAvailable
    // اللي فعلاً عنده استثناء الطوارئ (الفحص اللي إحنا بنتأكد منه هنا تحديدًا).
    await dataSource.query(`UPDATE orders SET order_status = 'completed' WHERE id = $1`, [activeTodayOrderId]);
    await setTechnicianOnline(false);
    const [order] = await dataSource.query(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,$6,10000,'emergency') RETURNING id`,
      [nextOrderNumber(), ids.customerProfile, ids.service, ids.address, ids.zone, OrderStatus.SEARCHING_TECHNICIAN],
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

  // docs/08 §38 (طلب مالك صريح 2026-08-21) — "اعتماد" لازم قائدها مستواه محترف فأعلى
  // (technician_level_config.eligible_for_team_booking). البوابة النهائية دي لازم تمنع أي تحايل
  // على فلترة listForServiceBooking()/findEligibleTechnicians() عن طريق نداء API مباشر.
  describe('بوابة مستوى "اعتماد" (eligible_for_team_booking) — docs/08 §38', () => {
    it('طلب اعتماد يترفض لفني مستواه new (eligible_for_team_booking=false افتراضيًا)', async () => {
      const [order] = await dataSource.query(
        `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, booking_mode)
         VALUES ($1,$2,$3,$4,$5,$6,10000,'team') RETURNING id`,
        [nextOrderNumber(), ids.customerProfile, ids.service, ids.address, ids.zone, OrderStatus.SEARCHING_TECHNICIAN],
      );
      orderIds.push(order.id as string);
      const candidate = await dataSource.getRepository(Order).findOneOrFail({ where: { id: order.id as string } });
      expect(candidate.bookingMode).toBe(BookingMode.TEAM);

      await dataSource.manager.transaction(async (manager) => {
        const technician = await guard.lockTechnician(manager, ids.technicianProfile);
        await expect(guard.assertEligible(manager, technician, candidate)).rejects.toBeInstanceOf(ApiException);
      });
    });

    it('نفس الطلب يعدّي بعد ما الفني يترقّى professional (eligible_for_team_booking=true)', async () => {
      await dataSource.query(`UPDATE technician_profiles SET current_level = 'professional' WHERE id = $1`, [ids.technicianProfile]);
      try {
        const [order] = await dataSource.query(
          `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, booking_mode)
           VALUES ($1,$2,$3,$4,$5,$6,10000,'team') RETURNING id`,
          [nextOrderNumber(), ids.customerProfile, ids.service, ids.address, ids.zone, OrderStatus.SEARCHING_TECHNICIAN],
        );
        orderIds.push(order.id as string);
        const candidate = await dataSource.getRepository(Order).findOneOrFail({ where: { id: order.id as string } });

        await dataSource.manager.transaction(async (manager) => {
          const technician = await guard.lockTechnician(manager, ids.technicianProfile);
          await expect(guard.assertEligible(manager, technician, candidate)).resolves.toBeUndefined();
        });
      } finally {
        await dataSource.query(`UPDATE technician_profiles SET current_level = 'new' WHERE id = $1`, [ids.technicianProfile]);
      }
    });

    it('طلب فردي (individual) بلا أي تأثير — فني new يعدّي عادي (regression)', async () => {
      const [order] = await dataSource.query(
        `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, booking_mode)
         VALUES ($1,$2,$3,$4,$5,$6,10000,'individual') RETURNING id`,
        [nextOrderNumber(), ids.customerProfile, ids.service, ids.address, ids.zone, OrderStatus.SEARCHING_TECHNICIAN],
      );
      orderIds.push(order.id as string);
      const candidate = await dataSource.getRepository(Order).findOneOrFail({ where: { id: order.id as string } });

      await dataSource.manager.transaction(async (manager) => {
        const technician = await guard.lockTechnician(manager, ids.technicianProfile);
        await expect(guard.assertEligible(manager, technician, candidate)).resolves.toBeUndefined();
      });
    });
  });
});
