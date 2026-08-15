import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { CashDisputeOutcome } from './dto/resolve-cash-dispute.dto';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { PaymentsService } from '../payments/payments.service';
import { Payment, PaymentGatewayStatus } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { User, UserType } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
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
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { SupportService } from '../support/support.service';
import { Complaint, ComplaintCategory } from '../support/entities/complaint.entity';
import { ComplaintMessage } from '../support/entities/complaint-message.entity';
import { ComplaintAttachment } from '../support/entities/complaint-attachment.entity';

// اختبار حي ضد Postgres حقيقي — تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14). بيغطي: تأكيد
// العميل وحده مايسوّيش الطلب؛ "لم أستلم" الفني يوديه DISPUTED + شكوى؛ التعارض (عميل أكّد + فني
// قال العكس) بيتلقّط؛ الأدمن يحل بـretry (يرجع collectCash()-able) أو confirm_received (تسوية
// إدارية مباشرة).
describe('Cash handover — تأكيد الطرفين (docs/08 §22 بند 13-14)', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let paymentsService: PaymentsService;
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
  };

  async function insertOrder(label: string, orderStatus: OrderStatus) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',30000,20000) RETURNING id`,
      [`TCASH-${label}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone, orderStatus],
    );
    return order.id as string;
  }

  const techUserPayload = () => ({ sub: ids.techUser, userType: UserType.TECHNICIAN, amr: ['otp'] as ('otp' | 'webauthn')[] });

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
        TechnicianProfile,
        TechnicianCompany,
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
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      ids.country,
      `مدينة اختبار ${runId}`,
      `Test City ${runId}`,
      `test-city-cash-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق اختبار ${runId}`,
      `Test Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اختبار ${runId}`,
      `Test Category ${runId}`,
      `test-category-cash-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-cash-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2033${runId}`.slice(0, 15),
      `عميل اختبار ${runId}`,
      `customer-cash-${runId}@test.local`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2034${runId}`.slice(0, 15),
      `فني اختبار ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level) VALUES ($1,$2,'x',3,'new') RETURNING id`,
      [ids.techUser, `TCCASH${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    const cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), { record: async () => undefined } as unknown as AuditLogService, cache);
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
    );
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      settingsService,
      {} as never,
    );
    const technicianLevelsService = new TechnicianLevelsService(
      dataSource.getRepository(TechnicianLevelConfig),
      {} as unknown as AuditLogService,
    );
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);
    const events = new EventEmitter2();

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
      { enqueueRecalculation: async () => undefined } as never,
      loyaltyService,
      settingsService,
      { record: async () => undefined } as unknown as AuditLogService,
      events,
      {} as never,
      {} as never,
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
      {} as never,
      {} as never,
      {} as never,
      techniciansService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // cancellationReasonsService
      walletsService,
      settingsService,
      paymentsService,
      supportService,
      events,
    );
  });

  // مهلة أطول من الـ5 ثانية الافتراضية — 15 DELETE متسلسلة + destroy() ممكن ياخدوا أكتر من كده
  // لما السويت ده بيتشغّل جوّه الحزمة الكاملة (48+ سويت متتالية بنفس الـworker، runInBand)، رغم إنه
  // بيخلص في أقل من 6 ثانية لوحده — بَقّة حقيقية اتلقطت (السويت كان بيتعلّم FAIL كامل رغم إن كل
  // الـ6 اختبار جوّه عدّوا فعليًا).
  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM complaints WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TCASH-%`]);
    await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TCASH-%`]);
    await q(`DELETE FROM loyalty_transactions WHERE user_id IN ($1, $2)`, [ids.techUser, ids.customerUser]);
    await q(`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_user_id IN ($1, $2))`, [ids.techUser, ids.customerUser]);
    await q(`DELETE FROM wallets WHERE owner_user_id IN ($1, $2)`, [ids.techUser, ids.customerUser]);
    await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TCASH-%`]);
    await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TCASH-%`]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
    await q(`DELETE FROM users WHERE id IN ($1, $2)`, [ids.customerUser, ids.techUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await dataSource.destroy();
  }, 30000);

  it('تأكيد العميل وحده — مايسوّيش الطلب، مايحصّلش، وidempotent لنقر مزدوج', async () => {
    const orderId = await insertOrder(`cc-${runId}`, OrderStatus.WORK_COMPLETED);

    const first = await ordersService.confirmCashHandover(ids.customerUser, orderId);
    expect(first.orderStatus).toBe(OrderStatus.WORK_COMPLETED);
    expect(first.customerCashConfirmedAt).not.toBeNull();

    const second = await ordersService.confirmCashHandover(ids.customerUser, orderId);
    expect(second.customerCashConfirmedAt!.getTime()).toBe(first.customerCashConfirmedAt!.getTime());

    const payments = await dataSource.getRepository(Payment).find({ where: { orderId } });
    expect(payments.length).toBe(0);
  });

  it('"لم أستلم" الفني بلا تأكيد عميل سابق — DISPUTED + شكوى، عنوان بلاغ عادي (مش نزاع)', async () => {
    const orderId = await insertOrder(`nr-${runId}`, OrderStatus.WORK_COMPLETED);

    const updated = await ordersService.reportCashNotReceived(techUserPayload(), orderId, {
      description: 'العميل قال هيدفع كاش بس اختفى بعد ما الشغل خلص',
    });
    expect(updated.orderStatus).toBe(OrderStatus.DISPUTED);
    expect(updated.technicianCashNotReceivedAt).not.toBeNull();

    const complaint = await dataSource.getRepository(Complaint).findOne({ where: { orderId } });
    expect(complaint?.category).toBe(ComplaintCategory.OTHER);
    expect(complaint?.title).not.toContain('نزاع تسليم كاش');
  });

  it('تعارض — العميل أكّد التسليم والفني قال "لم أستلم" — عنوان الشكوى يوضّح التعارض', async () => {
    const orderId = await insertOrder(`cf-${runId}`, OrderStatus.WORK_COMPLETED);
    await ordersService.confirmCashHandover(ids.customerUser, orderId);

    const updated = await ordersService.reportCashNotReceived(techUserPayload(), orderId, {
      description: 'العميل بيقول إنه دفع بس أنا فعليًا ما استلمتش أي فلوس',
    });
    expect(updated.orderStatus).toBe(OrderStatus.DISPUTED);

    const complaint = await dataSource.getRepository(Complaint).findOne({ where: { orderId } });
    expect(complaint?.title).toContain('نزاع تسليم كاش');
  });

  it('resolveCashHandoverDispute(retry) — الطلب يرجع WORK_COMPLETED، الأعلام بترجع فاضية، collectCash() تنجح تاني', async () => {
    const orderId = await insertOrder(`rt-${runId}`, OrderStatus.WORK_COMPLETED);
    await ordersService.confirmCashHandover(ids.customerUser, orderId);
    await ordersService.reportCashNotReceived(techUserPayload(), orderId, { description: 'مش متأكد اللي حصل بالظبط' });

    const resolved = await ordersService.resolveCashHandoverDispute(ids.customerUser, orderId, {
      outcome: CashDisputeOutcome.RETRY,
      admin_notes: 'راجعنا الموقف — الفني يعيد المحاولة',
    });
    expect(resolved.orderStatus).toBe(OrderStatus.WORK_COMPLETED);
    expect(resolved.customerCashConfirmedAt).toBeNull();
    expect(resolved.technicianCashNotReceivedAt).toBeNull();

    const payment = await paymentsService.collectCash(ids.techUser, orderId);
    expect(payment.paymentStatus).toBe(PaymentGatewayStatus.SUCCEEDED);

    const finalOrder = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(finalOrder.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(finalOrder.paymentStatus).toBe(OrderPaymentStatus.PAID);
  });

  it('resolveCashHandoverDispute(confirm_received) — تسوية إدارية مباشرة، الطلب COMPLETED', async () => {
    const orderId = await insertOrder(`cr-${runId}`, OrderStatus.WORK_COMPLETED);
    await ordersService.reportCashNotReceived(techUserPayload(), orderId, { description: 'مش متأكد، هراجع تاني' });

    const resolved = await ordersService.resolveCashHandoverDispute(ids.customerUser, orderId, {
      outcome: CashDisputeOutcome.CONFIRM_RECEIVED,
      admin_notes: 'راجعنا وطلعت الفلوس فعلاً اتحصّلت',
    });
    expect(resolved.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(resolved.paymentStatus).toBe(OrderPaymentStatus.PAID);

    const payment = await dataSource.getRepository(Payment).findOne({ where: { orderId } });
    expect(payment?.collectedByUserId).toBe(ids.customerUser);
    expect(payment?.paymentStatus).toBe(PaymentGatewayStatus.SUCCEEDED);
  });

  it('مينفعش تحل نزاع كاش لطلب مش نزاع كاش أصلاً', async () => {
    const orderId = await insertOrder(`na-${runId}`, OrderStatus.WORK_COMPLETED);
    await expect(
      ordersService.resolveCashHandoverDispute(ids.customerUser, orderId, {
        outcome: CashDisputeOutcome.RETRY,
        admin_notes: 'محاولة غلط',
      }),
    ).rejects.toThrow();
  });
});
