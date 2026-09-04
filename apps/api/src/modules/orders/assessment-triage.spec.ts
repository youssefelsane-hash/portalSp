import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { Order, OrderPriceStatus, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderQuote, OrderQuoteStatus } from './entities/order-quote.entity';
import { AssessmentTriageService } from './assessment-triage.service';
import { prepaidOrderNextStatus } from './prepaid-order-next-status';
import { canTransition } from './order-state-machine';
import { InspectionQuoteService } from './inspection-quote.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { Address } from '../customers/entities/address.entity';
import { User } from '../auth/entities/user.entity';
import { CatalogService } from '../catalog/catalog.service';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { OrderFinancialFinalizationService } from '../pricing/order-financial-finalization.service';
import { splitOrderRevenue } from '../pricing/commission-base';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';

/**
 * **بنود 7 و8 من سكربت المالك — فرز التقييم في الأدمن.**
 *
 * قبل الشغل ده الأدمن ماكانش عنده غير «ابعت سعر من الصور». الأربع قرارات التانية اللي المالك
 * طلبها ماكانش ليها وجود، والعرض اللي بيخرج عن النطاق ماكانش فيه حاجة توقّفه قبل ما يوصل العميل.
 *
 * الاختبار بيثبت:
 * 1. سعر الفني فوق النطاق **مايوصلش العميل** — بيتحجز في `pending_admin_review`.
 * 2. الأدمن يعتمده → العميل بيشوفه بمهلة جديدة من لحظة الاعتماد.
 * 3. الأدمن يرفضه → العرض مرفوض والطلب مستني سعر تاني، من غير ما العميل يتلخبط.
 * 4. «تحويل لمعاينة في الموقع» بيوزّع فعلاً (بيبث حدث التوزيع) ويسجّل رسم المعاينة.
 * 5. «طلب معلومات إضافية» بيبعت للعميل من غير ما يغيّر حالة الطلب.
 * 6. إعادة إصدار عرض منتهي بتعمل **إصدار جديد** مش بتحيي القديم.
 * 7. الطابور بيفرز صح بكل فلتر.
 */
describe('فرز التقييم في الأدمن — الطابور والقرارات الأربعة (بنود 7 و8)', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let cache: RedisCacheService;
  let triage: AssessmentTriageService;
  let quotes: InspectionQuoteService;
  let emitter: EventEmitter2;
  const emitted: { event: string; payload: unknown }[] = [];

  const runId = Date.now().toString(36);
  const RANGE_MAX = 50_000;
  const ids = {
    city: '', zone: '', category: '', service: '',
    customerUser: '', customerProfile: '', address: '',
    techUser: '', techProfile: '', adminUser: '',
  };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  async function seedOrder(
    status: OrderStatus,
    opts: { assessmentType?: 'remote' | 'onsite'; priceStatus?: OrderPriceStatus; withTechnician?: boolean } = {},
  ): Promise<string> {
    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
                           order_status, payment_status, total_amount_cents, estimated_price_cents,
                           inspection_fee_cents, commissionable_base_cents, technician_earning_cents,
                           assessment_type, price_status, display_price_max_cents_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',0,0,0,0,0,$8,$9,$10) RETURNING id`,
      [
        orderNumber,
        ids.customerProfile,
        opts.withTechnician ? ids.techProfile : null,
        ids.service,
        ids.address,
        ids.zone,
        status,
        opts.assessmentType ?? 'remote',
        opts.priceStatus ?? OrderPriceStatus.WAITING_ASSESSMENT,
        RANGE_MAX,
      ],
    );
    return row.id;
  }

  beforeEach(() => {
    emitted.length = 0;
  });

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Order, OrderStatusHistory, OrderQuote, User, Address, CustomerProfile,
        ServiceCategory, Service, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData,
        TechnicianProfile, TechnicianCompany, City, Area, ServiceZone,
        Setting, ServicePricingField, ServicePricingRule, ServicePricingEvaluation,
      ],
    });
    await dataSource.initialize();

    // دولة موجودة بدل إنشاء واحدة: `iso_code` حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف
    // afterAll بيفشل على FK فبيسيب صف ورا كل تشغيلة فاشلة (نفس درس admin-crew-management.spec).
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة فرز ${runId}`, `Triage City ${runId}`, `triage-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `نطاق فرز ${runId}`, `Triage Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة فرز ${runId}`, `Triage Cat ${runId}`, `triage-cat-${runId}`,
    ]);
    ids.category = category.id;

    // خدمة تقييم: معاينة بالموقع مفعّلة، ومراجعة الأدمن فوق النطاق مفعّلة بلا سماح (0 نقطة أساس).
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, inspection_fee_cents,
                             commission_percentage, warranty_days, price_certainty_mode, assessment_route_policy,
                             remote_assessment_enabled, onsite_assessment_enabled, require_admin_review_above_range,
                             max_quote_increase_without_admin_review_bps, quote_validity_minutes)
       VALUES ($1,$2,$3,'inspection_then_quote',10000,7500,20,0,'assessment_required','admin_triage',
               true,true,true,0,2880) RETURNING id`,
      [ids.category, `خدمة فرز ${runId}`, `triage-service-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`,
      [`+2031${runId}`.slice(0, 15), `عميل فرز ${runId}`, `triage-cust-${runId}@test.local`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع فرز ${runId}`],
    );
    ids.address = address.id;

    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2032${runId}`.slice(0, 15), `فني فرز ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCTRG${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2033${runId}`.slice(0, 15), `أدمن فرز ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
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
      {} as never, {} as never,
      dataSource.getRepository(User),
      {} as never, {} as never,
      {} as unknown as AuditLogService,
      {} as never, {} as never,
    );

    emitter = new EventEmitter2();
    emitter.onAny((event: string | string[], payload: unknown) => {
      emitted.push({ event: String(event), payload });
    });
    const auditStub = { record: async () => undefined } as never;

    triage = new AssessmentTriageService(dataSource, catalogService, auditStub, emitter);
    quotes = new InspectionQuoteService(
      dataSource,
      new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource),
      techniciansService,
      catalogService,
      {} as never,
      emitter,
      new OrderFinancialFinalizationService(),
      auditStub,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM order_quotes WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [ids.customerUser, ids.techUser, ids.adminUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
      await cache?.onModuleDestroy?.();
    }
  });

  // ===== بند 8: السعر خارج النطاق =====

  it('سعر الفني فوق النطاق بيتحجز لمراجعة الأدمن — العميل مايشوفهوش ولا حالة الطلب بتتغير', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    const order = await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX + 20_000, 'العطل أكبر من المتوقع');

    expect(order.orderStatus).toBe(OrderStatus.TECHNICIAN_ARRIVED);
    expect(order.priceStatus).toBe(OrderPriceStatus.WAITING_QUOTE);
    // أهم تأكيد: السعر ماتكتبش على الطلب، فمفيش رقم محدش اعتمده بيتعرض للعميل.
    expect(order.estimatedPriceCents).toBe(0);

    const [quote] = await q(`SELECT status, amount_cents FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);
    expect(quote.status).toBe(OrderQuoteStatus.PENDING_ADMIN_REVIEW);
    expect(emitted.filter((e) => e.event === 'order.status_changed')).toHaveLength(0);
  });

  it('سعر جوّه النطاق بيعدّي للعميل على طول — البوابة مابتعطّلش المسار العادي', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    const order = await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX - 5_000, 'شغل عادي');

    expect(order.orderStatus).toBe(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL);
    expect(order.priceStatus).toBe(OrderPriceStatus.WAITING_CUSTOMER_APPROVAL);
    const [quote] = await q(`SELECT status FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);
    expect(quote.status).toBe(OrderQuoteStatus.PENDING_CUSTOMER);
  });

  it('الأدمن يعتمد السعر الخارج عن النطاق: العميل بيشوفه بمهلة جديدة من لحظة الاعتماد', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX + 20_000, 'عطل كبير');
    const [pending] = await q(`SELECT id FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);

    const decided = await triage.decideAboveRangeQuote(ids.adminUser, orderId, pending.id, true, 'عاينت الصور والسعر منطقي');

    expect(decided.status).toBe(OrderQuoteStatus.PENDING_CUSTOMER);
    expect(decided.adminDecidedByUserId).toBe(ids.adminUser);
    // المهلة بتبدأ من الاعتماد مش من إرسال الفني — العميل ماكانش شايف العرض قبل كده.
    expect(decided.validUntil.getTime()).toBeGreaterThan(Date.now() + 2_000 * 60_000);

    const [row] = await q(`SELECT order_status, price_status, estimated_price_cents FROM orders WHERE id = $1`, [orderId]);
    expect(row.order_status).toBe(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL);
    expect(row.price_status).toBe(OrderPriceStatus.WAITING_CUSTOMER_APPROVAL);
    expect(row.estimated_price_cents).toBe(RANGE_MAX + 20_000);
  });

  it('الأدمن يرفض السعر الخارج عن النطاق: العرض مرفوض والطلب مستني سعر تاني', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX + 40_000, 'مبالغة');
    const [pending] = await q(`SELECT id FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);

    const decided = await triage.decideAboveRangeQuote(ids.adminUser, orderId, pending.id, false, 'السعر مبالغ فيه');

    expect(decided.status).toBe(OrderQuoteStatus.REJECTED);
    const [row] = await q(`SELECT order_status, price_status, estimated_price_cents FROM orders WHERE id = $1`, [orderId]);
    expect(row.order_status).toBe(OrderStatus.TECHNICIAN_ARRIVED);
    expect(row.price_status).toBe(OrderPriceStatus.WAITING_QUOTE);
    expect(row.estimated_price_cents).toBe(0);
  });

  it('القرار مرتين على نفس العرض بيترفض — مفيش اعتماد مزدوج', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX + 10_000, 'عطل');
    const [pending] = await q(`SELECT id FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);

    await triage.decideAboveRangeQuote(ids.adminUser, orderId, pending.id, true, 'موافق');
    await expect(
      triage.decideAboveRangeQuote(ids.adminUser, orderId, pending.id, true, 'موافق تاني'),
    ).rejects.toMatchObject({ code: 'ORDR_003' });
  });

  // ===== بند 8: تحويل لمعاينة في الموقع =====

  it('تحويل لمعاينة في الموقع: بيسجّل رسم المعاينة **وبيطلب التوزيع فعليًا**', async () => {
    const orderId = await seedOrder(OrderStatus.AWAITING_ADMIN_QUOTE, { assessmentType: 'remote' });
    const order = await triage.routeToOnsiteAssessment(ids.adminUser, orderId, 'الصور مش واضحة');

    expect(order.orderStatus).toBe(OrderStatus.SEARCHING_TECHNICIAN);
    expect(order.assessmentType).toBe('onsite');
    expect(order.inspectionFeeCents).toBe(7500);
    expect(order.priceStatus).toBe(OrderPriceStatus.WAITING_ASSESSMENT);
    // من غير الحدث ده الطلب بيقف في SEARCHING_TECHNICIAN للأبد.
    expect(emitted.filter((e) => e.event === 'order.created')).toHaveLength(1);
  });

  it('التحويل لمعاينة من حالة غلط بيترفض', async () => {
    const orderId = await seedOrder(OrderStatus.IN_PROGRESS, { withTechnician: true });
    await expect(triage.routeToOnsiteAssessment(ids.adminUser, orderId, 'كده')).rejects.toMatchObject({ code: 'ORDR_003' });
  });

  // ===== بند 8: طلب معلومات إضافية =====

  it('طلب معلومات إضافية: بيوصل للعميل من غير ما يغيّر حالة الطلب', async () => {
    const orderId = await seedOrder(OrderStatus.AWAITING_ADMIN_QUOTE, { assessmentType: 'remote' });
    const order = await triage.requestMoreInformation(ids.adminUser, orderId, 'ابعتلنا صورة للعداد من قريب');

    expect(order.orderStatus).toBe(OrderStatus.AWAITING_ADMIN_QUOTE);
    const info = emitted.filter((e) => e.event === 'order.assessment.info_requested');
    expect(info).toHaveLength(1);
    expect(info[0].payload).toMatchObject({ orderId, message: 'ابعتلنا صورة للعداد من قريب' });
    // مفيش انتقال حالة، فمايصحش يتبعت إشعار حالة.
    expect(emitted.filter((e) => e.event === 'order.status_changed')).toHaveLength(0);
  });

  // ===== بند 8: إعادة إصدار عرض منتهي =====

  it('إعادة إصدار عرض منتهي: إصدار **جديد** والقديم بيفضل منتهي', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX - 10_000, 'شغل عادي');
    await q(`UPDATE order_quotes SET status = 'expired', valid_until = now() - interval '1 hour' WHERE order_id = $1`, [orderId]);

    const reissued = await quotes.reissueExpiredQuote(ids.adminUser, orderId, undefined);

    expect(reissued.version).toBe(2);
    expect(reissued.status).toBe(OrderQuoteStatus.PENDING_CUSTOMER);
    expect(reissued.amountCents).toBe(RANGE_MAX - 10_000);
    const rows = await q(`SELECT version, status FROM order_quotes WHERE order_id = $1 ORDER BY version`, [orderId]);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe(OrderQuoteStatus.EXPIRED);
  });

  it('إعادة إصدار عرض لسه ساري بتترفض', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX - 10_000, 'شغل عادي');
    await expect(quotes.reissueExpiredQuote(ids.adminUser, orderId, undefined)).rejects.toMatchObject({ code: 'ORDR_003' });
  });

  it('إعادة الإصدار بمبلغ جديد بتاخد المبلغ الجديد', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX - 10_000, 'شغل عادي');
    await q(`UPDATE order_quotes SET status = 'expired', valid_until = now() - interval '1 hour' WHERE order_id = $1`, [orderId]);

    const reissued = await quotes.reissueExpiredQuote(ids.adminUser, orderId, 44_000);
    expect(reissued.amountCents).toBe(44_000);
    const [row] = await q(`SELECT estimated_price_cents FROM orders WHERE id = $1`, [orderId]);
    expect(row.estimated_price_cents).toBe(44_000);
  });

  // ===== بند 9: رسم التقييم بيتحصّل عند الإرسال =====

  describe('وجهة الطلب المدفوع مقدّمًا', () => {
    it('رسم تقييم بالصور مدفوع → فرز الإدارة، وبلا توزيع', () => {
      expect(
        prepaidOrderNextStatus({ assessmentType: 'remote', priceStatus: OrderPriceStatus.WAITING_ASSESSMENT }),
      ).toEqual({ nextStatus: OrderStatus.AWAITING_ADMIN_QUOTE, dispatchStarted: false });
    });

    it('طلب عادي مدفوع مقدّمًا → التوزيع زي ما كان بالحرف', () => {
      expect(
        prepaidOrderNextStatus({ assessmentType: null, priceStatus: OrderPriceStatus.CONFIRMED }),
      ).toEqual({ nextStatus: OrderStatus.SEARCHING_TECHNICIAN, dispatchStarted: true });
    });

    it('معاينة في الموقع مدفوعة مقدّمًا → توزيع عادي (الفني بيروح فعلاً)', () => {
      expect(
        prepaidOrderNextStatus({ assessmentType: 'onsite', priceStatus: OrderPriceStatus.WAITING_ASSESSMENT }),
      ).toEqual({ nextStatus: OrderStatus.SEARCHING_TECHNICIAN, dispatchStarted: true });
    });

    it('الانتقال اللي المسار ده محتاجه مسموح في الـstate machine', () => {
      expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.AWAITING_ADMIN_QUOTE)).toBe(true);
    });
  });

  // ===== بند 35: تعديل السعر بعد التشخيص (Quote Revision) =====

  async function seedPricedWorkOrder(status: OrderStatus, priceCents: number, paid = false): Promise<string> {
    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
                           order_status, payment_status, total_amount_cents, estimated_price_cents,
                           inspection_fee_cents, commissionable_base_cents, technician_earning_cents,
                           assessment_type, price_status, display_price_max_cents_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,0,$9,0,'onsite','confirmed',$10) RETURNING id`,
      [
        orderNumber, ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone,
        status, paid ? 'paid' : 'pending', priceCents, RANGE_MAX + 100_000,
      ],
    );
    return row.id;
  }

  it('التعديل بيضيف **الفرق** بس — مش السعر الجديد فوق القديم', async () => {
    const orderId = await seedPricedWorkOrder(OrderStatus.IN_PROGRESS, 40_000);
    await quotes.submitDiagnosisRevision(ids.techUser, orderId, 55_000, 'لقيت ماسورة تانية مكسورة');

    const [afterSubmit] = await q(`SELECT order_status, total_amount_cents FROM orders WHERE id = $1`, [orderId]);
    expect(afterSubmit.order_status).toBe(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL);
    // لسه ما اتغيرش قبل موافقة العميل.
    expect(afterSubmit.total_amount_cents).toBe(40_000);

    await quotes.approveInitialQuote(ids.customerUser, orderId, 'cash');

    const [row] = await q(
      `SELECT order_status, total_amount_cents, estimated_price_cents, commissionable_base_cents FROM orders WHERE id = $1`,
      [orderId],
    );
    // 40000 + (55000 - 40000) = 55000. لو الحساب اتعامل معاه كعرض أول كان هيبقى 95000.
    expect(row.total_amount_cents).toBe(55_000);
    expect(row.estimated_price_cents).toBe(55_000);
    expect(row.commissionable_base_cents).toBe(55_000);
    // الفني واقف في المكان — بيكمّل شغل.
    expect(row.order_status).toBe(OrderStatus.IN_PROGRESS);
  });

  it('تخفيض السعر على طلب **غير مدفوع** بيقلّل الإجمالي فعلاً', async () => {
    const orderId = await seedPricedWorkOrder(OrderStatus.IN_PROGRESS, 40_000);
    await quotes.submitDiagnosisRevision(ids.techUser, orderId, 25_000, 'العطل أبسط من المتوقع');
    await quotes.approveInitialQuote(ids.customerUser, orderId, 'cash');

    const [row] = await q(
      `SELECT total_amount_cents, estimated_price_cents, commissionable_base_cents FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(row.total_amount_cents).toBe(25_000);
    expect(row.estimated_price_cents).toBe(25_000);
    // كان ناقص هنا بالظبط، وده اللي خلّى البَقّة تعيش: الفرق كان بيتطبّق على وعاء العمولة
    // **مرتين** (مرة جوّه replaceUncommittedPrice ومرة في المنادي) فيطلع 10,000 بدل 25,000.
    expect(row.commissionable_base_cents).toBe(25_000);
  });

  /**
   * بلاغ مالك (2026-09-03): «العميل وافق على السعر، وبعدين الفني بيشوف مستحقك أنت = صفر».
   *
   * الفرق كان بيتطبّق مرتين على `commissionable_base_cents`؛ مع تخفيض كبير الوعاء بيوصل صفر
   * (Math.max(0, …)) — و`splitOrderRevenue` بتحسب نصيب الفني **من الوعاء**، فبيطلع صفر على طلب
   * سعره شغّال. الاختبار بيقيس الرقم اللي التطبيق بيعرضه فعلاً، مش أعمدة الطلب بس.
   */
  it('نصيب الفني بعد تخفيض كبير مايبقاش صفر — وعاء العمولة بيتعدّل مرة واحدة', async () => {
    const orderId = await seedPricedWorkOrder(OrderStatus.IN_PROGRESS, 50_000);
    await quotes.submitDiagnosisRevision(ids.techUser, orderId, 5_000, 'الشغل طلع أقل بكتير');
    await quotes.approveInitialQuote(ids.customerUser, orderId, 'cash');

    const [row] = await q(
      `SELECT total_amount_cents, commissionable_base_cents FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(row.total_amount_cents).toBe(5_000);
    // قبل الإصلاح: max(0, 50000 - 45000 - 45000) = 0.
    expect(row.commissionable_base_cents).toBe(5_000);

    const { technicianEarningCents } = splitOrderRevenue({
      totalAmountCents: row.total_amount_cents,
      commissionableBaseCents: row.commissionable_base_cents ?? row.total_amount_cents,
      commissionRatePercentage: 20,
    });
    expect(technicianEarningCents).toBe(4_000);
  });

  it('تخفيض السعر على طلب **مدفوع** بيترفض وقت الإرسال — الاسترداد مسار تاني', async () => {
    const orderId = await seedPricedWorkOrder(OrderStatus.IN_PROGRESS, 40_000, true);
    await expect(
      quotes.submitDiagnosisRevision(ids.techUser, orderId, 25_000, 'أبسط'),
    ).rejects.toMatchObject({ code: 'ORDR_003' });
  });

  it('نفس السعر بيترفض، والحالة الغلط بترفض', async () => {
    const same = await seedPricedWorkOrder(OrderStatus.IN_PROGRESS, 40_000);
    await expect(quotes.submitDiagnosisRevision(ids.techUser, same, 40_000, 'نفسه')).rejects.toMatchObject({
      code: 'VAL_001',
    });
    const wrongState = await seedPricedWorkOrder(OrderStatus.WORK_COMPLETED, 40_000);
    await expect(quotes.submitDiagnosisRevision(ids.techUser, wrongState, 60_000, 'خلص')).rejects.toMatchObject({
      code: 'ORDR_003',
    });
  });

  it('تعديل فوق النطاق بيروح لمراجعة الإدارة — العميل مايشوفوش وحالة الطلب ما تتغيرش', async () => {
    const orderId = await seedPricedWorkOrder(OrderStatus.IN_PROGRESS, 40_000);
    // سقف النطاق على الطلب ده = RANGE_MAX + 100000؛ نعدّيه.
    await quotes.submitDiagnosisRevision(ids.techUser, orderId, RANGE_MAX + 200_000, 'شغل ضخم');

    const [row] = await q(`SELECT order_status, total_amount_cents, estimated_price_cents FROM orders WHERE id = $1`, [orderId]);
    expect(row.order_status).toBe(OrderStatus.IN_PROGRESS);
    expect(row.total_amount_cents).toBe(40_000);
    expect(row.estimated_price_cents).toBe(40_000);
    const [quote] = await q(`SELECT status FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);
    expect(quote.status).toBe(OrderQuoteStatus.PENDING_ADMIN_REVIEW);
  });

  // ===== بند 7: الطابور =====

  it('الطابور بيفرز بكل فلتر — كل طلب بيظهر في خانته بس', async () => {
    const photoReview = await seedOrder(OrderStatus.AWAITING_ADMIN_QUOTE, { assessmentType: 'remote' });
    const awaitingCustomer = await seedOrder(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL, {
      withTechnician: true,
      priceStatus: OrderPriceStatus.WAITING_CUSTOMER_APPROVAL,
    });

    const photo = await triage.listAssessmentQueue('photo_review');
    expect(photo.map((r) => r.order_id)).toContain(photoReview);
    expect(photo.map((r) => r.order_id)).not.toContain(awaitingCustomer);

    const customer = await triage.listAssessmentQueue('awaiting_customer');
    expect(customer.map((r) => r.order_id)).toContain(awaitingCustomer);
    expect(customer.map((r) => r.order_id)).not.toContain(photoReview);

    // الطابور بيرجّع بيانات قابلة للعرض مباشرة — مش IDs بس.
    const row = photo.find((r) => r.order_id === photoReview)!;
    expect(row.service_name_ar).toContain('خدمة فرز');
    expect(row.customer_name).toContain('عميل فرز');
  });

  it('فلتر «خارج النطاق» بيرجّع العروض المستنية مراجعة الأدمن بس', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX + 30_000, 'عطل كبير');

    const rows = await triage.listAssessmentQueue('above_range');
    const mine = rows.find((r) => r.order_id === orderId);
    expect(mine).toBeDefined();
    expect(mine!.latest_quote_status).toBe(OrderQuoteStatus.PENDING_ADMIN_REVIEW);
    expect(mine!.latest_quote_amount_cents).toBe(RANGE_MAX + 30_000);
  });
});
