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
import { WalletAdjustment } from './entities/wallet-adjustment.entity';
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
  let cache: RedisCacheService;
  let platformBalanceBefore = 0;

  const runId = Date.now().toString(36);
  const ids = { techUser: '', techProfile: '', adminUser: '', walletRaceUser: '' };

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
        WalletAdjustment,
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
    const [walletRaceUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2026${runId}`.slice(0, 15), `عميل محفظة متزامنة ${runId}`],
    );
    ids.walletRaceUser = walletRaceUser.id;

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
      {} as never,
    );
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
    );
    const technicianLevelsService = new TechnicianLevelsService(dataSource.getRepository(TechnicianLevelConfig), {} as unknown as AuditLogService);
    walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);

    platformBalanceBefore = (
      await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM)
    ).balanceCents;
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
    if (!dataSource?.isInitialized) return;
    try {
      const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
      // القيود على محفظة المنصة (اللي طرفها التاني تحصيل/تصحيح الفني ده) بتتمسح بالـperformed_by_user_id
      // أولاً — الفني نفسه بيتمسح بعده بالـwallet_id، ومحفظة المنصة الشير مع كل الاختبارات التانية تفضل زي ما هي.
      await q(`DELETE FROM wallet_adjustments WHERE actor_user_id = $1`, [ids.adminUser]);
      await q(`DELETE FROM wallet_transactions WHERE performed_by_user_id = $1`, [ids.adminUser]);
      await q(`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_user_id = $1)`, [ids.techUser]);
      await q(`UPDATE wallets SET balance_cents = $1 WHERE owner_user_id = $2`, [
        platformBalanceBefore,
        PLATFORM_SYSTEM_USER_ID,
      ]);
      await q(`DELETE FROM wallets WHERE owner_user_id IN ($1, $2)`, [ids.techUser, ids.walletRaceUser]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [ids.techUser, ids.adminUser, ids.walletRaceUser]);
    } finally {
      cache?.onModuleDestroy();
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
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
      performedByUserId: ids.adminUser,
      allowNegativeBalance: true, // محفظة المنصة تمثيل محاسبي، مش رصيد حقيقي محدود
    });
    const balanceAfterOriginal = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;
    expect(balanceAfterOriginal).toBe(100000);

    const result = await service.adminAdjustWallet(
      ids.adminUser,
      ids.techUser,
      10000,
      'debit',
      'تصحيح: التحصيل الصح 900 مش 1000',
      `cash-correction-${runId}`,
    );

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
    const result = await service.adminAdjustWallet(
      ids.adminUser,
      ids.techUser,
      5000,
      'credit',
      'تعويض إداري',
      `admin-compensation-${runId}`,
    );
    expect(result.newBalanceCents - before).toBe(5000);
  });

  it('retry متزامن بنفس Idempotency-Key ينشئ adjustment وقيدًا مزدوجًا واحدًا فقط', async () => {
    const before = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;
    const key = `concurrent-adjustment-${runId}`;
    const [first, second] = await Promise.all([
      service.adminAdjustWallet(ids.adminUser, ids.techUser, 7000, 'credit', 'تعويض شبكي متكرر', key),
      service.adminAdjustWallet(ids.adminUser, ids.techUser, 7000, 'credit', 'تعويض شبكي متكرر', key),
    ]);

    expect(first.newBalanceCents).toBe(second.newBalanceCents);
    expect(first.newBalanceCents - before).toBe(7000);
    const adjustmentRows = await dataSource.getRepository(WalletAdjustment).find({
      where: { actorUserId: ids.adminUser, idempotencyKey: key },
    });
    expect(adjustmentRows).toHaveLength(1);
    const ledgerRows = await dataSource.getRepository(WalletTransaction).find({
      where: { referenceType: 'admin_adjustment', referenceId: adjustmentRows[0].id },
    });
    expect(ledgerRows).toHaveLength(2);
  });

  it('ينشئ محفظة واحدة فقط عند طلب إنشائها بالتزامن', async () => {
    const wallets = await Promise.all(
      Array.from({ length: 8 }, () =>
        walletsService.getOrCreateWallet(ids.walletRaceUser, WalletOwnerType.CUSTOMER),
      ),
    );

    expect(new Set(wallets.map((wallet) => wallet.id)).size).toBe(1);
    expect(await dataSource.getRepository(Wallet).count({ where: { ownerUserId: ids.walletRaceUser } })).toBe(1);
  });

  it('يرجع التصحيح كله عند فشل بعد القيد ثم يسمح بإعادة المحاولة مرة واحدة', async () => {
    const key = `adjustment-crash-retry-${runId}`;
    const beforeBalance = (await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents;
    const beforeLedgerCount = await dataSource.getRepository(WalletTransaction).count({
      where: { performedByUserId: ids.adminUser },
    });
    const originalDoubleEntry = walletsService.doubleEntry.bind(walletsService);
    const failure = jest
      .spyOn(walletsService, 'doubleEntry')
      .mockImplementationOnce(async (params, manager) => {
        await originalDoubleEntry(params, manager);
        throw new Error('failure after ledger effect');
      });

    try {
      await expect(
        service.adminAdjustWallet(
          ids.adminUser,
          ids.techUser,
          6100,
          'credit',
          'اختبار rollback ثم retry',
          key,
        ),
      ).rejects.toThrow('failure after ledger effect');
    } finally {
      failure.mockRestore();
    }

    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents).toBe(beforeBalance);
    expect(await dataSource.getRepository(WalletAdjustment).count({
      where: { actorUserId: ids.adminUser, idempotencyKey: key },
    })).toBe(0);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { performedByUserId: ids.adminUser },
    })).toBe(beforeLedgerCount);

    await service.adminAdjustWallet(
      ids.adminUser,
      ids.techUser,
      6100,
      'credit',
      'اختبار rollback ثم retry',
      key,
    );
    const adjustment = await dataSource.getRepository(WalletAdjustment).findOneByOrFail({
      actorUserId: ids.adminUser,
      idempotencyKey: key,
    });
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents - beforeBalance).toBe(6100);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'admin_adjustment', referenceId: adjustment.id },
    })).toBe(2);
  });

  it('يعكس القيد مرة واحدة عند التكرار والتزامن ويعيد نفس قيدي العكس بعد اكتماله', async () => {
    const referenceId = randomUUID();
    const platformWallet = await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    const technicianWallet = await walletsService.findByUserIdOrThrow(ids.techUser);
    const beforeBalance = technicianWallet.balanceCents;
    const original = await walletsService.doubleEntry({
      fromWalletId: platformWallet.id,
      toWalletId: technicianWallet.id,
      amountCents: 4321,
      transactionType: WalletTxType.BONUS,
      referenceType: 'wallet_reversal_integrity',
      referenceId,
      descriptionAr: 'قيد لاختبار عكس متزامن',
      performedByUserId: ids.adminUser,
      allowNegativeBalance: true,
    });
    await dataSource.query(`UPDATE wallets SET is_frozen = true, frozen_reason = 'reversal integrity test' WHERE id = $1`, [
      technicianWallet.id,
    ]);

    let concurrent: Awaited<ReturnType<WalletsService['reverseDoubleEntry']>>[];
    let alreadyReversed: Awaited<ReturnType<WalletsService['reverseDoubleEntry']>>;
    try {
      concurrent = await Promise.all([
        walletsService.reverseDoubleEntry(original, 'عكس متزامن', ids.adminUser),
        walletsService.reverseDoubleEntry(original, 'عكس متزامن', ids.adminUser),
      ]);
      alreadyReversed = await walletsService.reverseDoubleEntry(original, 'إعادة بعد الاكتمال', ids.adminUser);
    } finally {
      await dataSource.query(`UPDATE wallets SET is_frozen = false, frozen_reason = NULL WHERE id = $1`, [
        technicianWallet.id,
      ]);
    }

    expect(concurrent[0].debit.id).toBe(concurrent[1].debit.id);
    expect(concurrent[0].credit.id).toBe(concurrent[1].credit.id);
    expect(alreadyReversed.debit.id).toBe(concurrent[0].debit.id);
    expect(alreadyReversed.credit.id).toBe(concurrent[0].credit.id);
    expect((await walletsService.findByUserIdOrThrow(ids.techUser)).balanceCents).toBe(beforeBalance);
    expect(await dataSource.getRepository(WalletTransaction).count({
      where: { referenceType: 'wallet_reversal_integrity', referenceId },
    })).toBe(4);
    const reloaded = await dataSource.getRepository(WalletTransaction).findByIds([
      original.debit.id,
      original.credit.id,
    ]);
    expect(reloaded.every((entry) => entry.isReversed && entry.reversalTransactionId)).toBe(true);
  });
});
