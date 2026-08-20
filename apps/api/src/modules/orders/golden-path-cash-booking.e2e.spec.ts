import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderMedia, OrderMediaType } from './entities/order-media.entity';
import { PaymentsService } from '../payments/payments.service';
import { Payment } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Wallet, WalletOwnerType, PLATFORM_SYSTEM_USER_ID } from '../payments/entities/wallet.entity';
import { WalletTransaction, WalletTxDirection, WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { DomesticWorkerBooking } from '../domestic-workers/entities/domestic-worker-booking.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { Address } from '../customers/entities/address.entity';
import { AddressesService } from '../customers/addresses.service';
import { CatalogService } from '../catalog/catalog.service';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { GeoService } from '../geo/geo.service';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { TechnicianScheduleSlot } from '../technicians/entities/technician-schedule-slot.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { SupportService } from '../support/support.service';
import { Complaint } from '../support/entities/complaint.entity';
import { ComplaintMessage } from '../support/entities/complaint-message.entity';
import { ComplaintAttachment } from '../support/entities/complaint-attachment.entity';
import { RatingsService } from '../ratings/ratings.service';
import { Rating, RatingType } from '../ratings/entities/rating.entity';

/**
 * Script 7 Phase 34 — Full Golden-Path Live Test. رحلة العميل الكاملة أولوية #1 (docs/08 المقدمة
 * الحاكمة): تسجيل/بروفايل موجودين مسبقًا (Phase 1 مغطاة بالفعل) → إنشاء طلب كاش حقيقي عبر
 * OrdersService.create() (نفس الدالة اللي كل الـHTTP endpoint بينادّيها) → توزيع (محاكى: تعيين فني
 * مباشر زي ما matching.service.ts كان هيعمل، الموديول ده مختبر منفصل بعمق) → دورة تنفيذ الفني
 * الكاملة (depart→arrive→start→complete بصورة إجبارية) → تحصيل كاش → تسوية مالية (settleAndComplete)
 * → تقييم العميل → فحص الحالة النهائية الكاملة في الداتابيز (order/payment/wallet/rating/warranty).
 * كل خطوة بتنادي نفس دالة الخدمة الحقيقية اللي الـcontroller بينادّيها، مش محاكاة منفصلة.
 */
describe('Golden Path — رحلة حجز كاش كاملة من الإنشاء للتقييم (Script 7 Phase 34)', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let paymentsService: PaymentsService;
  let ratingsService: RatingsService;
  let walletsService: WalletsService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    technicianUser: '',
    technicianProfile: '',
    order: '',
  };

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Order,
        OrderStatusHistory,
        OrderMedia,
        Payment,
        Refund,
        User,
        WebhookEvent,
        Wallet,
        WalletTransaction,
        CustomerProfile,
        Address,
        City,
        Area,
        ServiceZone,
        TechnicianProfile,
        TechnicianCompany,
        TechnicianScheduleSlot,
        Setting,
        Complaint,
        ComplaintMessage,
        ComplaintAttachment,
        ServiceCategory,
        Service,
        ServiceZonePricing,
        ServiceLevelPricing,
        ServiceAddon,
        ServiceStandardData,
        TechnicianLevelConfig,
        LoyaltyTransaction,
        Rating,
      ],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      ids.country,
      `مدينة المسار الذهبي ${runId}`,
      `Golden Path City ${runId}`,
      `test-city-gp-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق المسار الذهبي ${runId}`,
      `Golden Path Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة المسار الذهبي ${runId}`,
      `Golden Path Category ${runId}`,
      `test-category-gp-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, allows_emergency)
       VALUES ($1,$2,$3,'fixed',100000,20,14,false) RETURNING id`,
      [ids.category, `خدمة المسار الذهبي ${runId}`, `test-service-gp-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2040${runId}`.slice(0, 15),
      `عميل المسار الذهبي ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع المسار الذهبي ${runId}`],
    );
    ids.address = address.id;

    const [technicianUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2041${runId}`.slice(0, 15), `فني المسار الذهبي ${runId}`],
    );
    ids.technicianUser = technicianUser.id;
    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, is_available, current_level)
       VALUES ($1,$2,true,'new') RETURNING id`,
      [ids.technicianUser, `TECH-GP-${runId}`],
    );
    ids.technicianProfile = technicianProfile.id;

    const cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), { record: async () => undefined } as unknown as AuditLogService, cache);
    const geoService = new GeoService(dataSource.getRepository(City), dataSource.getRepository(Area), dataSource.getRepository(ServiceZone), dataSource);
    const addressesService = new AddressesService(
      dataSource.getRepository(Address),
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(Order),
      geoService,
    );
    const catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      settingsService,
      {} as never,
    );
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never,
      {} as never,
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
      {} as never,
    );
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const technicianLevelsService = new TechnicianLevelsService(
      dataSource.getRepository(TechnicianLevelConfig),
      {} as unknown as AuditLogService,
    );
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);
    const scheduleService = new TechnicianScheduleService(dataSource.getRepository(TechnicianScheduleSlot));
    const events = new EventEmitter2();
    const statsStub = { enqueueRecalculation: async () => undefined } as never;

    paymentsService = new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource.getRepository(DomesticWorkerBooking),
      dataSource,
      walletsService,
      catalogService,
      customerProfilesService,
      techniciansService,
      technicianLevelsService,
      statsStub,
      loyaltyService,
      settingsService,
      { record: async () => undefined } as unknown as AuditLogService,
      events,
      {} as never,
      {} as never,
    );
    const supportService = new SupportService(
      dataSource.getRepository(Complaint),
      dataSource.getRepository(ComplaintMessage),
      dataSource.getRepository(ComplaintAttachment),
      dataSource.getRepository(Order),
      dataSource,
      customerProfilesService,
      techniciansService,
      walletsService,
      { record: async () => undefined } as unknown as AuditLogService,
      events,
      {} as never,
    );

    ordersService = new OrdersService(
      dataSource.getRepository(Order),
      {} as never,
      dataSource.getRepository(OrderMedia),
      dataSource,
      { record: async () => undefined } as unknown as AuditLogService,
      customerProfilesService,
      addressesService,
      catalogService,
      geoService,
      techniciansService,
      {} as never,
      scheduleService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      walletsService,
      settingsService,
      paymentsService,
      supportService,
      events,
      {} as never, // orderTeamService (docs/08 §35) — مش متنادى في المسار ده
    );

    ratingsService = new RatingsService(
      dataSource.getRepository(Rating),
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderMedia),
      customerProfilesService,
      techniciansService,
      statsStub,
      statsStub,
      settingsService,
      events,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM ratings WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM order_media WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_user_id = ANY($1))`, [
        [ids.customerUser, ids.technicianUser],
      ]);
      await q(`DELETE FROM wallets WHERE owner_user_id = ANY($1)`, [[ids.customerUser, ids.technicianUser]]);
      await q(`DELETE FROM payments WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM loyalty_transactions WHERE user_id = ANY($1)`, [[ids.customerUser, ids.technicianUser]]);
      await q(`DELETE FROM order_status_history WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.customerUser, ids.technicianUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('الرحلة الكاملة: إنشاء → توزيع → تنفيذ → تحصيل كاش → تسوية → تقييم — الحالة النهائية صحيحة بالكامل في الداتابيز', async () => {
    // 1) إنشاء الطلب — نفس الدالة الحقيقية اللي POST /orders بينادّيها. `payment_method` في
    // CreateOrderDto مقصور على 'card'|'instapay' بس (دفع قبل التوزيع، ADR-0013) — كاش/محفظة
    // عمداً من غير الحقل ده خالص (دفعهم بيحصل بعد اكتمال الشغل، مش قبل التوزيع).
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
    } as never);
    ids.order = order.id;
    expect(order.orderStatus).toBe(OrderStatus.SEARCHING_TECHNICIAN);
    // base_price_cents=100000 (1000ج)، inspection/surge/addons=0 — العمولة (20%) بتتخصم من نصيب
    // الفني، مش بتتضاف فوق سعر العميل.
    expect(order.totalAmountCents).toBe(100000);
    expect(order.paymentStatus).toBe('unpaid');

    // 2) توزيع — matching.service.ts نفسها مختبرة بعمق منفصل (matching.service.spec.ts)؛ هنا
    // بنحاكي نتيجتها الوحيدة المهمة لباقي الرحلة: فني اتعيّن، الطلب بقى TECHNICIAN_ASSIGNED.
    await q(`UPDATE orders SET technician_id = $1, order_status = 'technician_assigned', assigned_at = now() WHERE id = $2`, [
      ids.technicianProfile,
      order.id,
    ]);
    // قبول الفني — matching.service.ts's accept() نفسها مختبرة بعمق منفصل (matching.service.spec.ts)،
    // هنا بنحاكي نتيجتها الوحيدة المهمة لباقي الرحلة: الطلب بقى ACCEPTED قبل ما يبدأ يتحرك.
    await q(`UPDATE orders SET order_status = 'accepted', accepted_at = now() WHERE id = $1`, [order.id]);

    // 3) دورة تنفيذ الفني الكاملة — نفس دوال OrdersService اللي controller التنفيذ بينادّيها.
    await ordersService.depart(ids.technicianUser, order.id);
    await ordersService.arrive(ids.technicianUser, order.id);
    await ordersService.start(ids.technicianUser, order.id);

    // إثبات إنجاز الشغل إجباري (docs/08 §20 بند 12) — بلا صورة، complete() لازم يترفض.
    await expect(ordersService.complete(ids.technicianUser, order.id)).rejects.toMatchObject({ code: 'ORDR_005' });

    await dataSource.getRepository(OrderMedia).save(
      dataSource.getRepository(OrderMedia).create({
        orderId: order.id,
        mediaType: OrderMediaType.AFTER_PHOTO,
        fileUrl: `https://example.test/golden-path-${runId}.jpg`,
        uploadedByUserId: ids.technicianUser,
      }),
    );
    const workCompleted = await ordersService.complete(ids.technicianUser, order.id);
    expect(workCompleted.orderStatus).toBe(OrderStatus.WORK_COMPLETED);

    // 4) تحصيل كاش + تسوية مالية — نفس PaymentsService.collectCash() الحقيقية.
    // محفظة المنصة مشتركة بين كل اختبارات jest في نفس الداتابيز (رصيدها المطلق مش موثوق كمرجع —
    // نفس الملاحظة الموثّقة في domestic-workers/README.md) — بنقيس الفرق (delta) بس، مش القيمة المطلقة.
    const platformWalletBefore = await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    const payment = await paymentsService.collectCash(ids.technicianUser, order.id);
    expect(payment.amountCents).toBe(100000);
    expect(payment.paymentStatus).toBe('succeeded');

    const settledOrder = await dataSource.getRepository(Order).findOneOrFail({ where: { id: order.id } });
    expect(settledOrder.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(settledOrder.paymentStatus).toBe('paid');
    expect(settledOrder.platformCommissionCents).toBe(20000); // 20% من 100000
    expect(settledOrder.technicianEarningCents).toBe(80000);
    expect(settledOrder.warrantyExpiresAt).not.toBeNull(); // service.warranty_days=14 > 0

    // كاش كامل → الفني ماسك المبلغ كامل يدًا بيد → مديون للمنصة بالعمولة (COMMISSION_DEDUCTION)،
    // مش العكس (راجع BUG سابق في settleAndComplete موثّق في payments/README.md).
    const technicianWallet = await walletsService.findByUserIdOrThrow(ids.technicianUser);
    expect(technicianWallet.balanceCents).toBe(-20000);
    const platformWallet = await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    const commissionTx = await dataSource.getRepository(WalletTransaction).findOne({
      where: { walletId: technicianWallet.id, transactionType: WalletTxType.COMMISSION_DEDUCTION, direction: WalletTxDirection.DEBIT },
    });
    expect(commissionTx).not.toBeNull();
    expect(commissionTx!.amountCents).toBe(20000);
    expect(platformWallet.balanceCents - platformWalletBefore.balanceCents).toBe(20000);

    // 5) تقييم العميل — نفس RatingsService الحقيقية.
    const rating = await ratingsService.rateAsCustomer(ids.customerUser, order.id, {
      overall_rating: 5,
      comment: 'ممتاز — Golden Path test',
    } as never);
    expect(rating.overallRating).toBe(5);
    expect(rating.ratingType).toBe(RatingType.CUSTOMER_TO_TECHNICIAN);

    // محاولة تقييم تانية لنفس الطلب لازم تترفض (slot واحد بس، Phase 22).
    await expect(
      ratingsService.rateAsCustomer(ids.customerUser, order.id, { overall_rating: 3 } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });

    // 6) فحص order_status_history — كل انتقال اتسجّل صح (audit trail كامل للرحلة).
    const history = await dataSource.query<{ new_status: string }[]>(
      `SELECT new_status FROM order_status_history WHERE order_id = $1 ORDER BY created_at ASC`,
      [order.id],
    );
    expect(history.map((h) => h.new_status)).toEqual([
      'searching_technician',
      'technician_on_way',
      'technician_arrived',
      'in_progress',
      'work_completed',
      'completed',
    ]);
  }, 30000);
});
