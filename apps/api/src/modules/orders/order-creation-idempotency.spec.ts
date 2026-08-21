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

/**
 * Script 7 Phase 9 (Order Creation — idempotency) — بَقّة حقيقية اتلقطت: `POST /orders` —
 * أهم endpoint في المنصة كلها من ناحية الأثر التشغيلي/المالي (بيوزّع فني حقيقي، وممكن يخصم
 * محفظة لو دفع prepaid) — كان بلا أي حماية Idempotency-Key خالص، بعكس كل عمليات الدفع
 * (payments.controller.ts) اللي بتفرض الهيدر ده صراحة (docs/01-master-plan.md §1.4). عميل
 * بيدوس زرار "أكّد الحجز" مرتين (شبكة بطيئة، double-tap، إعادة إرسال بعد timeout) كان يقدر
 * ينشئ طلبين حقيقيين لنفس النية — فني بيتوزّع مرتين.
 *
 * الإصلاح: نفس نمط `PaymentsService.payWithWallet()` بالحرف — عمود `idempotency_key` (migration
 * 0139) بفهرس فريد جزئي على `(customer_id, idempotency_key)`، فحص مبكر (تحسين أداء) + الفهرس
 * الفريد نفسه هو الحماية الحقيقية ضد السباق (نداءين متزامنين بالظبط).
 */
describe('OrdersService.create() — Idempotency-Key يمنع تكرار الطلب (Script 7 Phase 9)', () => {
  let dataSource: DataSource;
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

  async function countOrdersForCustomer(): Promise<number> {
    const [{ count }] = await q(`SELECT COUNT(*)::int AS count FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
    return Number(count);
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
      `مدينة idempotency ${runId}`,
      `Idempotency City ${runId}`,
      `test-city-idem-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق idempotency ${runId}`,
      `Idempotency Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة idempotency ${runId}`,
      `Idempotency Category ${runId}`,
      `test-category-idem-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة idempotency ${runId}`, `test-service-idem-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2031${runId}`.slice(0, 15),
      `عميل idempotency ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع idempotency ${runId}`],
    );
    ids.address = address.id;

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
      {} as never, // orderTeamService (docs/08 §35) — مش متنادى في المسار ده
      {} as never, // domesticWorkersService (ADR-0029) — مش متنادى في المسار ده
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
      await dataSource.destroy();
    }
  });

  it('نفس المفتاح مرتين ورا بعض (retry بعد استلام الرد الأول): يرجّع نفس الطلب — مش ينشئ نسخة تانية', async () => {
    const key = `idem-sequential-${runId}`;
    const first = await ordersService.create(
      ids.customerUser,
      { service_id: ids.service, address_id: ids.address } as never,
      undefined,
      undefined,
      key,
    );
    const second = await ordersService.create(
      ids.customerUser,
      { service_id: ids.service, address_id: ids.address } as never,
      undefined,
      undefined,
      key,
    );
    expect(second.id).toBe(first.id);
    expect(await countOrdersForCustomer()).toBe(1);
  });

  it('مفتاح مختلف: بينشئ طلب تاني عادي — مفيش قمع خاطئ لطلبات حقيقية مختلفة', async () => {
    const before = await countOrdersForCustomer();
    const order = await ordersService.create(
      ids.customerUser,
      { service_id: ids.service, address_id: ids.address } as never,
      undefined,
      undefined,
      `idem-different-${runId}`,
    );
    expect(order).toBeDefined();
    expect(await countOrdersForCustomer()).toBe(before + 1);
  });

  it('نداءين متزامنين تمامًا بنفس المفتاح (سباق حقيقي، مش retry متتالي): طلب واحد بس يتسجّل', async () => {
    const key = `idem-concurrent-${runId}`;
    const before = await countOrdersForCustomer();
    const [a, b] = await Promise.all([
      ordersService.create(ids.customerUser, { service_id: ids.service, address_id: ids.address } as never, undefined, undefined, key),
      ordersService.create(ids.customerUser, { service_id: ids.service, address_id: ids.address } as never, undefined, undefined, key),
    ]);
    expect(a.id).toBe(b.id);
    expect(await countOrdersForCustomer()).toBe(before + 1);
  });

  it('من غير idempotency key خالص (عميل قديم لسه ما حدّثش): السلوك القديم فاضل زي ما هو — كل نداء بينشئ طلب جديد', async () => {
    const before = await countOrdersForCustomer();
    await ordersService.create(ids.customerUser, { service_id: ids.service, address_id: ids.address } as never);
    await ordersService.create(ids.customerUser, { service_id: ids.service, address_id: ids.address } as never);
    expect(await countOrdersForCustomer()).toBe(before + 2);
  });
});
