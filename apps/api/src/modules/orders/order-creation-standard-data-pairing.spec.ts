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

/**
 * Script 7 Phase 5 — بَقّة حقيقية اتلقطت في `OrdersService.create()`: تعليق DTO نفسه
 * (`create-order.dto.ts`) بيوثّق صراحة "الاتنين [standard_data_id/requested_units] لازم
 * يتبعتوا مع بعض أو ولا واحد فيهم — قرار عمل من المالك"، لكن الفحص الفعلي كان `&&` بسيط:
 * `if (dto.standard_data_id && dto.requested_units)`. الفحص ده بيسمح بالظبط بالحالة الممنوعة
 * في التعليق — لو العميل بعت واحد بس، الشرط بيبقى false فبيتصرف بالظبط زي حالة "ولا واحد فيهم"
 * بصمت: `durationEstimate=null`، فالطلب بيتسجّل بـ`requiredTechnicians=null`/`requiredAssistants=null`
 * بلا أي خطأ يوصل للعميل. النتيجة الحقيقية: `assistant-matching.service.ts:114`
 * (`if (!order.requiredAssistants || order.requiredAssistants <= 0) return;`) بيتخطى مطابقة
 * المساعدين تمامًا لشغلانة ممكن تحتاج طاقم فعليًا (مثلاً "محتاجة 4 صنايعية + 2 مساعد على الأقل"
 * حسب `service_standard_data.min_technicians/min_assistants`) — استبعاد صامت لمتطلب طاقم حقيقي،
 * بالظبط زي ما audit Phase 5 حذّر منه صراحة.
 *
 * الإصلاح: XOR check صريح بيرفض الحالة النصفية بـVAL_001 واضح قبل أي كتابة في الداتابيز (قبل
 * الـtransaction بالكامل)، فمفيش طلب بيتسجّل بمتطلبات طاقم ناقصة بصمت.
 */
describe('OrdersService.create() — standard_data_id/requested_units لازم يتبعتوا مع بعض (Script 7 Phase 5)', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    standardData: '',
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
      `مدينة اقتران قياسي ${runId}`,
      `Standard Pairing City ${runId}`,
      `test-city-sdp-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق اقتران قياسي ${runId}`,
      `Standard Pairing Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اقتران قياسي ${runId}`,
      `Standard Pairing Category ${runId}`,
      `test-category-sdp-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة اقتران قياسي ${runId}`, `test-service-sdp-${runId}`],
    );
    ids.service = service.id;
    // بيانات قياسية بتفرض حد أدنى طاقم حقيقي (2 صنايعي + 1 مساعد) — عشان لو الفحص القديم سمح
    // بمرور طلب بمتطلب ناقص، كان هيبان فورًا (assistant matching هتتخطى بلا أي مساعد مطلوب).
    const [standardData] = await q(
      `INSERT INTO service_standard_data
         (service_id, execution_type_ar, unit_ar, technician_daily_wage_cents, assistant_daily_wage_cents,
          productivity_per_day, min_technicians, min_assistants, is_active)
       VALUES ($1,'دهان','متر مربع',50000,30000,20,2,1,true) RETURNING id`,
      [ids.service],
    );
    ids.standardData = standardData.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2034${runId}`.slice(0, 15),
      `عميل اقتران قياسي ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع اقتران قياسي ${runId}`],
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
      {} as never, // installments repo (migration 0177)
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
      await q(`DELETE FROM service_standard_data WHERE id = $1`, [ids.standardData]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('standard_data_id من غير requested_units: يترفض بوضوح — مش يتسجّل الطلب بمتطلبات طاقم null بصمت', async () => {
    const before = await countOrdersForCustomer();
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.service,
        address_id: ids.address,
        standard_data_id: ids.standardData,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
    expect(await countOrdersForCustomer()).toBe(before);
  });

  it('requested_units من غير standard_data_id: يترفض بوضوح — نفس الحماية في الاتجاه التاني', async () => {
    const before = await countOrdersForCustomer();
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.service,
        address_id: ids.address,
        requested_units: 40,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
    expect(await countOrdersForCustomer()).toBe(before);
  });

  it('الاتنين مع بعض (المسار السليم): الطلب بيتسجّل بمتطلبات الطاقم المحسوبة فعليًا من service_standard_data', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      standard_data_id: ids.standardData,
      requested_units: 40,
    } as never);
    expect(order.standardDataId).toBe(ids.standardData);
    // productivity=20/يوم بالحد الأدنى (2 صنايعي) → لسه بمتطلب الحد الأدنى فمفيش مضاعف: 40/20 = 2 يوم.
    expect(order.requiredTechnicians).toBe(2);
    expect(order.requiredAssistants).toBe(1);
    expect(order.estimatedDurationDays).toBe(2);
  });

  it('ولا واحد فيهم (خدمة عادية بلا إنتاجية): الطلب بيتسجّل عادي بمتطلبات طاقم null — مش متأثر بالإصلاح', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
    } as never);
    expect(order.standardDataId).toBeNull();
    expect(order.requiredTechnicians).toBeNull();
    expect(order.requiredAssistants).toBeNull();
  });
});
