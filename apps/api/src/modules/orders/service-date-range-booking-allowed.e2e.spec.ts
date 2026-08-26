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
 * ADR-0028 (docs/08 §42 Phase A.2) — قدرة service.allows_date_range_booking. الاختبار ده بيغطي:
 * 1. خدمة allows_date_range_booking=false + scheduled_at_range_end: يترفض VAL_001.
 * 2. نفس الخدمة بيوم محدد بس (بلا range_end): تتسجّل عادي — الرفض بس للنطاق المرن نفسه.
 * 3. خدمة عادية (allows_date_range_booking=true الافتراضي) + نطاق مرن: تفضل تشتغل زي ما كانت
 *    بالظبط (رجريشن صفري — نفس سلوك المسار قبل القدرة دي خالص).
 */
describe('OrdersService.create() — قدرة service.allows_date_range_booking (ADR-0028)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let ordersService: OrdersService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    serviceRangeDisabled: '',
    serviceRangeEnabled: '',
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
        LoyaltyTransaction,
      ],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      ids.country,
      `مدينة نطاق ${runId}`,
      `Date Range City ${runId}`,
      `test-city-range-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق جيو ${runId}`,
      `Date Range Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة نطاق ${runId}`,
      `Date Range Category ${runId}`,
      `test-category-range-${runId}`,
    ]);
    ids.category = category.id;
    const [serviceRangeDisabled] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, allows_date_range_booking)
       VALUES ($1,$2,$3,'fixed',50000,20,0,false) RETURNING id`,
      [ids.category, `خدمة بلا نطاق ${runId}`, `test-service-no-range-${runId}`],
    );
    ids.serviceRangeDisabled = serviceRangeDisabled.id;
    // الافتراضي (allows_date_range_booking مش متبعت في الـINSERT، NOT NULL DEFAULT true بيمسكها).
    const [serviceRangeEnabled] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',50000,20,0) RETURNING id`,
      [ids.category, `خدمة نطاق عادية ${runId}`, `test-service-default-range-${runId}`],
    );
    ids.serviceRangeEnabled = serviceRangeEnabled.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2036${runId}`.slice(0, 15),
      `عميل نطاق ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع نطاق ${runId}`],
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
      {} as never,
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
      settingsService,
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
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      walletsService,
      settingsService,
      paymentsService,
      supportService,
      events,
      {} as never,
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
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.serviceRangeDisabled, ids.serviceRangeEnabled]]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  const tomorrow = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 3);
    return d.toISOString().slice(0, 10);
  };
  const rangeEnd = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 8);
    return d.toISOString().slice(0, 10);
  };

  it('allows_date_range_booking=false + scheduled_at_range_end: يترفض بوضوح VAL_001', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.serviceRangeDisabled,
        address_id: ids.address,
        scheduled_at: tomorrow(),
        scheduled_at_range_end: rangeEnd(),
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('allows_date_range_booking=false + يوم محدد بس (بلا range_end): يتسجّل عادي — الرفض للنطاق المرن نفسه بس', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceRangeDisabled,
      address_id: ids.address,
      scheduled_at: tomorrow(),
    } as never);
    expect(order.serviceId).toBe(ids.serviceRangeDisabled);
  });

  it('allows_date_range_booking=true (الافتراضي): نطاق مرن لسه بيشتغل زي ما كان (رجريشن)', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceRangeEnabled,
      address_id: ids.address,
      scheduled_at: tomorrow(),
      scheduled_at_range_end: rangeEnd(),
    } as never);
    expect(order.serviceId).toBe(ids.serviceRangeEnabled);
    expect(order.scheduledAt).not.toBeNull();
  });
});
