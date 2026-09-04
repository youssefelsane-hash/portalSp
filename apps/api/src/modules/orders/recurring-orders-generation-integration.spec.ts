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
import { RecurringOrdersService } from './recurring-orders.service';
import { RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import {
  RecurringOrderAwaitingPaymentEvent,
} from '../../common/events/recurring-order-awaiting-payment.event';
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
import { PricingEngineService } from '../pricing/pricing-engine.service';

/**
 * الدورة الكاملة حي ضد Postgres حقيقي: خطة متكررة → sweep → طلب **عادي** حقيقي عبر
 * OrdersService.create() الحقيقية (صفر منطق موازي) → تسعير لحظة التوليد، حماية التكرار،
 * فشل مرئي (خدمة مقفولة / عميل متبلوك)، وأمان إلغاء الخطة على الطلبات المتولّدة فعلاً.
 */
describe('RecurringOrdersService — توليد طلبات عادية عبر OrdersService.create() الحقيقية', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let recurringService: RecurringOrdersService;
  let cache: RedisCacheService;
  const emitSpy = jest.fn();
  const runId = Date.now().toString(36);
  const ids = {
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    template: '',
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
        LoyaltyTransaction, ServicePricingField, ServicePricingRule, ServicePricingEvaluation],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة تكامل ${runId}`, `Gen City ${runId}`, `test-city-gen-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تكامل ${runId}`,
      `Gen Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة تكامل ${runId}`, `Gen Category ${runId}`, `test-category-gen-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, allows_recurring_booking)
       VALUES ($1,$2,$3,'formula',30000,15,0,true) RETURNING id`,
      [ids.category, `خدمة تكامل ${runId}`, `test-service-gen-${runId}`],
    );
    ids.service = serviceRow.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2055${runId}`.slice(0, 15), `عميل تكامل ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع تكامل ${runId}`],
    );
    ids.address = address.id;

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
    // EventEmitter2 حقيقي + spy — نفس الـemitter اللي create() بيصدّر عليه ORDER_CREATED_EVENT
    // (مفيش listeners مسجّلين، فالتوزيع مش هيحصل هنا — ده مجال اختبارات الـlive suites).
    const events = new EventEmitter2();
    events.on('orders.recurring_order_awaiting_payment', (...args: unknown[]) => emitSpy(...args));
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
      {} as never, // buildingsService — انتماء العمارة مغطّى في recurring-orders-building-affiliation.spec.ts
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      // الترتيب مهم: الطلبات بتشاور على الخطة (FK) — لازم تتنضف الأول
      await q(`DELETE FROM recurring_order_occurrences WHERE template_id = $1`, [ids.template]);
      await q(`UPDATE recurring_order_templates SET last_generated_order_id = NULL WHERE id = $1`, [ids.template]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE recurring_template_id = $1)`, [ids.template]);
      await q(`DELETE FROM orders WHERE recurring_template_id = $1`, [ids.template]);
      await q(`DELETE FROM order_status_history WHERE order_id = ANY($1)`, [ids.createdOrderIds]);
      await q(`DELETE FROM orders WHERE id = ANY($1)`, [ids.createdOrderIds]);
      await q(`UPDATE recurring_order_templates SET last_generated_order_id = NULL WHERE id = $1`, [ids.template]);
      await q(`DELETE FROM recurring_order_templates WHERE id = $1`, [ids.template]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  async function seedDueTemplate(extra?: string): Promise<void> {
    const [existing] = ids.template ? await q(`SELECT id FROM recurring_order_templates WHERE id = $1`, [ids.template]) : [];
    if (!existing) {
      const [template] = await q(
        `INSERT INTO recurring_order_templates
           (customer_id, service_id, address_id, booking_mode, frequency, next_run_at, is_active)
         VALUES ($1,$2,$3,'individual','weekly', now() - interval '1 minute', false)
         RETURNING id`,
        [ids.customerProfile, ids.service, ids.address],
      );
      ids.template = template.id;
    }
    // is_active=false افتراضيًا — القالب بيظهر للمطابقة بس جوّه نافذة sweepOwn() المقفولة
    // (نفس انضباط الـspecs المجاورة: ملف اختبار موازي على نفس القاعدة مايقدرش يخطف نوبتنا).
    await q(
      `UPDATE recurring_order_templates SET is_active = false, deleted_at = NULL, next_run_at = now() - interval '1 minute' WHERE id = $1`,
      [ids.template],
    );
    if (extra) await q(extra);
  }

  async function makeTemplateDueAgain(): Promise<void> {
    await seedDueTemplate();
  }

  // نفس قفل الـspecs المجاورة (71_208_019) — التفعيل بيحصل جوّه القفل وبس، والفلترة بقالبنا.
  async function sweepOwn(opts?: { stayInactive?: boolean }): Promise<number> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query(`SELECT pg_advisory_lock($1)`, [71_208_019]);
    try {
      if (!opts?.stayInactive) {
        await runner.query(`UPDATE recurring_order_templates SET is_active = true WHERE id = $1`, [ids.template]);
      }
      try {
        return await recurringService.sweep({ templateIds: [ids.template] });
      } finally {
        if (!opts?.stayInactive) {
          await runner.query(`UPDATE recurring_order_templates SET is_active = false WHERE id = $1`, [ids.template]);
        }
      }
    } finally {
      await runner.query(`SELECT pg_advisory_unlock($1)`, [71_208_019]);
      await runner.release();
    }
  }

  async function loadOrders(): Promise<
    { id: string; order_type: string; order_status: string; total_amount_cents: number; scheduled_at: Date; recurring_template_id: string | null; recurring_occurrence_at: Date | null; payment_status: string }[]
  > {
    return q(
      `SELECT id, order_type::text AS order_type, order_status::text AS order_status, total_amount_cents,
              scheduled_at, recurring_template_id, recurring_occurrence_at, payment_status::text AS payment_status
       FROM orders WHERE recurring_template_id = $1 OR id = ANY($2)
       ORDER BY created_at ASC`,
      [ids.template, ids.createdOrderIds.length ? ids.createdOrderIds : ['00000000-0000-0000-0000-000000000000']],
    );
  }

  async function loadOccurrence(): Promise<{ status: string; attempt_count: number; last_error: string | null; order_id: string | null }> {
    // آخر نوبة بالجدولة — بعد النجاح بتبقى completed بموعد قديم، وبعد الـdead-letter بتبقى
    // manual_review بنفس الموعد القديم (next_run_at بيتقدّم للماضي الجاي مش للنوبة الفاشلة).
    const [row] = await q(
      `SELECT status::text AS status, attempt_count, last_error, order_id
       FROM recurring_order_occurrences
       WHERE template_id = $1
       ORDER BY scheduled_for DESC LIMIT 1`,
      [ids.template],
    );
    return row;
  }

  it('الموعد المستحق بيولّد طلب عادي واحد بالظبط عبر المسار الطبيعي كامل', async () => {
    await seedDueTemplate();
    await sweepOwn();

    const orders = await loadOrders();
    expect(orders).toHaveLength(1);
    const [order] = orders;
    ids.createdOrderIds.push(order.id);

    // طلب عادي حقيقي: النوع recurring (تصنيف)، الحالة/الدفع زي أي حجز كاش افتراضي، السعر =
    // سعر الخدمة وقت التوليد (30000)، الموعد = نوبة الخطة نفسها، ومربوط بخطته للتتبع.
    expect(order.order_type).toBe('recurring');
    expect(order.order_status).toBe('searching_technician');
    expect(order.payment_status).toBe('unpaid');
    expect(order.total_amount_cents).toBe(30000);
    expect(order.recurring_template_id).toBe(ids.template);
    expect(order.recurring_occurrence_at).not.toBeNull();
    expect(new Date(order.scheduled_at).getTime()).toBe(new Date(order.recurring_occurrence_at!).getTime());

    const [template] = await q(
      `SELECT next_run_at, last_generated_order_id, consecutive_failure_count FROM recurring_order_templates WHERE id = $1`,
      [ids.template],
    );
    expect(template.last_generated_order_id).toBe(order.id);
    expect(template.consecutive_failure_count).toBe(0);
    // next_run_at اتقدّم أسبوع بنفس التوقيت (نوبة أسبوعية)
    expect(new Date(template.next_run_at).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    const occurrence = await loadOccurrence();
    expect(occurrence.status).toBe('completed');
    expect(occurrence.order_id).toBe(order.id);
  });

  it('sweep تاني مباشًرة: مفيش طلب تاني (الحماية من التوليد المزدوج)', async () => {
    await sweepOwn();
    const orders = await loadOrders();
    expect(orders).toHaveLength(1);
  });

  it('سweep متوازيين (workerين): نفس الطلب الواحد بس — القفل الفريد على مستوى قاعدة البيانات', async () => {
    await makeTemplateDueAgain();
    // نفس لحظة التنافس بالظبط — القفل المشترك بيتاخد مرة واحدة والسباق بين الـsweep جواه
    // (لو كل sweep خد القفل لوحده كانوا اتسلسلوا ومش سباق خالص).
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query(`SELECT pg_advisory_lock($1)`, [71_208_019]);
    try {
      await runner.query(`UPDATE recurring_order_templates SET is_active = true WHERE id = $1`, [ids.template]);
      try {
        await Promise.all([
          recurringService.sweep({ templateIds: [ids.template] }),
          recurringService.sweep({ templateIds: [ids.template] }),
        ]);
      } finally {
        await runner.query(`UPDATE recurring_order_templates SET is_active = false WHERE id = $1`, [ids.template]);
      }
    } finally {
      await runner.query(`SELECT pg_advisory_unlock($1)`, [71_208_019]);
      await runner.release();
    }
    const orders = await loadOrders();
    expect(orders).toHaveLength(2); // الأول من الاختبار الفات + واحد جديد بس رغم الاستدعاءين المتوازيين
    const distinctOccurrences = await q(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT DISTINCT recurring_occurrence_at FROM orders WHERE recurring_template_id = $1
       ) s`,
      [ids.template],
    );
    expect(Number(distinctOccurrences[0].count)).toBe(2); // كل نوبة ليها طلب واحد بالظبط
  });

  it('تغيير سعر الخدمة بيأثر على الطلبات الجديدة بس — المتولّد قبل كده بيفضل بـsnapshot سعره', async () => {
    await q(`UPDATE services SET base_price_cents = 35000 WHERE id = $1`, [ids.service]);
    await makeTemplateDueAgain();
    await sweepOwn();
    const orders = await loadOrders();
    expect(orders).toHaveLength(3);
    expect(orders[0].total_amount_cents).toBe(30000); // snapshot تاريخي سليم
    expect(orders[1].total_amount_cents).toBe(30000);
    expect(orders[2].total_amount_cents).toBe(35000); // تسعير لحظة التوليد الحالي
    ids.createdOrderIds.push(orders[2].id);
    // نرجّع السعر للحالة الأصلية عشان باقي الاختبارات
    await q(`UPDATE services SET base_price_cents = 30000 WHERE id = $1`, [ids.service]);
  });

  it('خدمة بقت غير نشطة: فشل مرئي بعد المحاولات — manual_review والخطة فضلت موجودة بإشعار', async () => {
    await makeTemplateDueAgain();
    await q(`UPDATE services SET is_active = false WHERE id = $1`, [ids.service]);

    // 3 محاولات (نفس سياسة retry/dead-letter) — بنقدّم next_attempt_at بين كل محاولة بدل ما نستنى backoff حقيقي.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sweepOwn();
      await q(`UPDATE recurring_order_occurrences SET next_attempt_at = now() - interval '1 second' WHERE template_id = $1 AND status = 'failed'`, [ids.template]);
    }
    // نرجّع الخدمة **قبل** الـassertions — لو assertion فشل مينفعش الخدمة تفضل مقفولة لباقي الاختبارات
    emitSpy.mockClear();
    await q(`UPDATE services SET is_active = true WHERE id = $1`, [ids.service]);

    const occurrence = await loadOccurrence();
    expect(occurrence.status).toBe('manual_review');
    expect(occurrence.attempt_count).toBe(3);
    expect(occurrence.last_error).toContain('الخدمة غير موجودة');
    // الخطة **مش اتمسحت** — العميل/الأدمن يشوفوا السبب ويصلحوه، والمواعيد الجاية بتتكمل.
    // ملاحظة: is_active هنا مُدارة بنافذة الاختبار نفسها (sweepOwn toggle)، فالمعيار الحقيقي
    // إن الـdead-letter مايمسحش الخطة ولا بيحطها inactive من نفسه.
    const [template] = await q(`SELECT deleted_at, last_failure_reason FROM recurring_order_templates WHERE id = $1`, [ids.template]);
    expect(template.deleted_at).toBeNull();
    expect(template.last_failure_reason).toContain('الخدمة غير موجودة');

    // مفيش طلبات "بايظة" اتعملت للخدمة المقفولة — عدد الطلبات على الخطة فضل زي ما كان
    const [{ count }] = await q(`SELECT COUNT(*)::int AS count FROM orders WHERE recurring_template_id = $1`, [ids.template]);
    expect(Number(count)).toBe(3);
  });

  it('عميل اتبلوك: التوليد بيفشل مرئياً بنفس السياسة — مفيش طلبات لعميل ممنوع بصمت', async () => {
    await makeTemplateDueAgain();
    // ننضف كل النوبات القديمة عشان نبدأ نوبة نظيفة جديدة (الـmanual_review القديمة مش بتتعاد)
    await q(`DELETE FROM recurring_order_occurrences WHERE template_id = $1`, [ids.template]);
    await q(`UPDATE users SET is_blocked = true WHERE id = $1`, [ids.customerUser]);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sweepOwn();
      await q(`UPDATE recurring_order_occurrences SET next_attempt_at = now() - interval '1 second' WHERE template_id = $1 AND status = 'failed'`, [ids.template]);
    }
    // فك البلوك **قبل** الـassertions لنفس السبب
    await q(`UPDATE users SET is_blocked = false WHERE id = $1`, [ids.customerUser]);

    const occurrence = await loadOccurrence();
    expect(occurrence.status).toBe('manual_review');
    expect(occurrence.last_error).toContain('العميل متبلوك');
  });

  it('إلغاء الخطة (soft-delete) بيمنع المواعيد الجاية — والطلب المتولّد فعلاً ميتلمسش', async () => {
    const ordersBefore = await loadOrders();
    const completedCountBefore = ordersBefore.filter((o) => o.recurring_template_id === ids.template).length;
    expect(completedCountBefore).toBeGreaterThanOrEqual(3);

    await makeTemplateDueAgain();
    // نعمل نوبة pending جاهزة، وبعدين نقلب الخطة لموقوفة/ملغاة قبل المعالجة
    await seedDueTemplate();
    await q(`DELETE FROM recurring_order_occurrences WHERE template_id = $1 AND status != 'completed'`, [ids.template]);
    await q(`UPDATE recurring_order_templates SET is_active = false, deleted_at = now() WHERE id = $1`, [ids.template]);

    // stayInactive: الإلغاء نفسه هو اللي بيتم اختباره — التفعيل التلقائي هيدمر الغرض
    await sweepOwn({ stayInactive: true });

    // مفيش طلب جديد اتولّد بعد الإلغاء
    const ordersAfter = await loadOrders();
    expect(ordersAfter).toHaveLength(ordersBefore.length);
    // الطلبات القديمة لسه موجودة بحالتها (الإلغاء مايلغاش الطلبات المتولّدة سابقاً)
    expect(ordersAfter.filter((o) => o.order_status !== 'cancelled_by_system')).toHaveLength(ordersBefore.length);

    // نرجّع الخطة نشطة (من غير deleted_at) عشان التنضيف في afterAll يمشي صح
    await q(`UPDATE recurring_order_templates SET deleted_at = NULL WHERE id = $1`, [ids.template]);
  });

  it('قالب بـpayment_method=card بيولّد PENDING_PAYMENT + إشعار انتظار الدفع بيوصّل', async () => {
    await seedDueTemplate();
    await q(`DELETE FROM recurring_order_occurrences WHERE template_id = $1`, [ids.template]);
    await q(`UPDATE recurring_order_templates SET payment_method = 'card', next_run_at = now() - interval '1 minute' WHERE id = $1`, [ids.template]);

    emitSpy.mockClear();
    await sweepOwn();
    const orders = await loadOrders();
    const latest = orders[orders.length - 1];

    ids.createdOrderIds.push(latest.id);
    expect(latest.order_status).toBe('pending_payment'); // نفس حالة "في انتظار الدفع" العادية
    expect(latest.order_type).toBe('recurring');
    // إشعار انتظار الدفع اتصدّر مرة واحدة للنوبة دي (EventEmitter2 بيستدعي الـlistener بالـpayload بس)
    expect(emitSpy).toHaveBeenCalledTimes(1);
    const payload = emitSpy.mock.calls[0][0] as RecurringOrderAwaitingPaymentEvent;
    expect(payload.orderId).toBe(latest.id);
    expect(payload.customerId).toBe(ids.customerProfile);

    await q(`UPDATE recurring_order_templates SET payment_method = NULL WHERE id = $1`, [ids.template]);
  });
});
