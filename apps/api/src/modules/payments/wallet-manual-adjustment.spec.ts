import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { PaymentsService } from './payments.service';
import { Order, OrderPaymentStatus, OrderStatus } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { Payment } from './entities/payment.entity';
import { Refund } from './entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { Wallet, PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from './entities/wallet.entity';
import { WalletTransaction, WalletTxType } from './entities/wallet-transaction.entity';
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
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';

// اختبار حي ضد Postgres حقيقي — بيثبت تصحيح المحفظة اليدوي الجديد (docs/08 §20 بند 5): كانت
// فجوة حقيقية — AdminWalletController كان قراءة بس، صفر مسار لأدمن/مالية يصحّح رصيد فني (مثلاً
// تحصيل كاش اتسجّل غلط). بيثبت المبدأ الأهم: التصحيح قيد جديد (append-only)، مش تعديل/مسح للتاريخ.
describe('PaymentsService.adminAdjustWallet() — تصحيح محفظة يدوي append-only (docs/08 §20 بند 5)', () => {
  let dataSource: DataSource;
  let service: PaymentsService;
  let walletsService: WalletsService;

  const runId = Date.now().toString(36);
  const ids = { techUser: '', techProfile: '', adminUser: '' };

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

    const [techUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2024${runId}`.slice(0, 15), `فني تصحيح ${runId}`],
    );
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCADJ${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;
    const [adminUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2025${runId}`.slice(0, 15), `أدمن تصحيح ${runId}`],
    );
    ids.adminUser = adminUser.id;

    const cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
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
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
    );
    const technicianLevelsService = new TechnicianLevelsService(dataSource.getRepository(TechnicianLevelConfig), {} as unknown as AuditLogService);
    walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);

    await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);
    // الفني لازم يبقى عنده محفظة موجودة فعلاً — adminAdjustWallet بيستخدم findByUserIdOrThrow
    // (مش getOrCreateWallet) عشان الأدمن يقدر يصحّح رصيد فني حقيقي عنده معاملات بالفعل، مش ينشئ
    // محفظة جديدة بالغلط لمستخدم مالوش نشاط مالي أصلاً.
    await walletsService.getOrCreateWallet(ids.techUser, WalletOwnerType.TECHNICIAN);

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
      { enqueueRecalculation: async () => undefined } as never,
      loyaltyService,
      settingsService,
      { record: async () => undefined } as never,
      { emit: () => undefined } as never,
      {} as never,
      {} as never, // savedPaymentMethods (docs/08 §21) — مش متنادى في الاختبار ده
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    // القيود على محفظة المنصة (اللي طرفها التاني تحصيل/تصحيح الفني ده) بتتمسح بالـperformed_by_user_id
    // أولاً — الفني نفسه بيتمسح بعده بالـwallet_id، ومحفظة المنصة الشير مع كل الاختبارات التانية تفضل زي ما هي.
    await q(`DELETE FROM wallet_transactions WHERE performed_by_user_id = $1`, [ids.adminUser]);
    await q(`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_user_id = $1)`, [ids.techUser]);
    await q(`DELETE FROM wallets WHERE owner_user_id = $1`, [ids.techUser]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
    await q(`DELETE FROM users WHERE id IN ($1, $2)`, [ids.techUser, ids.adminUser]);
    await dataSource.destroy();
  });

  it('تصحيح كاش غلط (تحصيل اتسجّل 1000 والصح 900) — قيد جديد فرقه 100 بس، مش تعديل القيد القديم', async () => {
    // نفس مثال طلب المالك بالحرف: تحصيل أصلي 1000 (لأي سبب، محاكى هنا كـcredit اختباري)، تصحيح -100
    const original = await walletsService.doubleEntry({
      fromWalletId: (await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID)).id,
      toWalletId: (await walletsService.findByUserIdOrThrow(ids.techUser)).id,
      amountCents: 100000,
      transactionType: WalletTxType.ORDER_EARNING,
      referenceType: 'order',
      referenceId: randomUUID(),
      descriptionAr: 'تحصيل أصلي (محاكاة)',
      allowNegativeBalance: true, // محفظة المنصة تمثيل محاسبي، مش رصيد حقيقي محدود
    });
    const balanceAfterOriginal = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;
    expect(balanceAfterOriginal).toBe(100000);

    const result = await service.adminAdjustWallet(ids.adminUser, ids.techUser, 10000, 'debit', 'تصحيح: التحصيل الصح 900 مش 1000');

    expect(result.newBalanceCents).toBe(90000); // 1000 - 100 = 900

    // القيد الأصلي لسه موجود زي ما هو بالظبط — مفيش تعديل/مسح
    const originalDebitReloaded = await dataSource.getRepository(WalletTransaction).findOne({ where: { id: original.credit.id } });
    expect(originalDebitReloaded?.amountCents).toBe(100000);
    expect(originalDebitReloaded?.isReversed).toBe(false);

    // قيد جديد منفصل بقيمة التصحيح بس (100)، نوعه ADJUSTMENT، وموثّق مين عمله وليه
    const allTxs = await dataSource
      .getRepository(WalletTransaction)
      .find({ where: { walletId: (await walletsService.findByUserIdOrThrow(ids.techUser)).id } });
    const adjustmentTx = allTxs.find((t) => t.transactionType === WalletTxType.ADJUSTMENT);
    expect(adjustmentTx?.amountCents).toBe(10000);
    expect(adjustmentTx?.direction).toBe('debit');
    expect(adjustmentTx?.descriptionAr).toContain('900');
    expect(adjustmentTx?.performedByUserId).toBe(ids.adminUser);

    // إجمالي القيود = 4 (أصلي: debit+credit، تصحيح: debit+credit) — صفر قيد اتمسح أو اتحدّث
    expect(allTxs.length).toBe(2); // بس القيود اللي على محفظة الفني نفسها (مش المنصة)
  });

  it('تصحيح لصالح الفني (credit) — رصيده بيزيد بالظبط بقيمة التصحيح', async () => {
    const before = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;
    const result = await service.adminAdjustWallet(ids.adminUser, ids.techUser, 5000, 'credit', 'تعويض إداري');
    expect(result.newBalanceCents - before).toBe(5000);
  });
});
