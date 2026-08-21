import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { PaymentsService } from '../payments/payments.service';
import { Payment } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { DomesticWorkerBooking } from '../domestic-workers/entities/domestic-worker-booking.entity';
import { DomesticWorkerProfile, DomesticWorkerVerificationStatus } from '../domestic-workers/entities/domestic-worker-profile.entity';
import { DomesticWorkersService } from '../domestic-workers/domestic-workers.service';
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

/**
 * ADR-0029 (docs/08 §42 Phase A.4 Slice 2) — حجز فني (شغالة) مباشر عبر المحرك الموحّد، زيرو
 * مطابقة تلقائية (ADR-0004). الاختبار ده بيغطي:
 * 1. خدمة worker_rate بلا domestic_worker_profile_id: يترفض VAL_001.
 * 2. خدمة worker_rate + domestic_worker_profile_id + duration_hours: يتسجّل ACCEPTED مباشرة
 *    (مش SEARCHING_TECHNICIAN)، السعر = hourlyRateCents × duration_hours بالحرط، technicianId
 *    يفضل null، domesticWorkerProfileId مسجّل صح.
 * 3. domestic_worker_profile_id + payment_method (دفع مقدّم): يترفض — مش مدعوم لسه (ADR-0029).
 * 4. domestic_worker_profile_id على خدمة fixed عادية (مش worker_rate): يترفض.
 * 5. رجريشن: خدمة عادية بلا domestic_worker_profile_id لسه بتشتغل زي زمان (SEARCHING_TECHNICIAN).
 */
describe('OrdersService.create() — حجز فني (شغالة) مباشر عبر المحرك الموحّد (ADR-0029، Phase A.4 Slice 2)', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    workerRateService: '',
    fixedService: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    workerUser: '',
    workerProfile: '',
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
        DomesticWorkerBooking,
        DomesticWorkerProfile,
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
      `مدينة شغالة ${runId}`,
      `DW Direct City ${runId}`,
      `test-city-dw-direct-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق شغالة ${runId}`,
      `DW Direct Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة شغالة ${runId}`,
      `DW Direct Category ${runId}`,
      `test-category-dw-direct-${runId}`,
    ]);
    ids.category = category.id;
    // cash_allowed=true عمدًا (Slice 2a بيدعم كاش بس — دفع مقدّم مؤجّل لشريحة تانية، ADR-0029).
    const [workerRateService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, cash_allowed)
       VALUES ($1,$2,$3,'worker_rate',0,true) RETURNING id`,
      [ids.category, `خدمة شغالة ${runId}`, `test-service-dw-direct-${runId}`],
    );
    ids.workerRateService = workerRateService.id;
    const [fixedService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',50000) RETURNING id`,
      [ids.category, `خدمة عادية شغالة ${runId}`, `test-service-dw-direct-fixed-${runId}`],
    );
    ids.fixedService = fixedService.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2037${runId}`.slice(0, 15),
      `عميل شغالة ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع شغالة ${runId}`],
    );
    ids.address = address.id;

    const [workerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'domestic_worker') RETURNING id`, [
      `+2038${runId}`.slice(0, 15),
      `شغالة ${runId}`,
    ]);
    ids.workerUser = workerUser.id;
    // hourly_rate_cents=8000 (80ج/ساعة)، معتمدة (approved) — نفس شرط findByIdOrThrow/الفحص الجديد.
    const [workerProfile] = await q(
      `INSERT INTO domestic_worker_profiles (user_id, worker_code, hourly_rate_cents, verification_status)
       VALUES ($1,$2,8000,'approved') RETURNING id`,
      [ids.workerUser, `DW-${runId}`],
    );
    ids.workerProfile = workerProfile.id;

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
    const domesticWorkersService = new DomesticWorkersService(
      dataSource.getRepository(DomesticWorkerProfile),
      { record: async () => undefined } as unknown as AuditLogService,
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
      dataSource.getRepository(DomesticWorkerBooking),
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
      domesticWorkersService,
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
      await q(`DELETE FROM domestic_worker_profiles WHERE id = $1`, [ids.workerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.workerUser]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.workerRateService, ids.fixedService]]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('worker_rate بلا domestic_worker_profile_id: يترفض VAL_001', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.workerRateService,
        address_id: ids.address,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('worker_rate + domestic_worker_profile_id + duration_hours: يتسجّل ACCEPTED مباشرة، السعر = hourlyRateCents × duration_hours', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.workerRateService,
      address_id: ids.address,
      domestic_worker_profile_id: ids.workerProfile,
      duration_hours: 3,
    } as never);
    expect(order.orderStatus).toBe(OrderStatus.ACCEPTED);
    expect(order.technicianId).toBeNull();
    expect(order.domesticWorkerProfileId).toBe(ids.workerProfile);
    expect(order.totalAmountCents).toBe(8000 * 3);
    expect(order.assignedAt).not.toBeNull();
    expect(order.acceptedAt).not.toBeNull();
  });

  it('domestic_worker_profile_id + payment_method (دفع مقدّم): يترفض — مش مدعوم لسه (ADR-0029)', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.workerRateService,
        address_id: ids.address,
        domestic_worker_profile_id: ids.workerProfile,
        duration_hours: 2,
        payment_method: 'card',
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('domestic_worker_profile_id على خدمة fixed عادية (مش worker_rate): يترفض', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.fixedService,
        address_id: ids.address,
        domestic_worker_profile_id: ids.workerProfile,
        duration_hours: 2,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('رجريشن: خدمة عادية بلا domestic_worker_profile_id لسه بتشتغل زي زمان (SEARCHING_TECHNICIAN)', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.fixedService,
      address_id: ids.address,
    } as never);
    expect(order.orderStatus).toBe(OrderStatus.SEARCHING_TECHNICIAN);
    expect(order.domesticWorkerProfileId).toBeNull();
    expect(order.totalAmountCents).toBe(50000);
  });
});
