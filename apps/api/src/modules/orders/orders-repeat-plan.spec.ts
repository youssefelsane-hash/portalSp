import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { RecurringOrderTemplate } from './entities/recurring-order-template.entity';
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
 * "كرّر الحجز ده" (migration 0176) — POST /orders مع repeat_frequency لازم ينتج:
 * 1. طلب عادي كامل بنفس المسار الطبيعي (نفس تسعير/حالة/تاريخ).
 * 2. قالب متكرر جوّه **نفس** الـtransaction (ذرّي) أول موعد له = الموعد المحجوز + دورة تكرار.
 * الاختبار حي ضد Postgres حقيقي عبر OrdersService.create() الحقيقية بالحرف (صفر منطق موازي).
 */
describe('OrdersService.create() — repeat_frequency ينشئ طلب عادي + خطة متكررة ذرّياً', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
  const runId = Date.now().toString(36);
  const ids = {
    city: '',
    zone: '',
    category: '',
    serviceRepeatable: '',
    servicePlain: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    createdOrderIds: [] as string[],
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
        RecurringOrderTemplate,
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
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة تكرار ${runId}`, `Repeat City ${runId}`, `test-city-repeat-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تكرار ${runId}`,
      `Repeat Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة تكرار ${runId}`, `Repeat Category ${runId}`, `test-category-repeat-${runId}`],
    );
    ids.category = category.id;
    // خدمة مفعّل فيها التكرار + خدمة عادية (الافتراضي allows_recurring_booking=false)
    const [serviceRepeatable] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, allows_recurring_booking)
       VALUES ($1,$2,$3,'fixed',30000,15,0,true) RETURNING id`,
      [ids.category, `خدمة بتتكرر ${runId}`, `test-service-repeat-${runId}`],
    );
    ids.serviceRepeatable = serviceRepeatable.id;
    const [servicePlain] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',10000,15,0) RETURNING id`,
      [ids.category, `خدمة عادية ${runId}`, `test-service-plain-${runId}`],
    );
    ids.servicePlain = servicePlain.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2044${runId}`.slice(0, 15), `عميل تكرار ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع تكرار ${runId}`],
    );
    ids.address = address.id;

    const cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(
      dataSource.getRepository(Setting),
      { record: async () => undefined } as unknown as AuditLogService,
      cache,
    );
    const geoService = new GeoService(
      dataSource.getRepository(City),
      dataSource.getRepository(Area),
      dataSource.getRepository(ServiceZone),
      dataSource,
    );
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
      {} as never,
    );
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const walletsService = new WalletsService(
      dataSource.getRepository(Wallet),
      dataSource.getRepository(WalletTransaction),
      dataSource,
    );
    const technicianLevelsService = new TechnicianLevelsService(
      dataSource.getRepository(TechnicianLevelConfig),
      {} as unknown as AuditLogService,
    );
    const loyaltyService = new LoyaltyService(
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(LoyaltyTransaction),
      dataSource,
    );
    const scheduleService = new TechnicianScheduleService(dataSource.getRepository(TechnicianScheduleSlot));
    const events = new EventEmitter2();
    // mock كفاية للمسار ده — الفحص الحقيقي للكود بيتعمل في specs الـpromotions المستقلة
    const promoCodesService = {
      validateAndApply: jest.fn(async () => {
        throw new ApiException(ErrorCode.VAL_001, 'كود الخصم غير موجود', 400);
      }),
      releaseUsage: async () => undefined,
    };
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
      promoCodesService as never,
      {} as never,
      {} as never,
      walletsService,
      settingsService,
      paymentsService,
      supportService,
      events,
      {} as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM recurring_order_occurrences WHERE template_id IN (SELECT id FROM recurring_order_templates WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`UPDATE recurring_order_templates SET last_generated_order_id = NULL WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM recurring_order_templates WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1)`, [ids.createdOrderIds]);
      await q(`DELETE FROM orders WHERE id = ANY($1)`, [ids.createdOrderIds]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.serviceRepeatable, ids.servicePlain]]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  async function loadTemplatesForCustomer() {
    return q(
      `SELECT id, service_id, frequency, next_run_at::text AS next_run_at, payment_method, field_values, is_active
       FROM recurring_order_templates WHERE customer_id = $1 ORDER BY created_at DESC`,
      [ids.customerProfile],
    );
  }

  it('خدمة غير مفعّل فيها التكرار + repeat_frequency: يترفض بلا طلب وبلا قالب', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.servicePlain,
        address_id: ids.address,
        scheduled_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        repeat_frequency: 'weekly',
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
    expect(await loadTemplatesForCustomer()).toHaveLength(0);
  });

  it('طوارئ + repeat_frequency: يترفض (الطوارئ استجابة فورية، مش جدولة تتكرر)', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.serviceRepeatable,
        address_id: ids.address,
        booking_mode: 'emergency',
        repeat_frequency: 'weekly',
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
    expect(await loadTemplatesForCustomer()).toHaveLength(0);
  });

  it('أسبوعي: الطلب العادي اتعمل زي أي حجز + خطة بأول موعد بعد أسبوع بنفس التوقيت', async () => {
    // 2026-09-01 10:00 UTC — تاريخ ثابت في المستقبل عشان التأكيد على القيمة الدقيقة
    const scheduledAt = '2026-09-01T10:00:00.000Z';
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceRepeatable,
      address_id: ids.address,
      scheduled_at: scheduledAt,
      problem_description: 'تنظيف أسبوعي',
      payment_method: 'card',
      field_values: undefined,
      repeat_frequency: 'weekly',
    } as never);
    ids.createdOrderIds.push(order.id);

    // الطلب نفسه: مسار عادي تمامًا — نوع standard (مش recurring!)، سعر الخدمة وقت الإنشاء،
    // ومفيش عليه recurring_template_id (ده أول حجز، مش نوبة متولّدة).
    expect(order.orderType).toBe('standard');
    expect(order.totalAmountCents).toBe(30000);
    expect(order.recurringTemplateId).toBeNull();
    expect(order.scheduledAt?.toISOString()).toBe(scheduledAt);
    expect(order.orderStatus).toBe('pending_payment'); // دفع مقدّم كارت — نفس قواعد ADR-0013 العادية

    const templates = await loadTemplatesForCustomer();
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      service_id: ids.serviceRepeatable,
      frequency: 'weekly',
      payment_method: 'card',
      is_active: true,
    });
    // أول موعد للخطة = الموعد المحجوز + 7 أيام **بنفس التوقيت** (مش "بكرة" ولا clamp غلط)
    expect(new Date(templates[0].next_run_at).toISOString()).toBe('2026-09-08T10:00:00.000Z');
  });

  it('شهري يوم 31: أول موعد للخطة يتـclamp لآخر يوم فعلي في الشهر الجاي (سنة كبيسة → 29)', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceRepeatable,
      address_id: ids.address,
      scheduled_at: '2028-01-31T14:30:00.000Z',
      repeat_frequency: 'monthly',
    } as never);
    ids.createdOrderIds.push(order.id);
    const templates = await loadTemplatesForCustomer();
    expect(new Date(templates[0].next_run_at).toISOString()).toBe('2028-02-29T14:30:00.000Z');
  });

  it('ذرّية العملية: فشل جوّه الـtransaction (كود خصم غلط) ميسيّبش أي أثر جزئي', async () => {
    const templatesBefore = await loadTemplatesForCustomer();
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.serviceRepeatable,
        address_id: ids.address,
        scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        promo_code: 'NOPE-BAD-CODE',
        repeat_frequency: 'weekly',
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
    // كل الـcreate() transaction واحدة: الطلب والقالب بيتعملوا مع بعض أو ولا حاجة — فعدد
    // القوالب بعد الفشل لازم يفضل زي ما كان بالظبط.
    const templatesAfter = await loadTemplatesForCustomer();
    expect(templatesAfter).toHaveLength(templatesBefore.length);
    const [{ count }] = await q(`SELECT COUNT(*)::int AS count FROM orders WHERE customer_id = $1`, [
      ids.customerProfile,
    ]);
    expect(Number(count)).toBe(2);
  });
});
