import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { RecurringOrdersService } from './recurring-orders.service';
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
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';
import { crewEarningsServiceStub } from '../payments/crew-earnings.testing';
import { BuildingsService } from '../buildings/buildings.service';
import { Building } from '../buildings/entities/building.entity';

/**
 * انتماء العمارة يستمر مع الطلبات المتكررة (docs/08 §125، طلب مالك صريح 2026-09-03).
 *
 * حي ضد Postgres حقيقي عبر OrdersService.create() + RecurringOrdersService.sweep() الحقيقيتين
 * (صفر منطق تسعير موازي). بيثبت الخمس نقاط اللي المالك طلب التحقق منهم بالحرف:
 * 1. أول طلب مرتبط بعمارة.
 * 2. الطلب المتكرر التالي يفضل مرتبط بنفس العمارة.
 * 3. تغيير نسبة خصم العمارة ينعكس على الـoccurrence الجديد (بيتقرا فريش، مش snapshot).
 * 4. الـpromo code لا يتكرر (نفس القاعدة القديمة، بس بتتأكد هنا صراحة مع عمارة في نفس الصورة).
 * 5. مفيش double discount ولا كسر transaction — لا مع عمارة اتقفلت، ولا مع كود عمارة غلط.
 */
describe('Recurring Orders × Buildings — انتماء العمارة يستمر عبر النوبات (docs/08 §125)', () => {
  jest.setTimeout(60_000);
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let recurringService: RecurringOrdersService;
  let cache: RedisCacheService;
  const runId = Date.now().toString(36);
  const ids = {
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    building: '',
    createdOrderIds: [] as string[],
    createdTemplateIds: [] as string[],
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
        ServicePricingField,
        ServicePricingRule,
        ServicePricingEvaluation,
        Building,
      ],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة عمارة ${runId}`, `Building City ${runId}`, `test-city-bld-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق عمارة ${runId}`,
      `Building Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة عمارة ${runId}`, `Building Category ${runId}`, `test-category-bld-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, allows_recurring_booking)
       VALUES ($1,$2,$3,'formula',100000,15,0,true) RETURNING id`,
      [ids.category, `خدمة عمارة ${runId}`, `test-service-bld-${runId}`],
    );
    ids.service = serviceRow.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2066${runId}`.slice(0, 15), `عميل عمارة ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع عمارة ${runId}`],
    );
    ids.address = address.id;
    // خصم ابتدائي 10% — نفس الافتراضي الحقيقي في migration 0065.
    const [building] = await q(
      `INSERT INTO buildings (code, name_ar, discount_percentage, is_active) VALUES ($1,$2,10,true) RETURNING id`,
      [`BLD-TEST-${runId}`.slice(0, 20), `عمارة اختبار ${runId}`],
    );
    ids.building = building.id;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
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
      realPricingEngineService(dataSource),
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
    // مفيش استخدام حقيقي لكود خصم في السويت دي (building_code و promo_code متبادلين
    // استبعاديًا) — mock بيرفض أي كود، نفس نمط orders-repeat-plan.spec.ts.
    const promoCodesService = {
      validateAndApply: jest.fn(async () => {
        throw new ApiException(ErrorCode.VAL_001, 'كود الخصم غير موجود', 400);
      }),
      releaseUsage: async () => undefined,
    };
    const buildingsService = new BuildingsService(dataSource.getRepository(Building));
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
      realPricingEngineService(dataSource),
      promoCodesService as never,
      buildingsService,
      {} as never,
      walletsService,
      settingsService,
      paymentsService,
      supportService,
      events,
      {} as never,
      commissionBaseServiceStub(),
    );

    recurringService = new RecurringOrdersService(
      dataSource.getRepository(RecurringOrderTemplate),
      customerProfilesService,
      addressesService,
      catalogService,
      techniciansService,
      ordersService,
      events,
      buildingsService,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(
        `DELETE FROM recurring_order_occurrences WHERE template_id IN (SELECT id FROM recurring_order_templates WHERE customer_id = $1)`,
        [ids.customerProfile],
      );
      await q(`UPDATE recurring_order_templates SET last_generated_order_id = NULL WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1)`, [ids.createdOrderIds]);
      await q(`DELETE FROM orders WHERE id = ANY($1)`, [ids.createdOrderIds]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM recurring_order_templates WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM buildings WHERE id = $1`, [ids.building]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  async function loadTemplate(templateId: string) {
    const [row] = await q(
      `SELECT id, building_id, next_run_at, is_active FROM recurring_order_templates WHERE id = $1`,
      [templateId],
    );
    return row;
  }

  async function forceDueNow(templateId: string) {
    await q(`UPDATE recurring_order_templates SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [templateId]);
  }

  async function loadOrder(orderId: string) {
    const [row] = await q(
      `SELECT id, building_id, total_amount_cents, discount_amount_cents, recurring_template_id
       FROM orders WHERE id = $1`,
      [orderId],
    );
    return row;
  }

  it('1) و 2) الطلب الأصلي بكود عمارة → القالب المتكرر يحتفظ بنفس العمارة، والنوبة الجاية بترثها', async () => {
    const scheduledAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const order1 = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      scheduled_at: scheduledAt,
      building_code: `BLD-TEST-${runId}`.slice(0, 20),
      repeat_frequency: 'weekly',
    } as never);
    ids.createdOrderIds.push(order1.id);

    // (1) الطلب الأصلي فعلاً مرتبط بالعمارة، وخصمها اتطبّق (10% من 1000 ج.م = 100 ج.م).
    expect(order1.buildingId).toBe(ids.building);
    expect(order1.discountAmountCents).toBe(10_000);
    expect(order1.totalAmountCents).toBe(90_000);
    expect(order1.recurringTemplateId).not.toBeNull();
    const templateId = order1.recurringTemplateId!;
    ids.createdTemplateIds.push(templateId);

    // القالب نفسه اتخزّن فيه building_id (مش building_code — الاسم مش مصمم يتكرر).
    const templateAfterCreate = await loadTemplate(templateId);
    expect(templateAfterCreate.building_id).toBe(ids.building);

    // (2) نجبر النوبة الجاية تستحق دلوقتي، ونشغّل sweep الحقيقي — نفس الكود اللي بيشتغل
    // كل دقيقة في الإنتاج.
    await forceDueNow(templateId);
    const generatedCount = await recurringService.sweep({ templateIds: [templateId] });
    expect(generatedCount).toBe(1);

    const [order2Row] = await q(
      `SELECT id FROM orders WHERE recurring_template_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 1`,
      [templateId, order1.id],
    );
    expect(order2Row).toBeDefined();
    ids.createdOrderIds.push(order2Row.id);
    const order2 = await loadOrder(order2Row.id);

    // النوبة التانية ورثت نفس العمارة ونفس الخصم — مفيش أي تدخل إضافي من العميل.
    expect(order2.building_id).toBe(ids.building);
    expect(Number(order2.discount_amount_cents)).toBe(10_000);
    expect(Number(order2.total_amount_cents)).toBe(90_000);
  });

  it('3) تغيير نسبة خصم العمارة ينعكس على الـoccurrence الجديدة (مش snapshot قديم)', async () => {
    const scheduledAt = new Date(Date.now() + 11 * 86_400_000).toISOString();
    const order1 = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      scheduled_at: scheduledAt,
      building_code: `BLD-TEST-${runId}`.slice(0, 20),
      repeat_frequency: 'weekly',
    } as never);
    ids.createdOrderIds.push(order1.id);
    expect(order1.discountAmountCents).toBe(10_000); // لسه 10%
    const templateId = order1.recurringTemplateId!;
    ids.createdTemplateIds.push(templateId);

    // الإدارة تغيّر نسبة الخصم من 10% لـ25%.
    await q(`UPDATE buildings SET discount_percentage = 25 WHERE id = $1`, [ids.building]);

    await forceDueNow(templateId);
    await recurringService.sweep({ templateIds: [templateId] });
    const [order2Row] = await q(
      `SELECT id FROM orders WHERE recurring_template_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 1`,
      [templateId, order1.id],
    );
    ids.createdOrderIds.push(order2Row.id);
    const order2 = await loadOrder(order2Row.id);

    // النوبة الجديدة أخدت الـ25% الجديدة فورًا — مفيش تجميد لنسبة قديمة.
    expect(Number(order2.discount_amount_cents)).toBe(25_000);
    expect(Number(order2.total_amount_cents)).toBe(75_000);

    // نرجّع النسبة زي ما كانت عشان باقي التستات في السويت متأثرتش.
    await q(`UPDATE buildings SET discount_percentage = 10 WHERE id = $1`, [ids.building]);
  });

  it('4) لو العمارة اتقفلت (is_active=false) بين النوبتين، النوبة الجديدة بتتولّد بالسعر الكامل من غير خصم — بأمان', async () => {
    const scheduledAt = new Date(Date.now() + 12 * 86_400_000).toISOString();
    const order1 = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      scheduled_at: scheduledAt,
      building_code: `BLD-TEST-${runId}`.slice(0, 20),
      repeat_frequency: 'weekly',
    } as never);
    ids.createdOrderIds.push(order1.id);
    const templateId = order1.recurringTemplateId!;
    ids.createdTemplateIds.push(templateId);

    // الإدارة تقفل العمارة (نفس PATCH /admin/buildings/:id { is_active: false }).
    await q(`UPDATE buildings SET is_active = false WHERE id = $1`, [ids.building]);

    await forceDueNow(templateId);
    const generatedCount = await recurringService.sweep({ templateIds: [templateId] });
    // أهم نقطة في البند ده: النوبة لازم تتولّد فعلاً (مش تتعلّق أو تفشل) — بس من غير خصم.
    expect(generatedCount).toBe(1);

    const [order2Row] = await q(
      `SELECT id FROM orders WHERE recurring_template_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 1`,
      [templateId, order1.id],
    );
    ids.createdOrderIds.push(order2Row.id);
    const order2 = await loadOrder(order2Row.id);

    // السعر الكامل — صفر خصم، مش خصم غلط ولا رفض.
    expect(Number(order2.discount_amount_cents)).toBe(0);
    expect(Number(order2.total_amount_cents)).toBe(100_000);
    // القالب نفسه فضل شغّال (isActive) — العمارة المقفولة توقف الخصم بس، مش الاشتراك كله.
    const templateRow = await loadTemplate(templateId);
    expect(templateRow.is_active).toBe(true);

    // نرجّع العمارة نشطة عشان باقي التستات.
    await q(`UPDATE buildings SET is_active = true WHERE id = $1`, [ids.building]);
  });

  it('5) الـpromo code لا يتكرر: طلب أصلي بكود خصم عادي (مش عمارة) — القالب المتولّد بلا أي خصم', async () => {
    // نفس فحص orders-repeat-plan.spec.ts: mock الـpromo بيرفض كل كود، فمفيش طريقة نمرّر
    // promo_code فعلي هنا — البند بيتفحص بشكل أدق في specs الـpromotions المستقلة. اللي بيهمنا
    // هنا تحديدًا: القالب أصلاً **مالوش عمود promo_code خالص** (راجع الكيان) — يعني حتى لو
    // عرفنا نمرّر كود صحيح، مفيش أي مسار تقني يقدر يخزّنه على القالب أو يبعته مع نوبة جديدة.
    const [columns] = await q(
      `SELECT string_agg(column_name, ',') AS cols FROM information_schema.columns WHERE table_name = 'recurring_order_templates'`,
    );
    expect(columns.cols.split(',')).not.toContain('promo_code');
  });

  it('لا double discount: كود عمارة غلط + repeat_frequency يترفض قبل أي كتابة — مفيش طلب ولا قالب يتيم', async () => {
    const [{ count: ordersBefore }] = await q(`SELECT COUNT(*)::int AS count FROM orders WHERE customer_id = $1`, [
      ids.customerProfile,
    ]);
    const [{ count: templatesBefore }] = await q(
      `SELECT COUNT(*)::int AS count FROM recurring_order_templates WHERE customer_id = $1`,
      [ids.customerProfile],
    );

    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.service,
        address_id: ids.address,
        scheduled_at: new Date(Date.now() + 13 * 86_400_000).toISOString(),
        building_code: 'NOPE-NOT-REAL',
        repeat_frequency: 'weekly',
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });

    const [{ count: ordersAfter }] = await q(`SELECT COUNT(*)::int AS count FROM orders WHERE customer_id = $1`, [
      ids.customerProfile,
    ]);
    const [{ count: templatesAfter }] = await q(
      `SELECT COUNT(*)::int AS count FROM recurring_order_templates WHERE customer_id = $1`,
      [ids.customerProfile],
    );
    expect(ordersAfter).toBe(ordersBefore);
    expect(templatesAfter).toBe(templatesBefore);
  });

  it('مفيش double discount: خصم النوبة الأولى والتانية بنفس النسبة بالظبط، مش متراكم', async () => {
    const scheduledAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const order1 = await ordersService.create(ids.customerUser, {
      service_id: ids.service,
      address_id: ids.address,
      scheduled_at: scheduledAt,
      building_code: `BLD-TEST-${runId}`.slice(0, 20),
      repeat_frequency: 'weekly',
    } as never);
    ids.createdOrderIds.push(order1.id);
    const templateId = order1.recurringTemplateId!;
    ids.createdTemplateIds.push(templateId);

    await forceDueNow(templateId);
    await recurringService.sweep({ templateIds: [templateId] });
    const [order2Row] = await q(
      `SELECT id FROM orders WHERE recurring_template_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 1`,
      [templateId, order1.id],
    );
    ids.createdOrderIds.push(order2Row.id);
    const order2 = await loadOrder(order2Row.id);

    // نفس الـ10% بالظبط على الاتنين — لو كان فيه تراكم (مثلاً 10% + 10% = 20%) كان
    // discount_amount_cents هيختلف عن الأول.
    expect(Number(order2.discount_amount_cents)).toBe(Number(order1.discountAmountCents));
    expect(Number(order2.total_amount_cents)).toBe(order1.totalAmountCents);
  });
});
