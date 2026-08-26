import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { PaymentsService } from '../payments/payments.service';
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
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PricingFieldsService } from '../pricing/pricing-fields.service';
import { PricingRulesService } from '../pricing/pricing-rules.service';
import {
  ServicePricingField,
  PricingFieldType,
} from '../pricing/entities/service-pricing-field.entity';
import { ServicePricingRule, PricingRuleType } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { Installment } from '../installments/entities/installment.entity';
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';
import { crewEarningsServiceStub } from '../payments/crew-earnings.testing';

/**
 * تكامل السلسلة الكاملة (docs/01B §22) — Price Engine → Booking → Snapshot:
 * 1. مخرجات المعادلة التشغيلية (طاقم/مدة) بتوصل للطلب لو standard_data مش مستخدم.
2. الأولوية لـstandard_data لو العميل استخدمه.
3. min/max clamp بيُطبق فعلاً.
4. بوابة الطوارئ: معادلة suitable_for_emergency=false تمنع حجز طوارئ.
 */
describe('Full-chain integration — Price Engine outputs → Order snapshot (PostgreSQL)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let ordersService: OrdersService;
  let rulesService: PricingRulesService;
  let fieldsService: PricingFieldsService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = {
    customerUser: '',
    customerProfile: '',
    category: '',
    serviceFormula: '',
    address: '',
    // ADR-0042 / docs/08 §64.ح — شركة بمعامل سعر حقيقي، عشان نثبت إن المعامل بيعدّي على
    // **نفس** مسار محرك التسعير (فرع الـformula) في المعاينة والإنشاء بالحرف.
    companyOwnerUser: '',
    company: '',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function q<T = any>(sql: string, params?: unknown[]): Promise<T> {
    return dataSource.query(sql, params) as Promise<T>;
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
        Wallet,
        WalletTransaction,
        User,
        WebhookEvent,
        CustomerProfile,
        Address,
        City,
        Area,
        ServiceZone,
        ServiceCategory,
        Service,
        ServiceZonePricing,
        ServiceLevelPricing,
        ServiceAddon,
        ServiceStandardData,
        ServicePricingField,
        ServicePricingRule,
        ServicePricingEvaluation,
        Complaint,
        ComplaintMessage,
        ComplaintAttachment,
        LoyaltyTransaction,
        TechnicianProfile,
        TechnicianCompany,
        TechnicianScheduleSlot,
        TechnicianLevelConfig,
        Installment,
        Setting,
      ],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code='EG'`);
    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة سلسلة ${runId}`, `Chain City ${runId}`, `chain-city-${runId}`],
    );
    await q(`INSERT INTO service_zones (city_id,name_ar,name_en) VALUES ($1,$2,$3)`, [
      city.id,
      `نطاق سلسلة ${runId}`,
      `Chain Zone ${runId}`,
    ]);
    const [category] = await q(
      `INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة سلسلة ${runId}`, `Chain Cat ${runId}`, `chain-cat-${runId}`],
    );
    ids.category = category.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2099${runId}`.slice(0, 15), `عميل سلسلة ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = profile.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, city.id, `شارع سلسلة ${runId}`],
    );
    ids.address = addr.id;

    // ===== خدمة formula بمعادلة بتنتج crew/duration/min/max =====
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,min_price_cents,max_price_cents)
       VALUES ($1,$2,$3,'formula',0,20000,900000) RETURNING id`,
      [ids.category, `خدمة سلسلة ${runId}`, `chain-svc-${runId}`],
    );
    ids.serviceFormula = svc.id;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(
      dataSource.getRepository(Setting),
      { record: async () => undefined } as unknown as AuditLogService,
      cache,
    );
    const geoService = new GeoService(dataSource.getRepository(City), dataSource.getRepository(Area), dataSource.getRepository(ServiceZone), dataSource);
    const addressesService = new AddressesService(dataSource.getRepository(Address), dataSource.getRepository(CustomerProfile), dataSource.getRepository(Order), geoService);
    fieldsService = new PricingFieldsService(dataSource.getRepository(ServicePricingField), dataSource.getRepository(ServicePricingRule), { record: async () => undefined } as unknown as AuditLogService);
    rulesService = new PricingRulesService(dataSource.getRepository(ServicePricingRule), dataSource.getRepository(ServicePricingField), { record: async () => undefined } as unknown as AuditLogService);
    const pricingEngine = new PricingEngineService(
      dataSource.getRepository(ServicePricingEvaluation),
      fieldsService,
      rulesService,
    );
    const catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      settingsService,
      pricingEngine,
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
    const walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const technicianLevelsService = new TechnicianLevelsService(dataSource.getRepository(TechnicianLevelConfig), {} as unknown as AuditLogService);
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
      dataSource.getRepository(Installment),
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
      // بيقرا `price_multiplier` الحقيقي من القاعدة — اللي تحت الاختبار هو سريان المعامل في
      // التسعير، مش البحث عن الشركة (مغطّى في technician-companies specs).
      {
        findActiveCompanyOrThrow: async (companyId: string) => {
          const [row] = await dataSource.query<{ id: string; price_multiplier: string }[]>(
            `SELECT id, price_multiplier FROM technician_companies WHERE id = $1 AND is_active = true`,
            [companyId],
          );
          if (!row) throw new Error('الشركة غير موجودة أو غير نشطة');
          return { id: row.id, priceMultiplier: Number(row.price_multiplier) };
        },
      } as never,
      scheduleService,
      pricingEngine,
      {} as never, // promoCodesService — الاختبارات دي من غير كوبونات
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
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM service_pricing_evaluations WHERE order_id IN (SELECT id FROM orders WHERE customer_id=$1)`, [ids.customerProfile]);
      await q(`DELETE FROM service_pricing_evaluations WHERE service_id=$1 AND order_id IS NULL`, [ids.serviceFormula]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id=$1)`, [ids.customerProfile]);
      await q(`UPDATE recurring_order_templates SET last_generated_order_id=NULL WHERE customer_id=$1`, [ids.customerProfile]);
      await q(`DELETE FROM recurring_order_templates WHERE customer_id=$1`, [ids.customerProfile]);
      await q(`DELETE FROM orders WHERE customer_id=$1`, [ids.customerProfile]);
      await q(`DELETE FROM service_standard_data WHERE service_id=$1`, [ids.serviceFormula]);
      await q(`DELETE FROM service_pricing_rules WHERE service_id=$1`, [ids.serviceFormula]);
      await q(`DELETE FROM service_pricing_fields WHERE service_id=$1`, [ids.serviceFormula]);
      await q(`DELETE FROM services WHERE id=$1`, [ids.serviceFormula]);
      await q(`DELETE FROM service_categories WHERE id=$1`, [ids.category]);
      await q(`DELETE FROM addresses WHERE id=$1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id=$1`, [ids.customerProfile]);
      if (ids.company) await q(`DELETE FROM technician_companies WHERE id=$1`, [ids.company]);
      await q(`DELETE FROM users WHERE id=$1`, [ids.customerUser]);
      if (ids.companyOwnerUser) await q(`DELETE FROM users WHERE id=$1`, [ids.companyOwnerUser]);
    } finally {
      await cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  it('إعداد: حقل area + معادلة price=min(max(area*500,20000)) crew=ceil(area/40) duration=area/50', async () => {
    await fieldsService.create('00000000-0000-0000-0000-000000000001', ids.serviceFormula, {
      field_key: 'area',
      label_ar: 'المساحة',
      field_type: PricingFieldType.NUMBER,
      is_required: true,
      min_value: 10,
      max_value: 2000,
    });
    await rulesService.upsert('00000000-0000-0000-0000-000000000001', ids.serviceFormula, {
      rule_type: PricingRuleType.CONSTANT,
      rule_key: 'rate_per_m2',
      payload: { value: 500 },
    });
    await rulesService.upsert('00000000-0000-0000-0000-000000000001', ids.serviceFormula, {
      rule_type: PricingRuleType.FORMULA,
      rule_key: 'final_price',
      payload: {
        price_cents: {
          type: 'max',
          operands: [
            { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'constant_ref', rule_key: 'rate_per_m2' }] },
            { type: 'literal', value: 20000 },
          ],
        },
        required_technicians: { type: 'ceil', value: { type: 'divide', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'literal', value: 40 }] } },
        estimated_duration_days: { type: 'field_ref', field_key: 'area' },
        suitable_for_emergency: { type: 'literal', value: 0 },
      },
    });
  });

  it('حجز formula عادي: السعر + الطاقم + المدة كلهم في الـsnapshot من المعادلة', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceFormula,
      address_id: ids.address,
      field_values: { area: 100 },
    } as never);
    // area=100 → 100×500=50000 قرش (فوق min 20000)
    expect(order.totalAmountCents).toBe(50000);
    expect(order.requiredTechnicians).toBe(3); // ceil(100/40)
    expect(order.estimatedDurationDays).toBe(100);
    expect(order.orderType).toBe('standard');
  });

  it('min clamp: مساحة صغيرة سعرها تحت الحد الأدنى → يترفع للـmin', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceFormula,
      address_id: ids.address,
      field_values: { area: 10 }, // 10×500=5000 < min 20000 → 20000
    } as never);
    expect(order.totalAmountCents).toBe(20000);
    expect(order.requiredTechnicians).toBe(1); // ceil(10/40)=1
  });

  it('بوابة الطوارئ: المعادلة suitable_for_emergency=0 → حجز طوارئ يترفض بوضوح', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.serviceFormula,
        address_id: ids.address,
        booking_mode: 'emergency',
        field_values: { area: 100 },
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('الأولوية: standard_data لما العميل يستخدمه بيتقدم على مخرجات المعادلة', async () => {
    // نعمل صف standard_data بقيم طاقم مختلفة تمامًا
    const [std] = await q(
      `INSERT INTO service_standard_data
         (service_id, execution_type_ar, unit_ar, technician_daily_wage_cents, assistant_daily_wage_cents,
          productivity_per_day, min_technicians, min_assistants)
       VALUES ($1,'تشطيب بالمساحة','م²',10000,5000,20,5,2) RETURNING id`,
      [ids.serviceFormula],
    );
    // 100 وحدة ÷ 20/يوم = 5 أيام، والطاقم 5+2 — مختلفة تمامًا عن مخرجات المعادلة (3 فني/100 يوم)
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceFormula,
      address_id: ids.address,
      field_values: { area: 100 },
      standard_data_id: std.id,
      requested_units: 100,
    } as never);
    expect(order.requiredTechnicians).toBe(5); // من standard_data مش ceil(100/40)=3
    expect(order.requiredAssistants).toBe(2);
    expect(order.estimatedDurationDays).toBe(5); // 100 وحدة ÷ 20/يوم — من standard_data مش المعادلة
    // الطلب بيشاور على std (FK) — التنظيف النهائي في afterAll بعد حذف الطلبات
  });

  it('تكافؤ preview/create: نفس المدخلات = نفس السعر بالحرف', async () => {
    const created = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceFormula,
      address_id: ids.address,
      field_values: { area: 250 },
    } as never);
    const previewed = await ordersService.previewPrice(ids.customerUser, {
      service_id: ids.serviceFormula,
      address_id: ids.address,
      field_values: { area: 250 },
    } as never);
    expect(created.totalAmountCents).toBe(previewed.total_amount_cents);
    expect(created.totalAmountCents).toBe(125000); // 250×500
  });

  /**
   * docs/08 §64.ح — طلب المالك: «اتأكد إن كل حاجة بترفليكت في الحاجة المرتبطة بيها، سواء الـ
   * booking engine، price engine، schedule، auto matching».
   *
   * ده أقوى إثبات لـADR-0042: نفس الخدمة، نفس المدخلات، مرة بلا شركة ومرة بشركة معاملها 1.20 —
   * والاتنين عبر **فرع محرك التسعير الديناميكي** (formula) مش الفرع الثابت. لازم:
   *  1. المعاينة والإنشاء يديّوا نفس الرقم بالحرف (مفيش مفاجأة سعر بين الشاشة والتحصيل).
   *  2. الرقم = سعر المعادلة × 1.20 بالظبط.
   */
  it('ADR-0042: معامل الشركة بيسري في محرك التسعير، والمعاينة = الإنشاء بالحرف', async () => {
    const [owner] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at)
       VALUES ($1,$2,'technician',now()) RETURNING id`,
      [`+2055${Date.now().toString().slice(-9)}`.slice(0, 15), 'مالك شركة معامل'],
    );
    ids.companyOwnerUser = owner.id;
    const [company] = await q<{ id: string }[]>(
      `INSERT INTO technician_companies (owner_user_id, name, is_active, price_multiplier)
       VALUES ($1,'شركة معامل 1.20',true,1.20) RETURNING id`,
      [owner.id],
    );
    ids.company = company.id;
    // الخدمة في الـsuite دي متعمَلة بالافتراضيات — وضع "اعتماد" لازم يتفعّل عليها الأول.
    await q(`UPDATE services SET allows_team = true WHERE id = $1`, [ids.serviceFormula]);

    const input = { service_id: ids.serviceFormula, address_id: ids.address, field_values: { area: 250 } };
    const baseline = await ordersService.previewPrice(ids.customerUser, input as never);

    // اختيار شركة متاح بس في وضع "اعتماد" (team) — قاعدة موجودة من §62، مش من ADR-0042.
    // وضع الحجز بيأثّر على **العمولة** مش على سعر العميل، فالمقارنة مع الأساس فضلت صالحة.
    const companyInput = {
      ...input,
      booking_mode: 'team',
      requested_technician_company_id: company.id,
    };
    const previewed = await ordersService.previewPrice(ids.customerUser, companyInput as never);
    const created = await ordersService.create(ids.customerUser, companyInput as never);

    // 1) مفيش فرق بين اللي العميل شافه واللي اتحسب عليه.
    expect(created.totalAmountCents).toBe(previewed.total_amount_cents);
    // 2) المعامل سرى فعلاً: 125,000 × 1.20 = 150,000.
    expect(baseline.total_amount_cents).toBe(125000);
    expect(created.totalAmountCents).toBe(150000);
    // 3) الطلب محتفظ بالشركة المطلوبة — الـmatching بيقرا منها (matching.service.ts).
    expect(created.requestedTechnicianCompanyId).toBe(company.id);
  });
});
