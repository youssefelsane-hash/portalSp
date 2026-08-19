import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderMedia, OrderMediaType } from './entities/order-media.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { User } from '../auth/entities/user.entity';

// اختبار حي ضد Postgres حقيقي — قرار مالك صريح 2026-08-14 (docs/08 §20 بند 12): صورة after_photo
// واحدة على الأقل إجبارية قبل إنهاء الشغل (WORK_COMPLETED)، مفروضة على الباك-إند نفسه — مش بس
// زرار الواجهة. الاختبارات هنا بتنادي OrdersService.complete() مباشرة (نفس الدالة اللي وراء
// POST /technician/orders/:id/complete) — ده بالظبط الدليل إن الفحص مايتلفش لو حد نادى الـendpoint
// مباشرة (Postman/سكريبت) من غير ما يعدّي من واجهة Flutter خالص.
describe('OrdersService.complete() — إثبات إنجاز الشغل إجباري (docs/08 §20 بند 12)', () => {
  let dataSource: DataSource;
  let service: OrdersService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    address: '',
    techUser: '',
    techProfile: '',
    customerUser: '',
    customerProfile: '',
  };

  async function insertInProgressOrder(label: string): Promise<string> {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, placed_at, work_started_at)
       VALUES ($1,$2,$3,$4,$5,$6,'in_progress','unpaid',20000, now(), now()) RETURNING id`,
      [`TESTPOW-${runId}-${label}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, OrderMedia, TechnicianProfile, TechnicianCompany, User],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The proof-of-work integration fixture requires the seeded EG country');
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-pow-${runId}`],
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
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-pow-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-pow-${runId}`],
    );
    ids.service = serviceRow.id;

    const [techUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2030${runId}`.slice(0, 15), `فني اختبار ${runId}`],
    );
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCPOW${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2031${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
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

    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never, // technicianServicesRepo
      {} as never, // servicesRepo
      dataSource.getRepository(User),
      {} as never, // portfolioLinksService — مش متنادى في findByUserIdOrThrow
      {} as never, // certificatesService
      { record: async () => undefined } as unknown as AuditLogService,
      {} as never, // geoService
      {} as never, // settingsService
    );

    // OrdersService الحقيقية — بس التبعيات اللي فعليًا بتتنادى في complete()/transitionAsTechnician()
    // (orders repo، orderMedia repo، dataSource، techniciansService، events). الباقي stub آمن
    // مايتناداش خالص في المسار ده.
    service = new OrdersService(
      dataSource.getRepository(Order),
      {} as never, // technicianOrderCancellations
      dataSource.getRepository(OrderMedia),
      dataSource,
      { record: async () => undefined } as unknown as AuditLogService,
      {} as never, // customerProfiles
      {} as never, // addressesService
      {} as never, // catalogService
      {} as never, // geoService
      techniciansService,
      {} as never, // technicianCompaniesService
      {} as never, // scheduleService
      {} as never, // pricingEngineService
      {} as never, // promoCodesService
      {} as never, // buildingsService
      {} as never, // cancellationReasonsService
      {} as never, // walletsService
      {} as never, // settingsService
      {} as never, // paymentsService
      {} as never, // supportService
      { emit: () => undefined } as never, // events
    );
  });

  afterEach(async () => {
    if (!dataSource?.isInitialized || !ids.customerProfile) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
    await q(`DELETE FROM order_media WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
    await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      if (ids.customerProfile) {
        await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
        await q(`DELETE FROM order_media WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
        await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      }
      if (ids.address) await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      if (ids.customerProfile) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (ids.techProfile) await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      if (ids.techUser && ids.customerUser) {
        await q(`DELETE FROM users WHERE id IN ($1, $2)`, [ids.techUser, ids.customerUser]);
      } else if (ids.techUser || ids.customerUser) {
        await q(`DELETE FROM users WHERE id = $1`, [ids.techUser || ids.customerUser]);
      }
      if (ids.service) await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      if (ids.category) await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      if (ids.zone) await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      if (ids.city) await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('إنهاء الشغل من غير after_photo يترفض بوضوح (ORDR_005)، الطلب يفضل in_progress', async () => {
    const orderId = await insertInProgressOrder('nophoto');
    await expect(service.complete(ids.techUser, orderId)).rejects.toMatchObject({
      code: 'ORDR_005',
    });

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.IN_PROGRESS);
  });

  it('إنهاء الشغل بصورة after_photo واحدة بينجح، الطلب ينتقل work_completed', async () => {
    const orderId = await insertInProgressOrder('onephoto');
    await dataSource.getRepository(OrderMedia).save(
      dataSource.getRepository(OrderMedia).create({
        orderId,
        uploadedByUserId: ids.techUser,
        mediaType: OrderMediaType.AFTER_PHOTO,
        fileUrl: 'https://example.test/after.jpg',
      }),
    );

    const result = await service.complete(ids.techUser, orderId);
    expect(result.orderStatus).toBe(OrderStatus.WORK_COMPLETED);
  });

  it('أكتر من صورة after_photo مسموح بس مش إجباري — نفس النجاح', async () => {
    const orderId = await insertInProgressOrder('twophotos');
    const mediaRepo = dataSource.getRepository(OrderMedia);
    await mediaRepo.save(
      mediaRepo.create({ orderId, uploadedByUserId: ids.techUser, mediaType: OrderMediaType.AFTER_PHOTO, fileUrl: 'https://example.test/after-1.jpg' }),
    );
    await mediaRepo.save(
      mediaRepo.create({ orderId, uploadedByUserId: ids.techUser, mediaType: OrderMediaType.BEFORE_PHOTO, fileUrl: 'https://example.test/before.jpg' }),
    );
    await mediaRepo.save(
      mediaRepo.create({ orderId, uploadedByUserId: ids.techUser, mediaType: OrderMediaType.AFTER_PHOTO, fileUrl: 'https://example.test/after-2.jpg' }),
    );

    const result = await service.complete(ids.techUser, orderId);
    expect(result.orderStatus).toBe(OrderStatus.WORK_COMPLETED);
  });

  it('before_photo بس (من غير after_photo) مش كافي — نفس الرفض', async () => {
    const orderId = await insertInProgressOrder('beforeonly');
    const mediaRepo = dataSource.getRepository(OrderMedia);
    await mediaRepo.save(
      mediaRepo.create({ orderId, uploadedByUserId: ids.techUser, mediaType: OrderMediaType.BEFORE_PHOTO, fileUrl: 'https://example.test/before-only.jpg' }),
    );

    await expect(service.complete(ids.techUser, orderId)).rejects.toMatchObject({ code: 'ORDR_005' });
  });

  it('سباق complete × complete ينجّح انتقال واحد ويسجل history واحدة فقط', async () => {
    const orderId = await insertInProgressOrder('complete-race');
    await dataSource.getRepository(OrderMedia).save(
      dataSource.getRepository(OrderMedia).create({
        orderId,
        uploadedByUserId: ids.techUser,
        mediaType: OrderMediaType.AFTER_PHOTO,
        fileUrl: 'https://example.test/after-race.jpg',
      }),
    );

    const results = await Promise.allSettled([
      service.complete(ids.techUser, orderId),
      service.complete(ids.techUser, orderId),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const finalOrder = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(finalOrder.orderStatus).toBe(OrderStatus.WORK_COMPLETED);
    const historyCount = await dataSource.getRepository(OrderStatusHistory).count({
      where: { orderId, newStatus: OrderStatus.WORK_COMPLETED },
    });
    expect(historyCount).toBe(1);
  });
});
