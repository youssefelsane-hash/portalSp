import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { PaymentsService } from '../payments/payments.service';
import { Payment } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { Address } from '../customers/entities/address.entity';
import { AddressesService } from '../customers/addresses.service';
import { CatalogService } from '../catalog/catalog.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
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
import { BookingMode } from './entities/order.entity';
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';
import { crewEarningsServiceStub } from '../payments/crew-earnings.testing';

/**
 * Script 7 Phase 7 — بَقّة حقيقية اتلقطت: وضع "طوارئ" (docs/06) معناه استجابة فورية بالتعريف
 * الحرفي (نفس التعريف موثّق في تعليق `schedule_slot_id` جوّه `orders.service.ts`)، لكن الفحص
 * القديم كان بيمنع بس تركيبة `booking_mode=emergency` + `schedule_slot_id` — الحقل الحر
 * `scheduled_at` (بلا سلوت محدد) كان بيعدّي عادي مع الطوارئ، فيتسجّل طلب `orderType=EMERGENCY`
 * بموعد مستقبلي، وبعدين آلية تأجيل ADR-0009 (اتشالت في docs/08 §125) بتؤجّل بث المطابقة فعليًا
 * لساعات — عميل دافع رسوم طوارئ إضافية بينتظر بلا استجابة "فورية"، عكس تعريف الوضع تمامًا.
 */
describe('OrdersService.create() — اشتقاق الاستعجال من التاريخ (ADR-0048، كان Script 7 Phase 7)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let ordersService: OrdersService;
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
        LoyaltyTransaction, ServicePricingField, ServicePricingRule, ServicePricingEvaluation],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      ids.country,
      `مدينة طوارئ ${runId}`,
      `Emergency City ${runId}`,
      `test-city-emg-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق طوارئ ${runId}`,
      `Emergency Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة طوارئ ${runId}`,
      `Emergency Category ${runId}`,
      `test-category-emg-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, allows_emergency)
       VALUES ($1,$2,$3,'formula',30000,20,0,true) RETURNING id`,
      [ids.category, `خدمة طوارئ ${runId}`, `test-service-emg-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2032${runId}`.slice(0, 15),
      `عميل طوارئ ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع طوارئ ${runId}`],
    );
    ids.address = address.id;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
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
      // ADR-0050 §1 — `evaluatePreset()` بقى بيمر على محرك المعادلات لكل طرق الحساب، فمحرك
      // فاضي هنا مابقاش كافي. الطرق الجاهزة مابتقراش من الريبوهات، فالبناء بلا اعتماديات صح.
      realPricingEngineService(dataSource),
      {} as never, // docs/08 §36.24 ADR-0025 — ServicePricingTierPricing repo جديد
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
    const walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const technicianLevelsService = new TechnicianLevelsService(
      dataSource.getRepository(TechnicianLevelConfig),
      {} as unknown as AuditLogService,
    );
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);
    const scheduleService = new TechnicianScheduleService(dataSource.getRepository(TechnicianScheduleSlot));
    const events = new EventEmitter2();

    const paymentsService = new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource,
      walletsService,
      catalogService,
      customerProfilesService,
      techniciansService,
      technicianLevelsService,
      { enqueueRecalculation: async () => undefined } as never,
      loyaltyService,
      settingsService,
      { record: async () => undefined } as unknown as AuditLogService,
      events,
      {} as never,
      {} as never,
      {} as never, // installments repo (migration 0177)
      crewEarningsServiceStub(),
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
      {} as never,
      dataSource,
      { record: async () => undefined } as unknown as AuditLogService,
      customerProfilesService,
      addressesService,
      catalogService,
      geoService,
      techniciansService,
      {} as never,
      scheduleService,
      realPricingEngineService(dataSource), // pricingEngineService (ADR-0060 — كل خدمة بقت معادلة)
      {} as never,
      {} as never,
      {} as never,
      walletsService,
      settingsService,
      paymentsService,
      supportService,
      events,
      {} as never, // orderTeamService (docs/08 §35) — مش متنادى في المسار ده
      commissionBaseServiceStub(),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [
        ids.customerProfile,
      ]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  // **الاختبارات هنا اتقلبت مع ADR-0048 (docs/08 §85).**
  //
  // الاختبار القديم كان بيثبّت قاعدة اتشالت: «طوارئ + موعد مستقبلي = يترفض». القاعدة دي كانت
  // منطقية لما الطوارئ كانت **اختيار** ممكن يتناقض مع التاريخ. دلوقتي الطوارئ **نتيجة** إن
  // التاريخ هو النهارده، فالتناقض ده بقى مستحيل بالبناء نفسه — والاختبار الصح بقى إن الاشتقاق
  // بيطلع صح ورسوم الاستعجال بتتحصّل في الحالة الصح بس.
  const cairoDay = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    // منتصف النهار عشان مانلعبش على حدود اليوم — الاختبار عن القاعدة مش عن المناطق الزمنية
    // (ده مغطّى في `booking-mode-resolver.spec.ts` بحالات 00:30 و22:30 صراحةً).
    return new Date(`${d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })}T12:00:00Z`).toISOString();
  };

  it('حجز النهارده: بيتسجّل طوارئ أوتوماتيك وبرسوم استعجال — من غير ما العميل يختار', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      scheduled_at: cairoDay(0),
    } as never);
    expect(order.bookingMode).toBe(BookingMode.EMERGENCY);
    expect(order.orderType).toBe('emergency');
    expect(order.surgeAmountCents).toBeGreaterThan(0);
  });

  // **ده بالظبط طلب المالك بالحرف**: «حتى لو الشخص مختار فريق ومختار الشغل النهارده، الشغل
  // بيتطبّق إنه بيدخل خانة الطوارئ». الـdto بيقول "فريق"، والتاريخ بيقول "النهارده" — التاريخ
  // بيكسب، لأن الـdto مابقاش له أي وزن أصلاً.
  it('العميل باعت booking_mode=team بس اختار النهارده: التاريخ بيكسب والوضع بيطلع طوارئ', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      booking_mode: BookingMode.TEAM,
      scheduled_at: cairoDay(0),
    } as never);
    expect(order.bookingMode).toBe(BookingMode.EMERGENCY);
  });

  it('حجز بكرة: عادي بلا أي رسوم استعجال — حتى لو الـdto قال طوارئ', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      booking_mode: BookingMode.EMERGENCY,
      scheduled_at: cairoDay(1),
    } as never);
    expect(order.bookingMode).toBe(BookingMode.INDIVIDUAL);
    expect(order.surgeAmountCents).toBe(0);
  });

  // التصحيح اللي اتاخد أثناء التنفيذ (ADR-0048، الشرح الكامل في `isSameDayUrgent`): طلب من قناة
  // مابتبعتش تاريخ محدش وراه شاف تنبيه الرسوم، فمينفعش يتحاسب عليها.
  it('طلب بلا تاريخ خالص: مش طوارئ ومفيش رسوم — محدش اتخطر بيها', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
    } as never);
    expect(order.bookingMode).not.toBe(BookingMode.EMERGENCY);
    expect(order.surgeAmountCents).toBe(0);
    expect(order.scheduledAt).toBeNull();
  });
});
