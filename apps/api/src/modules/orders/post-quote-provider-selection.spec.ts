import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { PostQuoteProviderSelectionService } from './post-quote-provider-selection.service';
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
import { ServicePricingTierPricing } from '../catalog/entities/service-pricing-tier-pricing.entity';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';
import { LevelPremiumService } from '../pricing/level-premium.service';
import { OrderFinancialFinalizationService } from '../pricing/order-financial-finalization.service';
import { GeoService } from '../geo/geo.service';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';

/**
 * **ADR-0066** — الطلب اللي عرض سعره اتعمد كان بيقف في `AWAITING_TECHNICIAN_SELECTION` للأبد
 * (بند 3 من «المتبقي بالترتيب»)، وفرق مستوى المنفّذ ماكانش بيتحسب في المسار ده خالص لأن
 * `applyOnAutoAssignment()` بترفض أي طلب `requestedTechnicianId` مضبوط فيه (بند 4).
 *
 * الاختبار ده بيثبت الأربع حقائق اللي البندين دول عنهم:
 * 1. الطلب بيخرج من الحالة دي فعلاً، والمنفّذ بيتقفل (مش تفضيل).
 * 2. فرق المستوى بيتحسب **مرة واحدة** فوق قيمة العرض.
 * 3. إعادة الاختيار مابتضيفش فرق تاني فوق الأول (الحارس المشترك).
 * 4. المرشّح اللي مستواه = 1 مابياخدش أي فرق — الفرق مشتق من المستوى مش رقم ثابت.
 */
describe('اختيار المنفّذ بعد عرض السعر + فرق المستوى مرة واحدة (ADR-0066)', () => {
  let emitter: EventEmitter2;
  const emitted: { event: string; payload: unknown }[] = [];

  beforeEach(() => {
    emitted.length = 0;
  });

  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let cache: RedisCacheService;
  let service: PostQuoteProviderSelectionService;
  const runId = Date.now().toString(36);
  const QUOTE_CENTS = 60_000;
  const PREMIUM_MULTIPLIER = 1.25;
  const ids = {
    city: '', zone: '', category: '', service: '',
    customerUser: '', customerProfile: '', address: '',
    plainUser: '', plainTech: '', premiumUser: '', premiumTech: '',
    order: '',
  };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
  const bookingDay = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 12);
    return `${d.toISOString().slice(0, 10)}T09:00:00Z`;
  };

  async function seedAwaitingSelectionOrder(): Promise<string> {
    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_type, booking_mode,
                            order_status, scheduled_at, total_amount_cents, estimated_price_cents, commissionable_base_cents,
                            level_premium_cents, payment_status, placed_at, source_channel, initial_quote_source, price_status)
       VALUES ($1,$2,$3,$4,$5,'standard','individual','awaiting_technician_selection',$6,$7,0,$7,0,'unpaid', now(),
               'customer_app','admin_remote','confirmed') RETURNING id`,
      [orderNumber, ids.customerProfile, ids.service, ids.address, ids.zone, bookingDay(), QUOTE_CENTS],
    );
    return row.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Order, OrderStatusHistory, User, CustomerProfile, Address, City, Area, ServiceZone,
        TechnicianProfile, TechnicianCompany, Setting, ServiceCategory, Service, ServiceZonePricing,
        ServiceLevelPricing, ServiceAddon, ServiceStandardData, ServicePricingTierPricing,
        ServicePricingField, ServicePricingRule, ServicePricingEvaluation,
      ],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      country.id, `مدينة عرض ${runId}`, `Quote City ${runId}`, `quote-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `منطقة عرض ${runId}`, `Quote Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة عرض ${runId}`, `Quote Cat ${runId}`, `quote-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [service_] = await q(
      // المسار هنا هو **المعاينة في الموقع** — الفني بيعاين ويبعت السعر والعميل يختار المنفّذ
      // بعد كده. التقييم بالصور مالوش أي دور في الاختبار ده، وتفعيله كان غلط ساكت: مسار الصور
      // مقصور على `inspection_then_quote` (docs/08 §125، migration 0257)، فخدمة `formula`
      // معاها العلم ده كانت **مش قابلة للحجز بأي مسار**.
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, estimated_duration_minutes,
                              price_certainty_mode, onsite_assessment_enabled)
       VALUES ($1,$2,$3,'formula',1000,120,'assessment_required',true) RETURNING id`,
      [ids.category, `خدمة عرض ${runId}`, `quote-svc-${runId}`],
    );
    ids.service = service_.id;
    // مضاعف مستوى حقيقي على الخدمة دي — الفرق لازم يطلع من الإعداد، مش من رقم مكتوب في الكود.
    await q(
      `INSERT INTO service_level_pricing (service_id, technician_level, price_multiplier, is_active) VALUES ($1,'premium',$2,true)`,
      [ids.service, PREMIUM_MULTIPLIER],
    );

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2091${runId}`.slice(0, 15), `عميل عرض ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع عرض ${runId}`],
    );
    ids.address = address.id;

    const makeTechnician = async (label: string, suffix: string, code: string, level: string) => {
      const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+209${suffix}${runId}`.slice(0, 15), `${label} ${runId}`,
      ]);
      const [tech] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, verification_status, current_level, current_location)
         VALUES ($1,$2,'x','approved',$3, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
        [user.id, `${code}${runId}`.slice(0, 20), level],
      );
      await q(`INSERT INTO technician_services (technician_id, service_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`, [
        tech.id, ids.service,
      ]);
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [tech.id, ids.zone]);
      return { userId: user.id as string, techId: tech.id as string };
    };
    const plain = await makeTechnician('فني عادي', '2', 'PQP', 'professional');
    ids.plainUser = plain.userId;
    ids.plainTech = plain.techId;
    const premium = await makeTechnician('فني مميّز', '3', 'PQM', 'premium');
    ids.premiumUser = premium.userId;
    ids.premiumTech = premium.techId;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const auditStub = { record: async () => undefined } as unknown as AuditLogService;
    const settingsService = new SettingsService(dataSource.getRepository(Setting), auditStub, cache);
    const geoService = new GeoService(
      dataSource.getRepository(City), dataSource.getRepository(Area), dataSource.getRepository(ServiceZone), dataSource,
    );
    const catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory), dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing), dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon), dataSource.getRepository(ServiceStandardData),
      settingsService, realPricingEngineService(dataSource), dataSource.getRepository(ServicePricingTierPricing),
    );
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile), dataSource.getRepository(TechnicianCompany), {} as never,
      dataSource.getRepository(Service), dataSource.getRepository(User), {} as never, {} as never, auditStub,
      geoService, settingsService,
    );
    const levelPremiumService = new LevelPremiumService(
      catalogService, settingsService, commissionBaseServiceStub(), new OrderFinancialFinalizationService(),
    );
    emitter = new EventEmitter2();
    emitter.onAny((event: string | string[], payload: unknown) => {
      emitted.push({ event: String(event), payload });
    });
    service = new PostQuoteProviderSelectionService(
      dataSource,
      new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource),
      techniciansService,
      catalogService,
      levelPremiumService,
      new TechnicianAssignmentGuardService(settingsService),
      auditStub,
      emitter,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      const rows: { id: string }[] = await q(`SELECT id FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      const list = rows.map((r) => r.id);
      if (list.length) await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [list]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      const techs = [ids.plainTech, ids.premiumTech];
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [techs]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [techs]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [techs]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.customerUser, ids.plainUser, ids.premiumUser]]);
      await q(`DELETE FROM service_level_pricing WHERE service_id = $1`, [ids.service]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  it('المرشّحون بيرجعوا بسعر = قيمة العرض + فرق مستوى كل واحد', async () => {
    ids.order = await seedAwaitingSelectionOrder();
    const candidates = await service.listCandidates(ids.customerUser, ids.order);
    const plain = candidates.find((c) => c.technician_id === ids.plainTech);
    const premium = candidates.find((c) => c.technician_id === ids.premiumTech);

    expect(plain).toBeDefined();
    expect(plain!.level_premium_cents).toBe(0);
    expect(plain!.final_price_cents).toBe(QUOTE_CENTS);

    expect(premium).toBeDefined();
    expect(premium!.level_premium_cents).toBe(Math.round(QUOTE_CENTS * (PREMIUM_MULTIPLIER - 1)));
    expect(premium!.final_price_cents).toBe(QUOTE_CENTS + premium!.level_premium_cents);
  });

  it('اختيار المنفّذ المميّز: الطلب بيخرج من الانتظار، القفل بيتسجّل، والفرق بيتضاف مرة واحدة', async () => {
    const order = await service.selectProvider(ids.customerUser, ids.order, ids.premiumTech);
    const expectedPremium = Math.round(QUOTE_CENTS * (PREMIUM_MULTIPLIER - 1));

    expect(order.orderStatus).toBe(OrderStatus.SEARCHING_TECHNICIAN);
    expect(order.requestedTechnicianId).toBe(ids.premiumTech);
    expect(order.providerLockSource).toBe('post_quote_selection');
    expect(order.levelPremiumCents).toBe(expectedPremium);
    expect(order.totalAmountCents).toBe(QUOTE_CENTS + expectedPremium);

    const [row] = await q(`SELECT total_amount_cents, level_premium_cents, provider_lock_source FROM orders WHERE id = $1`, [
      ids.order,
    ]);
    expect(row.total_amount_cents).toBe(QUOTE_CENTS + expectedPremium);
    expect(row.level_premium_cents).toBe(expectedPremium);
    expect(row.provider_lock_source).toBe('post_quote_selection');
  });

  // بَقّة حقيقية اتلقطت في مراجعة: نقل الطلب لـSEARCHING_TECHNICIAN مابيوزّعوش لوحده. التوزيع كله
  // معلّق على ORDER_CREATED_EVENT (نقطة الدخول الموحّدة، ADR-0018)، والخدمة كانت بتبث
  // ORDER_STATUS_CHANGED_EVENT بس — يعني الطلب كان بيقف في SEARCHING_TECHNICIAN للأبد بدل ما
  // يقف في AWAITING_TECHNICIAN_SELECTION. الاختبار القديم عدّى لأنه بيتأكد من الحالة والقفل
  // والسعر بس، وماكانش بيسأل «هل التوزيع اتطلب أصلاً؟».
  it('الاختيار بيطلب التوزيع فعليًا — مش بيسيب الطلب واقف في SEARCHING_TECHNICIAN', async () => {
    const orderId = await seedAwaitingSelectionOrder();
    await service.selectProvider(ids.customerUser, orderId, ids.plainTech);

    const dispatch = emitted.filter((e) => e.event === 'order.created');
    expect(dispatch).toHaveLength(1);
    expect(dispatch[0].payload).toMatchObject({ orderId });
  });

  it('الاختيار مرة تانية بيترفض — الطلب خرج من مرحلة الاختيار خلاص (مفيش فرق مضاعف)', async () => {
    await expect(service.selectProvider(ids.customerUser, ids.order, ids.plainTech)).rejects.toMatchObject({
      code: 'ORDR_003',
    });
    const [row] = await q(`SELECT total_amount_cents, level_premium_cents FROM orders WHERE id = $1`, [ids.order]);
    expect(row.level_premium_cents).toBe(Math.round(QUOTE_CENTS * (PREMIUM_MULTIPLIER - 1)));
    expect(row.total_amount_cents).toBe(QUOTE_CENTS + row.level_premium_cents);
  });

  it('منفّذ مستواه بلا مضاعف: الطلب بيتقفل عليه بلا أي فرق — قيمة العرض زي ما هي', async () => {
    const orderId = await seedAwaitingSelectionOrder();
    const order = await service.selectProvider(ids.customerUser, orderId, ids.plainTech);
    expect(order.levelPremiumCents).toBe(0);
    expect(order.totalAmountCents).toBe(QUOTE_CENTS);
    expect(order.requestedTechnicianId).toBe(ids.plainTech);
  });

  it('عرض السعر بالموقع من نفس الفني: مابيمرّش على المسار ده أصلاً فمفيش ضرب مستوى تاني', async () => {
    // طلب معاينة بالموقع بيروح IN_PROGRESS مباشرة (`onsite_assessor_executes_work`) —
    // `AWAITING_TECHNICIAN_SELECTION` مش في طريقه، فالخدمة دي بترفضه صراحة.
    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, technician_id, order_type,
                            booking_mode, order_status, scheduled_at, total_amount_cents, estimated_price_cents,
                            level_premium_cents, payment_status, placed_at, source_channel, price_status)
       VALUES ($1,$2,$3,$4,$5,$6,'standard','individual','in_progress',$7,$8,0,0,'unpaid', now(),'customer_app','locked')
       RETURNING id`,
      [orderNumber, ids.customerProfile, ids.service, ids.address, ids.zone, ids.premiumTech, bookingDay(), QUOTE_CENTS],
    );
    await expect(service.selectProvider(ids.customerUser, row.id, ids.premiumTech)).rejects.toMatchObject({
      code: 'ORDR_003',
    });
    const [after] = await q(`SELECT total_amount_cents, level_premium_cents FROM orders WHERE id = $1`, [row.id]);
    expect(after.level_premium_cents).toBe(0);
    expect(after.total_amount_cents).toBe(QUOTE_CENTS);
  });
});
