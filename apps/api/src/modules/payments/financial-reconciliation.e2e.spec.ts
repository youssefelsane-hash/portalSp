import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { PaymentsService } from './payments.service';
import { Payment } from './entities/payment.entity';
import { Refund, RefundStatus } from './entities/refund.entity';
import { Wallet, PLATFORM_SYSTEM_USER_ID } from './entities/wallet.entity';
import { WalletTransaction, WalletTxType } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';
import { PayoutsService } from './payouts.service';
import { Payout, PayoutStatus } from './entities/payout.entity';
import { PayoutOrderItem } from './entities/payout-order-item.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
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
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Address } from '../customers/entities/address.entity';
import { crewEarningsServiceStub } from './crew-earnings.testing';

/**
 * Script 7 Phase 35 — Financial Reconciliation Test. الأسئلة الحاكمة من تعليمات الـaudit الأصلية
 * لأي تدفّق مالي: الفلوس جت منين، فين دلوقتي، مين مالكها، تقدر تتحرك/تتخلق/تختفي؟ الاختبار ده
 * بيثبت مباشرة إن `WalletsService.doubleEntry()` نظام قيد مزدوج مقفول فعليًا (مفيش فلوس بتتخلق
 * ولا تختفي من العدم) عبر سلسلة عمليات مالية حقيقية متتابعة (تسوية → استرداد جزئي → صرف) على نفس
 * المحافظ، مش عملية واحدة معزولة. النطاق مقصور على المحافظ اللي الاختبار ده نفسه لمسها (مش الداتابيز
 * كلها — قاعدة البيانات المشتركة دي فيها بيانات اختبار تراكمية من شهور من السيشنز، مش مصدر حقيقي
 * موثوق للتصفير الكامل، نفس فلسفة كل اختبار تاني في هذا الـaudit اللي بيقيس delta مش القيمة المطلقة).
 */
describe('التسوية المالية — سلسلة تسوية/استرداد/صرف حقيقية (Script 7 Phase 35)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let paymentsService: PaymentsService;
  let walletsService: WalletsService;
  let payoutsService: PayoutsService;
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
    technicianUser: '',
    technicianProfile: '',
    order: '',
    payment: '',
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
        Payment,
        Refund,
        User,
        WebhookEvent,
        Wallet,
        WalletTransaction,
        Payout,
        PayoutOrderItem,
        CustomerProfile,
        Address,
        City,
        Area,
        ServiceZone,
        TechnicianProfile,
        TechnicianCompany,
        Setting,
        ServiceCategory,
        Service,
        ServiceZonePricing,
        ServiceLevelPricing,
        ServiceAddon,
        ServiceStandardData,
        TechnicianLevelConfig,
        LoyaltyTransaction,
        OrderStatusHistory,
      ],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      ids.country,
      `مدينة التسوية ${runId}`,
      `Reconciliation City ${runId}`,
      `test-city-recon-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق التسوية ${runId}`,
      `Reconciliation Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة التسوية ${runId}`,
      `Reconciliation Category ${runId}`,
      `test-category-recon-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, allows_emergency)
       VALUES ($1,$2,$3,'formula',100000,20,0,false) RETURNING id`,
      [ids.category, `خدمة التسوية ${runId}`, `test-service-recon-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2050${runId}`.slice(0, 15),
      `عميل التسوية ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع التسوية ${runId}`],
    );
    ids.address = address.id;

    const [technicianUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2051${runId}`.slice(0, 15), `فني التسوية ${runId}`],
    );
    ids.technicianUser = technicianUser.id;
    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, is_available, current_level)
       VALUES ($1,$2,true,'new') RETURNING id`,
      [ids.technicianUser, `TECH-RECON-${runId}`],
    );
    ids.technicianProfile = technicianProfile.id;

    // طلب كاش مكتمل الشغل (مش مدفوع لسه) — بديل واقعي لدورة التنفيذ الكاملة (مختبرة بعمق منفصل
    // في golden-path-cash-booking.e2e.spec.ts)، التركيز هنا على السلسلة المالية بعد الاكتمال.
    const [order] = await q(
      `INSERT INTO orders (
         order_number, customer_id, service_id, address_id, service_zone_id, technician_id, order_type,
         booking_mode, order_status, estimated_price_cents, inspection_fee_cents, surge_amount_cents,
         total_amount_cents, payment_status, placed_at, source_channel
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'standard','individual','work_completed',100000,0,0,100000,'unpaid',now(),'customer_app'
       ) RETURNING id`,
      [`ORD-RECON-${runId}`, ids.customerProfile, ids.service, ids.address, ids.zone, ids.technicianProfile],
    );
    ids.order = order.id;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), { record: async () => undefined } as unknown as AuditLogService, cache);
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
    walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    // دفتر القيود هنا مبني على عمولة الخدمة 20%؛ فرق المستوى سياسة مستقلة قابلة للتعديل.
    const technicianLevelsService = { getOrThrow: async () => ({ commissionAdjustmentPercentage: '0' }) } as never;
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);
    const events = new EventEmitter2();
    const statsStub = { enqueueRecalculation: async () => undefined } as never;

    // مفيش استرداد حقيقي مدعوم للكاش (نفس CashProvider الحقيقي) — supportsRefund: false
    // يخلي refundOrder() ياخد مسار WALLET_CREDIT بدل ما ينده على بوابة دفع حقيقية.
    const fakeCashProvider = {
      providerKey: 'cash',
      isConfigured: true,
      supportsRefund: false,
      supportsVoid: false,
      supportsCapture: false,
      supportsTokenization: false,
      async createPayment() {
        throw new Error('not used in this test');
      },
      verifyWebhook() {
        throw new Error('not used in this test');
      },
      async refund() {
        throw new Error('cash refunds never go through the gateway');
      },
    } as never;
    const fakePaymentProviders = { getProvider: () => fakeCashProvider } as never;

    paymentsService = new PaymentsService(
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
      statsStub,
      loyaltyService,
      settingsService,
      { record: async () => undefined } as unknown as AuditLogService,
      events,
      fakePaymentProviders,
      {} as never,
      {} as never, // installments repo (migration 0177)
      crewEarningsServiceStub(),
    );

    payoutsService = new PayoutsService(
      dataSource.getRepository(Payout),
      dataSource.getRepository(PayoutOrderItem),
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(User),
      dataSource,
      techniciansService,
      walletsService,
      { record: async () => undefined } as unknown as AuditLogService,
      settingsService,
      events,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM payout_order_items WHERE payout_id IN (SELECT id FROM payouts WHERE technician_id = $1)`, [
        ids.technicianProfile,
      ]);
      await q(`DELETE FROM payouts WHERE technician_id = $1`, [ids.technicianProfile]);
      await q(`DELETE FROM refunds WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_user_id = ANY($1))`, [
        [ids.customerUser, ids.technicianUser],
      ]);
      await q(`DELETE FROM wallets WHERE owner_user_id = ANY($1)`, [[ids.customerUser, ids.technicianUser]]);
      await q(`DELETE FROM payments WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM loyalty_transactions WHERE user_id = ANY($1)`, [[ids.customerUser, ids.technicianUser]]);
      await q(`DELETE FROM order_status_history WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.customerUser, ids.technicianUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  /** رصيد المحفظة المحسوب من تاريخ حركاتها (credits − debits، غير المعكوسة) — لازم يطابق
   * `wallets.balance_cents` المخزّن بالظبط، وإلا فيه انحراف بين الرصيد المعروض والدفتر الفعلي. */
  async function computeBalanceFromLedger(walletId: string): Promise<number> {
    const [row] = await dataSource.query<{ net: string }[]>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) AS net
       FROM wallet_transactions WHERE wallet_id = $1`,
      [walletId],
    );
    return Number(row.net);
  }

  it('تسوية كاش → استرداد جزئي → صرف: كل محفظة بتطابق دفتر حركاتها بالظبط، والقيد المزدوج مقفول (صفر فلوس اتخلقت أو اختفت)', async () => {
    // 1) تحصيل كاش + تسوية — نفس PaymentsService.collectCash() الحقيقية.
    const payment = await paymentsService.collectCash(ids.technicianUser, ids.order);
    ids.payment = payment.id;
    expect(payment.amountCents).toBe(100000);

    const technicianWallet = await walletsService.findByUserIdOrThrow(ids.technicianUser);
    const platformWallet = await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    // كاش كامل، عمولة 20% → الفني مديون 20000 (راجع BUG سابق موثّق في payments/README.md).
    expect(technicianWallet.balanceCents).toBe(-20000);
    expect(await computeBalanceFromLedger(technicianWallet.id)).toBe(technicianWallet.balanceCents);
    // لقطة دفتر محفظة المنصة قبل الاسترداد — لازم تتاخد دلوقتي، مش بعد الاسترداد، عشان دلتا
    // حقيقية (computeBalanceFromLedger بيستعلم الحالة الحيّة للجدول وقت النداء، مش لقطة تاريخية).
    const platformLedgerBefore = await computeBalanceFromLedger(platformWallet.id);

    // 2) استرداد جزئي (30% من الطلب) — نفس PaymentsService.refundOrder() الحقيقية. WALLET_CREDIT
    // لأن كاش مالوش بوابة حقيقية تسترد منها.
    const refund = await paymentsService.refundOrder(
      ids.customerUser,
      ids.order,
      'اختبار تسوية مالية — Script 7 Phase 35',
      30000,
    );
    expect(refund.refundStatus).toBe(RefundStatus.COMPLETED);
    expect(refund.amountCents).toBe(30000);

    const technicianWalletAfterRefund = await walletsService.findByUserIdOrThrow(ids.technicianUser);
    const platformWalletAfterRefund = await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    const customerWallet = await walletsService.findByUserIdOrThrow(ids.customerUser);

    // عكس أرباح الفني متناسب: 80000 (نصيبه) × 30000/100000 = 24000.
    expect(technicianWalletAfterRefund.balanceCents).toBe(-20000 - 24000);
    expect(customerWallet.balanceCents).toBe(30000);
    // فرق محفظة المنصة: +24000 (عكس أرباح الفني) − 30000 (استرداد العميل) = −6000.
    expect(platformWalletAfterRefund.balanceCents - platformWallet.balanceCents).toBe(24000 - 30000);

    // محفظتا العميل والفني اتنشئوا في الاختبار ده نفسه (مستخدمين جداد) فتاريخهم كامل هنا —
    // تطابق مطلق سليم. محفظة المنصة مشتركة عبر شهور من تشغيل الاختبارات على نفس قاعدة البيانات
    // (انحراف تاريخي موثّق من قبل)، فالمقياس الصحيح ليها هو الفرق (delta) بين قبل/بعد، مش القيمة
    // المطلقة — نفس فلسفة كل باقي هذا الاختبار.
    for (const wallet of [technicianWalletAfterRefund, customerWallet]) {
      expect(await computeBalanceFromLedger(wallet.id)).toBe(wallet.balanceCents);
    }
    const platformLedgerAfterRefund = await computeBalanceFromLedger(platformWalletAfterRefund.id);
    expect(platformLedgerAfterRefund - platformLedgerBefore).toBe(
      platformWalletAfterRefund.balanceCents - platformWallet.balanceCents,
    );

    // 3) القيد المزدوج مقفول فعليًا — مجموع كل الحركات المتعلقة بالطلب ده (settle + refund) لازم
    // يساوي صفر بالظبط (كل خصم له إضافة مقابلة، مفيش فلوس اتخلقت أو اختفت من العدم).
    const [{ net: orderNet }] = await dataSource.query<{ net: string }[]>(
      `SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END), 0) AS net
       FROM wallet_transactions WHERE reference_type IN ('order','refund') AND reference_id IN ($1, $2)`,
      [ids.order, refund.id],
    );
    expect(Number(orderNet)).toBe(0);

    // 4) صرف — الفني مديون (-44000)، فمينفعش يطلب صرف. نحاكي رصيد متاح حقيقي (أرباح طلبات سابقة
    // متراكمة، مش مُخترعة — allowNegativeBalance زي settleAndComplete بالظبط لنفس السبب) عشان
    // نختبر finalizePayout()'s double-entry نفسه.
    await walletsService.doubleEntry(
      {
        fromWalletId: platformWallet.id,
        toWalletId: technicianWalletAfterRefund.id,
        amountCents: 100000,
        transactionType: WalletTxType.ORDER_EARNING,
        referenceType: 'order',
        referenceId: ids.order,
        descriptionAr: 'محاكاة أرباح طلبات سابقة — Script 7 Phase 35',
        allowNegativeBalance: true,
      },
      undefined,
    );
    const technicianWalletFunded = await walletsService.findByUserIdOrThrow(ids.technicianUser);
    expect(technicianWalletFunded.balanceCents).toBe(-44000 + 100000); // 56000، موجب دلوقتي

    const payout = await payoutsService.requestPayout(ids.technicianUser, {
      amount_cents: 50000,
      payout_method: 'bank_transfer',
    } as never);
    expect(payout.payoutStatus).toBe(PayoutStatus.APPROVED); // تحت حد الموافقة التلقائية

    const completedPayout = await payoutsService.adminComplete(ids.customerUser, payout.id);
    expect(completedPayout.payoutStatus).toBe(PayoutStatus.COMPLETED);

    const technicianWalletFinal = await walletsService.findByUserIdOrThrow(ids.technicianUser);
    const platformWalletFinal = await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    // finalizePayout: reserved_balance_cents بيخرج نهائي، balance_cents ماتغيّرش وقت الصرف نفسه
    // (كانت اتخصمت وقت الحجز في requestPayout).
    expect(technicianWalletFinal.balanceCents).toBe(56000 - 50000);
    expect(technicianWalletFinal.reservedBalanceCents).toBe(0);
    expect(platformWalletFinal.balanceCents - platformWalletAfterRefund.balanceCents).toBe(50000 - 100000); // -100000 مقابل تمويل الاختبار فوق، +50000 من الصرف

    // الرصيد المخزّن يفضل مطابق للدفتر حتى بعد reserve/release/finalize (محفظة الفني كاملة
    // تاريخها هنا — مستخدم جديد اتنشأ في الاختبار ده نفسه، فمطابقة مطلقة سليمة).
    expect(await computeBalanceFromLedger(technicianWalletFinal.id)).toBe(technicianWalletFinal.balanceCents);
  }, 30000);
});
