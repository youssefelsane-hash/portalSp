import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Order, OrderPaymentStatus, OrderStatus } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { Refund } from './entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { Wallet, PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';
import { CatalogService } from '../catalog/catalog.service';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { crewEarningsServiceStub } from './crew-earnings.testing';

// اختبار حي ضد Postgres حقيقي — بيثبت أساس العمولة الجديد (ADR-0037، docs/08 §60.1).
//
// بلاغ المالك بالحرف: «لو حد طلب ضمان مع الحاجة، الشركة بتبقى نسبتها من الضمان 15%، ده خطأ
// تمامًا». يعني الفني كان بياخد 85% من سعر الضمان. الاختبار ده بيشغّل التسوية الحقيقية على
// طلب فيه ضمان ويتأكد إن الضمان بقى 100% للشركة.
describe('أساس العمولة في التسوية الحقيقية (ADR-0037، docs/08 §60.1)', () => {
  let dataSource: DataSource;
  let service: PaymentsService;
  let cache: RedisCacheService;

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
    techUser: '',
    techProfile: '',
    warrantyPlan: '',
  };
  const COMMISSION_PERCENT = 10;

  /**
   * بيدخل طلب مكتمل الشغل ومدفوع مسبقًا بالكامل، بتفصيل صريح: سعر شغل + سعر ضمان.
   * `commissionableBaseCents` بيتمرّر زي ما `OrdersService.create()` بيحسبه بالظبط.
   */
  async function insertOrderWithWarranty(
    label: string,
    workPriceCents: number,
    warrantyPriceCents: number,
    commissionableBaseCents: number | null,
  ) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const totalAmountCents = workPriceCents + warrantyPriceCents;
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, payment_method, estimated_price_cents, warranty_plan_id, warranty_plan_snapshot, warranty_price_cents, total_amount_cents, commissionable_base_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'work_completed','paid','card',$7,$8,$9,$10,$11,$12,0) RETURNING id`,
      [
        `CBS${runId}-${label}`.slice(0, 24),
        ids.customerProfile,
        ids.techProfile,
        ids.service,
        ids.address,
        ids.zone,
        workPriceCents,
        warrantyPriceCents > 0 ? ids.warrantyPlan : null,
        warrantyPriceCents > 0 ? JSON.stringify({ name_ar: 'ضمان اختبار', coverage_months: 12 }) : null,
        warrantyPriceCents,
        totalAmountCents,
        commissionableBaseCents,
      ],
    );
    await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, gateway_transaction_id, completed_at)
       VALUES ($1,$2,$3,$4,'card','succeeded',$5,$6, now() - interval '2 hours')`,
      [`PCB${runId}-${label}`.slice(0, 24), order.id, ids.customerProfile, totalAmountCents, `idem-cbs-${runId}-${label}`, `gw-cbs-${runId}-${label}`],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Order,
        Payment,
        Refund,
        User,
        WebhookEvent,
        OrderStatusHistory,
        Wallet,
        WalletTransaction,
        ServiceCategory,
        Service,
        ServiceZonePricing,
        ServiceLevelPricing,
        ServiceAddon,
        ServiceStandardData,
        TechnicianProfile,
        TechnicianCompany,
        TechnicianLevelConfig,
        CustomerProfile,
        LoyaltyTransaction,
        Setting,
      ],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة اختبار ${runId}`, `Test Country ${runId}`, runId.slice(-2).toUpperCase(), '+008', 'EGP'],
    );
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-cbs-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق اختبار ${runId}`,
      `Test Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-cbs-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',10000,$4,0) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-cbs-${runId}`, COMMISSION_PERCENT],
    );
    ids.service = serviceRow.id;

    // قيد chk_orders_optional_warranty_snapshot (migration 0182) بيمنع warranty_price_cents > 0
    // من غير خطة ضمان حقيقية + snapshot — فلازم خطة فعلية عشان السيناريو يبقى واقعي.
    const [warrantyPlan] = await q(
      `INSERT INTO warranty_plans (slug, name_ar, coverage_months, pricing_model, price_value)
       VALUES ($1,$2,12,'fixed',200) RETURNING id`,
      [`test-warranty-cbs-${runId}`.slice(0, 60), `ضمان اختبار ${runId}`],
    );
    ids.warrantyPlan = warrantyPlan.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2040${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.customerUser,
    ]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    const [techUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2041${runId}`.slice(0, 15), `فني اختبار ${runId}`],
    );
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCCBS${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

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
      {} as never, // pricingEngineService — مش متنادى (findServiceOrThrow بس)
      {} as never, // docs/08 §36.24 ADR-0025 — ServicePricingTierPricing repo جديد
    );
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never, // technicianServicesRepo
      {} as never, // servicesRepo
      dataSource.getRepository(User),
      {} as never, // portfolioLinksService
      {} as never, // certificatesService
      {} as unknown as AuditLogService,
      {} as never, // geoService
      {} as never, // settingsService
    );
    // سياسة المستوى إعداد عالمي متغير؛ هذا الاختبار يعزل تسوية الدفع المسبق فقط.
    const technicianLevelsService = { getOrThrow: async () => ({ commissionAdjustmentPercentage: '0' }) } as never;
    const walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);

    // محفظة المنصة لازم تكون موجودة فعليًا (findByUserIdOrThrow بترفض لو مش موجودة) — مش مضمونة
    // في قاعدة اختبار جديدة تمامًا، بس migration 0019 المفروض عملتها. نتأكد دفاعيًا.
    await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);

    service = new PaymentsService(
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
      { enqueueRecalculation: async () => undefined } as never, // technicianStatsService — بره نطاق الاختبار ده
      loyaltyService,
      settingsService,
      { record: async () => undefined } as never, // auditLog
      { emit: () => undefined } as never, // events
      {} as never, // paymentProviders — مش متنادى (collectCash بس هنا)
      {} as never, // savedPaymentMethods (docs/08 §21) — مش متنادى في الاختبار ده
      {} as never, // installments repo (migration 0177)
      crewEarningsServiceStub(),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(
        `DELETE FROM wallet_transactions
         WHERE reference_id IN (SELECT id FROM orders WHERE customer_id = $1)
            OR wallet_id IN (SELECT id FROM wallets WHERE owner_user_id IN ($2, $3))`,
        [ids.customerProfile, ids.techUser, ids.customerUser],
      );
      await q(`DELETE FROM customer_warranties WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM wallets WHERE owner_user_id IN ($1, $2)`, [ids.techUser, ids.customerUser]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.techUser]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM loyalty_transactions WHERE user_id = $1`, [ids.customerUser]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM warranty_plans WHERE id = $1`, [ids.warrantyPlan]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
      await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    } finally {
      await cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  async function settledOrder(orderId: string) {
    await service.settleAlreadyPaidOrder(orderId);
    const [row] = await dataSource.query(
      `SELECT total_amount_cents, commissionable_base_cents, technician_earning_cents, platform_commission_cents, commission_rate_applied
       FROM orders WHERE id = $1`,
      [orderId],
    );
    return {
      total: Number(row.total_amount_cents),
      base: row.commissionable_base_cents === null ? null : Number(row.commissionable_base_cents),
      technician: Number(row.technician_earning_cents),
      platform: Number(row.platform_commission_cents),
      rate: Number(row.commission_rate_applied),
    };
  }

  it('بلاغ المالك: الضمان بقى 100% للشركة — الفني بياخد على سعر الشغل بس', async () => {
    // شغل 1000ج + ضمان 200ج = 1200ج، عمولة الخدمة 10%.
    const orderId = await insertOrderWithWarranty('warranty', 100_000, 20_000, 100_000);
    const result = await settledOrder(orderId);

    expect(result.rate).toBe(COMMISSION_PERCENT);
    expect(result.total).toBe(120_000);
    expect(result.base).toBe(100_000);
    // 1000 × 90% = 900 للفني.
    expect(result.technician).toBe(90_000);
    // 100 عمولة + 200 ضمان كامل = 300 للشركة.
    expect(result.platform).toBe(30_000);

    // السلوك القديم للمقارنة الصريحة: 1200 × 90% = 1080 (يعني 180ج من الضمان للفني).
    expect(result.technician).not.toBe(108_000);
  });

  it('الثابت المحاسبي محفوظ: نصيب الفني + نصيب الشركة = إجمالي الطلب', async () => {
    const orderId = await insertOrderWithWarranty('invariant', 77_777, 13_333, 77_777);
    const result = await settledOrder(orderId);
    expect(result.technician + result.platform).toBe(result.total);
  });

  it('طلب قديم (commissionable_base_cents = NULL) بيتسوّى بالسلوك القديم — مفيش تغيير بأثر رجعي', async () => {
    const orderId = await insertOrderWithWarranty('legacy', 100_000, 20_000, null);
    const result = await settledOrder(orderId);

    expect(result.base).toBeNull();
    // الوعاء بيرجع للإجمالي: 1200 × 90% = 1080 — بالظبط زي ما الطلب ده كان هيتسوّى قبل الـADR.
    expect(result.technician).toBe(108_000);
    expect(result.platform).toBe(12_000);
  });

  it('طلب بلا ضمان: النتيجة نفسها قبل وبعد الـADR (مفيش انحدار على الحالة العادية)', async () => {
    const orderId = await insertOrderWithWarranty('nowarranty', 100_000, 0, 100_000);
    const result = await settledOrder(orderId);
    expect(result.technician).toBe(90_000);
    expect(result.platform).toBe(10_000);
  });
});
