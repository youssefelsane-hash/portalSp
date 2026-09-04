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
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';
import { crewEarningsServiceStub } from '../payments/crew-earnings.testing';

/**
 * ADR-0026 (docs/08 §42 Phase A.1) — أول قدرة دفع لكل خدمة على محرك الحجز الموحّد: خدمة
 * cash_allowed=false مينفعش تتقفل بكاش (غياب payment_method) خالص — لازم كارت/InstaPay مقدّم.
 * الاختبار ده بيغطي الحالتين: الرفض الفعلي على خدمة مقفولة، وإن الافتراضي (true) على خدمة عادية
 * فاضل يقبل كاش زي ما كان بالظبط (رجريشن صفري لكل الخدمات الموجودة).
 */
describe('OrdersService.create() — قدرة service.cash_allowed (ADR-0026)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let ordersService: OrdersService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    serviceCashDisabled: '',
    serviceCashEnabled: '',
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
      `مدينة كاش ${runId}`,
      `Cash Policy City ${runId}`,
      `test-city-cash-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق كاش ${runId}`,
      `Cash Policy Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة كاش ${runId}`,
      `Cash Policy Category ${runId}`,
      `test-category-cash-${runId}`,
    ]);
    ids.category = category.id;
    const [serviceCashDisabled] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, cash_allowed)
       VALUES ($1,$2,$3,'formula',50000,20,0,false) RETURNING id`,
      [ids.category, `خدمة بلا كاش ${runId}`, `test-service-no-cash-${runId}`],
    );
    ids.serviceCashDisabled = serviceCashDisabled.id;
    // الافتراضي (cash_allowed مش متبعت أصلاً في الـINSERT، NOT NULL DEFAULT true بيمسكها) — نفس
    // أي خدمة موجودة قبل الـmigration ده بالظبط.
    const [serviceCashEnabled] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',50000,20,0) RETURNING id`,
      [ids.category, `خدمة عادية ${runId}`, `test-service-default-cash-${runId}`],
    );
    ids.serviceCashEnabled = serviceCashEnabled.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2033${runId}`.slice(0, 15),
      `عميل كاش ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع كاش ${runId}`],
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
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.serviceCashDisabled, ids.serviceCashEnabled]]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  it('cash_allowed=false + غياب payment_method (كاش ضمنيًا): يترفض بوضوح VAL_001', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.serviceCashDisabled,
        address_id: ids.address,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('cash_allowed=false + payment_method=card صراحة: يتسجّل عادي (البديل المطلوب مش الكاش)', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceCashDisabled,
      address_id: ids.address,
      payment_method: 'card',
    } as never);
    expect(order.serviceId).toBe(ids.serviceCashDisabled);
  });

  it('cash_allowed=true (الافتراضي، أي خدمة موجودة من قبل الـmigration): كاش لسه بيتقبل زي ما كان (رجريشن)', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceCashEnabled,
      address_id: ids.address,
    } as never);
    expect(order.serviceId).toBe(ids.serviceCashEnabled);
    expect(order.totalAmountCents).toBe(50000);
  });

  // ─── دقة الموعد بقت وضعين بس (ADR-0060 §4، docs/08 §113) ─────────────────
  //
  // المدة والفترة مابقوش مدخلات حجز — بقوا حقول في فورم الخدمة وناتج محرك التسعير. الاختبارات
  // دي بتثبت الرفض على مسار `OrdersService.create()` الحقيقي (نظيره على القوالب المتكررة في
  // `recurring-orders-capability.spec.ts`).

  it('duration_hours كمدخل حجز: تترفض — المدة بقت من محرك التسعير (ADR-0060)', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.serviceCashEnabled,
        address_id: ids.address,
        duration_hours: 3,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('scheduled_end_at كمدخل حجز: تترفض — الفترة بقت حقول في فورم الخدمة (ADR-0060)', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.serviceCashEnabled,
        address_id: ids.address,
        scheduled_end_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('خدمة «وقت بداية فقط» من غير scheduled_at: تترفض', async () => {
    await dataSource.query(`UPDATE services SET requires_start_time_only = true WHERE id = $1`, [ids.serviceCashEnabled]);
    try {
      await expect(
        ordersService.create(ids.customerUser, { service_id: ids.serviceCashEnabled, address_id: ids.address } as never),
      ).rejects.toMatchObject({ code: 'VAL_001' });
    } finally {
      await dataSource.query(`UPDATE services SET requires_start_time_only = false WHERE id = $1`, [ids.serviceCashEnabled]);
    }
  });

  it('قاعدة البيانات نفسها بترفض إحياء الأوضاع المتشالة (chk_services_schedule_modes_supported)', async () => {
    await expect(
      dataSource.query(`UPDATE services SET requires_precise_schedule = true WHERE id = $1`, [ids.serviceCashEnabled]),
    ).rejects.toThrow(/chk_services_schedule_modes_supported/);
  });
});
