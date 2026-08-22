import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { Order, OrderStatus, OrderType } from './entities/order.entity';
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

/**
 * Script 7 Phase 23 — بَقّة حقيقية اتلقطت: إعادة الزيارة تحت الضمان (order_type=revisit) بتاخد
 * warranty_expires_at جديدة بالكامل وقت اكتمالها (نفس settleAndComplete() لأي طلب مكتمل، بلا
 * استثناء) — من غير فحص صريح، كانت إعادة الزيارة نفسها تقدر تبقى original_order_id لإعادة زيارة
 * تانية، وهكذا للأبد: خدمة مجانية بلا نهاية بمجرد ما العميل يطلب إعادة زيارة قبل ما الضمان يخلص
 * في كل مرة، بلا أي تعويض للفني بعد الطلب الأصلي المدفوع.
 */
describe('OrdersService.create() — إعادة الزيارة تحت الضمان مسموحة مرة واحدة بس (Script 7 Phase 23)', () => {
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
      `مدينة ضمان ${runId}`,
      `Warranty City ${runId}`,
      `test-city-wty-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق ضمان ${runId}`,
      `Warranty Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة ضمان ${runId}`,
      `Warranty Category ${runId}`,
      `test-category-wty-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, allows_emergency)
       VALUES ($1,$2,$3,'fixed',30000,20,30,false) RETURNING id`,
      [ids.category, `خدمة ضمان ${runId}`, `test-service-wty-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2033${runId}`.slice(0, 15),
      `عميل ضمان ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع ضمان ${runId}`],
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

  /** بيبني طلب COMPLETED مباشرة عبر SQL خام — بديل واقعي لدورة الحجز/التنفيذ الكاملة، بيثبت بس
   * حالة الطلب النهائية المطلوبة (مكتمل + ضمان لسه سارٍ) بأقل تعقيد ممكن للاختبار. */
  async function createCompletedOrder(orderType: 'standard' | 'revisit', parentOrderId: string | null): Promise<string> {
    const warrantyExpiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const [{ next_human_readable_number: orderNumber }] = await dataSource.query<
      { next_human_readable_number: string }[]
    >("SELECT next_human_readable_number('ORD')");
    const [row] = await q(
      `INSERT INTO orders (
         order_number, customer_id, service_id, address_id, service_zone_id, order_type, booking_mode,
         order_status, estimated_price_cents, inspection_fee_cents, surge_amount_cents, total_amount_cents,
         payment_status, placed_at, closed_at, warranty_expires_at, parent_order_id, source_channel
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'individual','completed',$7,0,0,$7,'paid',now(),now(),$8,$9,'customer_app'
       ) RETURNING id`,
      [
        orderNumber,
        ids.customerProfile,
        ids.service,
        ids.address,
        ids.zone,
        orderType,
        orderType === 'revisit' ? 0 : 30000,
        warrantyExpiresAt,
        parentOrderId,
      ],
    );
    return row.id;
  }

  it('إعادة زيارة لطلب أصلي عادي (standard) مكتمل تحت الضمان — بتنجح وبتبقى مجانية بالكامل', async () => {
    const originalOrderId = await createCompletedOrder('standard', null);
    const revisit = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      original_order_id: originalOrderId,
    } as never);
    expect(revisit.orderType).toBe(OrderType.REVISIT);
    expect(revisit.totalAmountCents).toBe(0);
    expect(revisit.parentOrderId).toBe(originalOrderId);
  });

  it('إعادة زيارة لإعادة زيارة تانية (سلسلة) — بترفض بوضوح، مش خدمة مجانية بلا نهاية', async () => {
    const originalOrderId = await createCompletedOrder('standard', null);
    const firstRevisitId = await createCompletedOrder('revisit', originalOrderId);

    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.service,
        address_id: ids.address,
        original_order_id: firstRevisitId,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });
});
