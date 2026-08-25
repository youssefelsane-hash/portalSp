import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';

// اختبار حي ضد Postgres حقيقي — بَقّة حقيقية اتلقطت (docs/08 §165، بعد ADR-0017):
// findActiveForTechnician() (GET /technician/orders/active، استرجاع شاشة التنفيذ بعد إعادة فتح
// التطبيق) كانت findOne() بلا فلترة على scheduled_at — قبل migration 0144 كان مفروض فني واحد
// بياخد طلب `accepted` واحد بس في أي وقت، دلوقتي ممكن يكون عنده طلب ASAP شغال فعليًا (accepted/
// technician_on_way/...) وطلب مجدول مستقبلي accepted (اتأكّد تلقائيًا، لسه معاداش موعده) في نفس
// الوقت — findOne كان ممكن يرجّع الطلب الغلط (المجدول) ويفتح شاشة تنفيذ لطلب لسه مالوش وقته.
describe('OrdersService.findActiveForTechnician()/findUpcomingConfirmedForTechnician() — فصل الشغل الحالي عن المؤكّد مستقبلاً', () => {
  let dataSource: DataSource;
  let service: OrdersService;
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
    asapOrder: '',
    futureOrder: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, TechnicianProfile],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The fixture requires the seeded EG country');
    ids.country = country.id;

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-tar-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق اختبار ${runId}`,
      `Test Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-tar-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-tar-${runId}`],
    );
    ids.service = serviceRow.id;

    const [technicianUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2011${runId}1`.slice(0, 14), `فني اختبار ${runId}`],
    );
    ids.technicianUser = technicianUser.id;
    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
       VALUES ($1,$2,'new','approved',true,true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography)
       RETURNING id`,
      [ids.technicianUser, `TSTTAR${runId}`.slice(0, 20)],
    );
    ids.technicianProfile = technicianProfile.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2012${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
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

    // الطلب "الشغال فعليًا دلوقتي" — ASAP (scheduled_at NULL)، حالة أبعد من accepted عشان
    // نتأكد إن الفلتر الجديد بيرجّعه صح حتى لو مش في accepted بالظبط.
    const [asapOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, technician_id,
         order_status, payment_status, total_amount_cents, scheduled_at, placed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_on_way','pending',10000, NULL, now()) RETURNING id`,
      [`TESTTAR-ASAP-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, ids.technicianProfile],
    );
    ids.asapOrder = asapOrder.id;

    // الطلب المجدول المؤكّد مستقبلاً — accepted بس معاداش موعده لسه (بعد 3 أيام).
    const [futureOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, technician_id,
         order_status, payment_status, total_amount_cents, scheduled_at, placed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',10000, now() + interval '3 days', now()) RETURNING id`,
      [`TESTTAR-FUTURE-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, ids.technicianProfile],
    );
    ids.futureOrder = futureOrder.id;

    service = new OrdersService(
      dataSource.getRepository(Order),
      {} as never,
      {} as never,
      dataSource,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { findByUserIdOrThrow: async (userId: string) => ({ id: ids.technicianProfile, userId }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // orderTeamService (docs/08 §35)
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM orders WHERE id = ANY($1)`, [[ids.asapOrder, ids.futureOrder]]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.technicianUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('findActiveForTechnician() بترجّع الطلب الشغال فعليًا دلوقتي (ASAP) مش الطلب المجدول المؤكّد مستقبلاً', async () => {
    const active = await service.findActiveForTechnician(ids.technicianUser);
    expect(active).not.toBeNull();
    expect(active!.id).toBe(ids.asapOrder);
    expect(active!.orderStatus).toBe(OrderStatus.TECHNICIAN_ON_WAY);
  });

  it('findUpcomingConfirmedForTechnician() بترجّع الطلب المجدول المؤكّد مستقبلاً بس، مش الطلب الشغال دلوقتي', async () => {
    const upcoming = await service.findUpcomingConfirmedForTechnician(ids.technicianUser);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].id).toBe(ids.futureOrder);
  });

  // **تغيير سلوك مقصود (docs/08 §56 بند 4، طلب مالك صريح 2026-08-25)** — الاختبار ده كان بيثبّت
  // السلوك القديم: طلب `accepted` وصل موعده يبقى "الشغل الحالي". المالك طلب صراحة إن "الشغل
  // الحالي" يكون **الشغلانة اللي شغّالة فعلاً** بس (الفني متحرّك ليها)، والباقي يتوزّع على
  // "قدامك"/"متأخر". شغل النهاردة اللي لسه ما بدأش = "قدامك" (النهاردة)، مش "حالي".
  it('طلب النهاردة المقبول لسه ما بدأش = "قدامك" مش "الحالي" — والحالي بيفضل فاضي لحد ما الفني يتحرّك', async () => {
    await dataSource.query(`UPDATE orders SET scheduled_at = now() - interval '1 minute' WHERE id = $1`, [
      ids.futureOrder,
    ]);
    await dataSource.query(`UPDATE orders SET order_status = 'completed' WHERE id = $1`, [ids.asapOrder]);

    const active = await service.findActiveForTechnician(ids.technicianUser);
    expect(active).toBeNull();

    // بَقّة حقيقية اتصلحت في نفس الشريحة: الشرط القديم (`MoreThan(now)`) كان بيخفي شغل النهاردة
    // من "قدامك" تمامًا أول ما اليوم يبدأ — الفني كان بيصحى ملقيش شغل النهاردة في أي قسم.
    const upcoming = await service.findUpcomingConfirmedForTechnician(ids.technicianUser);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].id).toBe(ids.futureOrder);

    // ولسه مش "متأخر" — يومه هو النهاردة، ماعداش.
    const overdue = await service.findOverdueForTechnician(ids.technicianUser);
    expect(overdue).toHaveLength(0);
  });

  it('الفني اتحرّك فعلاً (technician_on_way) => بقى "الحالي"، وخرج من "قدامك"', async () => {
    await dataSource.query(`UPDATE orders SET scheduled_at = now() - interval '1 minute' WHERE id = $1`, [
      ids.futureOrder,
    ]);
    await dataSource.query(`UPDATE orders SET order_status = 'completed' WHERE id = $1`, [ids.asapOrder]);
    await dataSource.query(`UPDATE orders SET order_status = 'technician_on_way' WHERE id = $1`, [ids.futureOrder]);
    // ملحوظة: الاختبارات هنا بتشارك نفس صفوف الـfixture عمدًا، فأي حالة بتعدّل order_status لازم
    // الحالة اللي بعدها ترجّعها لحالة معروفة صراحة (شوف الـreset في بداية الحالة الجاية).

    const active = await service.findActiveForTechnician(ids.technicianUser);
    expect(active).not.toBeNull();
    expect(active!.id).toBe(ids.futureOrder);
  });

  // الحالة اللي كانت بتضيع تمامًا قبل الإصلاح: يوم الشغلانة عدّى والفني لسه ما بدأش — مكانتش
  // في "قدامك" (معادها فات) ولا مضمونة في "الحالي" (findOne بترتيب updatedAt عشوائي فعليًا).
  it('شغلانة يومها عدّى ولسه accepted => "متأخر"، مش "الحالي" ولا "قدامك"', async () => {
    // reset صريح: الحالة اللي فاتت سابت futureOrder على technician_on_way.
    await dataSource.query(`UPDATE orders SET order_status = 'accepted' WHERE id = $1`, [ids.futureOrder]);
    await dataSource.query(`UPDATE orders SET scheduled_at = now() - interval '2 days' WHERE id = $1`, [
      ids.futureOrder,
    ]);
    await dataSource.query(`UPDATE orders SET order_status = 'completed' WHERE id = $1`, [ids.asapOrder]);

    const overdue = await service.findOverdueForTechnician(ids.technicianUser);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].id).toBe(ids.futureOrder);

    expect(await service.findActiveForTechnician(ids.technicianUser)).toBeNull();
    expect(await service.findUpcomingConfirmedForTechnician(ids.technicianUser)).toHaveLength(0);
  });
});
