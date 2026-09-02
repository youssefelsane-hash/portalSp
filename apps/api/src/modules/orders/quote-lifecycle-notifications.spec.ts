import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { Order, OrderPriceStatus, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderQuote, OrderQuoteStatus } from './entities/order-quote.entity';
import { AssessmentTriageService } from './assessment-triage.service';
import { InspectionQuoteService } from './inspection-quote.service';
import { QuoteExpiryService } from './quote-expiry.service';
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
 * **ADR-0067 — الأحداث اللي مسار التقييم كان بياخد قراراته من غيرها.**
 *
 * الكود بتاع بنود 7/8/10 كان صح تشغيليًا، بس أربع قرارات كانت بتحصل في سكوت كامل. الاختبار ده
 * بيثبت إن كل قرار فيهم بقى بيبث حدث دومين صريح، والأهم: بيثبت الحالتين اللي **ماكانش بيتبعت
 * فيهم أي حاجة خالص** — رفض السعر الخارج عن النطاق (الفني مطلوب منه سعر جديد ومحدش قاله)،
 * وانتهاء صلاحية العرض (اللي ماكانش ليه كاسح أصلاً، فماكانش بيحصل من غير محاولة بشرية).
 */
describe('ADR-0067 — أحداث دورة حياة التقييم وعرض السعر', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let cache: RedisCacheService;
  let triage: AssessmentTriageService;
  let quotes: InspectionQuoteService;
  let expiry: QuoteExpiryService;
  let emitter: EventEmitter2;
  const emitted: { event: string; payload: Record<string, unknown> }[] = [];

  const runId = `${Date.now().toString(36)}n`;
  const RANGE_MAX = 50_000;
  const ids = {
    city: '', zone: '', category: '', service: '',
    customerUser: '', customerProfile: '', address: '',
    techUser: '', techProfile: '', adminUser: '',
  };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
  const eventsNamed = (name: string) => emitted.filter((e) => e.event === name);

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

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة إشعارات ${runId}`, `Notif City ${runId}`, `notif-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `نطاق إشعارات ${runId}`, `Notif Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة إشعارات ${runId}`, `Notif Cat ${runId}`, `notif-cat-${runId}`,
    ]);
    ids.category = category.id;

    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, inspection_fee_cents,
                             commission_percentage, warranty_days, price_certainty_mode, assessment_route_policy,
                             remote_assessment_enabled, onsite_assessment_enabled, require_admin_review_above_range,
                             max_quote_increase_without_admin_review_bps, quote_validity_minutes)
       VALUES ($1,$2,$3,'inspection_then_quote',10000,7500,20,0,'assessment_required','admin_triage',
               true,true,true,0,2880) RETURNING id`,
      [ids.category, `خدمة إشعارات ${runId}`, `notif-service-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`,
      [`+2041${runId}`.slice(0, 15), `عميل إشعارات ${runId}`, `notif-cust-${runId}@test.local`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع إشعارات ${runId}`],
    );
    ids.address = address.id;

    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2042${runId}`.slice(0, 15), `فني إشعارات ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCNTF${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2043${runId}`.slice(0, 15), `أدمن إشعارات ${runId}`,
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
      emitted.push({ event: String(event), payload: payload as Record<string, unknown> });
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
    expiry = new QuoteExpiryService(dataSource, quotes, emitter, auditStub);
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

  // ===== 1. سعر خارج النطاق اتبعت =====

  it('سعر فوق النطاق بيبث حدث للأدمن — الطابور مابقاش قناة الاكتشاف الوحيدة', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX + 20_000, 'العطل أكبر');

    const events = eventsNamed('order.quote.above_range_submitted');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      orderId,
      amountCents: RANGE_MAX + 20_000,
      expectedMaxCents: RANGE_MAX,
    });
    // الحالة ماتغيرتش، فالحدث ده هو الوسيلة الوحيدة — مفيش status_changed يتعلّق عليه إشعار.
    expect(eventsNamed('order.status_changed')).toHaveLength(0);
  });

  it('سعر جوّه النطاق مابيبعتش الحدث — الأدمن مابيتزنّقش بإشعارات مالهاش قرار', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX - 5_000, 'شغل عادي');

    expect(eventsNamed('order.quote.above_range_submitted')).toHaveLength(0);
  });

  // ===== 2. قرار الأدمن بيوصل للفني في الحالتين =====

  it('الرفض بيبث حدث للفني — ده كان بيحصل في سكوت كامل قبل ADR-0067', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX + 40_000, 'مبالغة');
    const [pending] = await q(`SELECT id FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);
    emitted.length = 0;

    await triage.decideAboveRangeQuote(ids.adminUser, orderId, pending.id, false, 'السعر مبالغ فيه');

    const events = eventsNamed('order.quote.above_range_decided');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      orderId,
      approved: false,
      reason: 'السعر مبالغ فيه',
      submittedByUserId: ids.techUser,
    });
    // مسار الرفض مابيغيّرش حالة الطلب — يعني من غير الحدث الجديد مفيش أي إشارة بتخرج منه.
    expect(eventsNamed('order.status_changed')).toHaveLength(0);
  });

  it('الاعتماد بيبث نفس الحدث بـapproved=true — الفني بياخد تأكيد مش بس العميل', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX + 10_000, 'عطل كبير');
    const [pending] = await q(`SELECT id FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);
    emitted.length = 0;

    await triage.decideAboveRangeQuote(ids.adminUser, orderId, pending.id, true, 'السعر منطقي');

    const events = eventsNamed('order.quote.above_range_decided');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ approved: true, submittedByUserId: ids.techUser });
  });

  // ===== 3. التحويل لمعاينة في الموقع =====

  it('التحويل لمعاينة بيبث حدث فيه رسم المعاينة — مبلغ جديد لازم العميل يعرفه', async () => {
    const orderId = await seedOrder(OrderStatus.AWAITING_ADMIN_QUOTE, { assessmentType: 'remote' });

    await triage.routeToOnsiteAssessment(ids.adminUser, orderId, 'الصور مش واضحة');

    const events = eventsNamed('order.routed_to_onsite_assessment');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      orderId,
      customerId: ids.customerProfile,
      inspectionFeeCents: 7_500,
      reason: 'الصور مش واضحة',
    });
  });

  // ===== 4. انتهاء صلاحية العرض =====

  it('الكاسح بيقفل العرض المنتهي ويبث الحدث — ده ماكانش بيحصل من غير محاولة بشرية', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX - 5_000, 'شغل عادي');
    const [quote] = await q(`SELECT id FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);
    await q(`UPDATE order_quotes SET valid_until = NOW() - INTERVAL '1 minute' WHERE id = $1`, [quote.id]);
    emitted.length = 0;

    const count = await expiry.sweep();
    expect(count).toBeGreaterThanOrEqual(1);

    const [after] = await q(`SELECT status FROM order_quotes WHERE id = $1`, [quote.id]);
    expect(after.status).toBe(OrderQuoteStatus.EXPIRED);
    const [order] = await q(`SELECT price_status FROM orders WHERE id = $1`, [orderId]);
    expect(order.price_status).toBe(OrderPriceStatus.WAITING_QUOTE);

    const events = eventsNamed('order.quote.expired').filter((e) => e.payload.orderId === orderId);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      customerId: ids.customerProfile,
      quoteId: quote.id,
      submittedByUserId: ids.techUser,
    });
  });

  it('الكاسح مابيلمسش عرض مستني مراجعة الأدمن — مهلة العميل مابدأتش أصلاً', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX + 30_000, 'فوق النطاق');
    const [quote] = await q(`SELECT id FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);
    await q(`UPDATE order_quotes SET valid_until = NOW() - INTERVAL '1 hour' WHERE id = $1`, [quote.id]);
    emitted.length = 0;

    await expiry.sweep();

    const [after] = await q(`SELECT status FROM order_quotes WHERE id = $1`, [quote.id]);
    expect(after.status).toBe(OrderQuoteStatus.PENDING_ADMIN_REVIEW);
    expect(eventsNamed('order.quote.expired').filter((e) => e.payload.orderId === orderId)).toHaveLength(0);
  });

  it('تشغيلتين للكاسح على نفس العرض = حدث واحد بس — مفيش إشعار مكرر', async () => {
    const orderId = await seedOrder(OrderStatus.TECHNICIAN_ARRIVED, { withTechnician: true, priceStatus: OrderPriceStatus.WAITING_QUOTE });
    await quotes.submitInitialQuote(ids.techUser, orderId, RANGE_MAX - 8_000, 'شغل عادي');
    const [quote] = await q(`SELECT id FROM order_quotes WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]);
    await q(`UPDATE order_quotes SET valid_until = NOW() - INTERVAL '2 minutes' WHERE id = $1`, [quote.id]);
    emitted.length = 0;

    await expiry.sweep();
    await expiry.sweep();

    expect(eventsNamed('order.quote.expired').filter((e) => e.payload.orderId === orderId)).toHaveLength(1);
  });
});
