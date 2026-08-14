import { DataSource } from 'typeorm';
import { PayoutsService } from './payouts.service';
import { WalletsService } from './wallets.service';
import { Payout, PayoutMethod, PayoutStatus } from './entities/payout.entity';
import { PayoutOrderItem } from './entities/payout-order-item.entity';
import { Wallet, PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from './entities/wallet.entity';
import { WalletTransaction, WalletTxType } from './entities/wallet-transaction.entity';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLogService } from '../audit/audit-log.service';

// اختبار حي ضد Postgres حقيقي — بَقّة حقيقية اتلقطت واتصلحت في docs/08 §20 بند 9:
// WalletsService.releaseReservation() (بتنادى من PayoutsService.adminReject()) كانت بتطرح
// amountCents من reserved_balance_cents من غير أي فحص إن المحجوز كافٍ — عكس finalizePayout()
// اللي عندها نفس الفحص بالظبط. لو adminReject() اتنادت مرتين على نفس الصرف (double-click/إعادة
// محاولة)، الفني كان بياخد المبلغ مرتين (فلوس بتتخلق من العدم). بما إن lockWallet() بيسلسل أي
// نداءين متزامنين على قفل واحد، نداءين متتاليين (await) بينتجوا بالظبط نفس النتيجة اللي كانت
// هتحصل لو النداءين اتنافسوا حقيقي على القفل — مفيش داعي Promise.all لإثبات الثغرة.
describe('PayoutsService.adminReject() — منع تكرار إلغاء الحجز (docs/08 §20 بند 9)', () => {
  let dataSource: DataSource;
  let payoutsService: PayoutsService;
  let walletsService: WalletsService;

  const runId = Date.now().toString(36);
  const ids = { techUser: '', techProfile: '', adminUser: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Payout, PayoutOrderItem, Wallet, WalletTransaction, User, TechnicianProfile, TechnicianCompany, Setting],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [techUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2026${runId}`.slice(0, 15), `فني صرف ${runId}`],
    );
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCPYT${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;
    const [adminUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2027${runId}`.slice(0, 15), `أدمن صرف ${runId}`],
    );
    ids.adminUser = adminUser.id;

    const cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
    );
    walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);

    await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);
    await walletsService.getOrCreateWallet(ids.techUser, WalletOwnerType.TECHNICIAN);

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
      { emit: () => undefined } as never,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM payout_order_items WHERE payout_id IN (SELECT id FROM payouts WHERE technician_id = $1)`, [ids.techProfile]);
    await q(`DELETE FROM payouts WHERE technician_id = $1`, [ids.techProfile]);
    await q(`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_user_id = $1)`, [ids.techUser]);
    await q(`DELETE FROM wallets WHERE owner_user_id = $1`, [ids.techUser]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
    await q(`DELETE FROM users WHERE id IN ($1, $2)`, [ids.techUser, ids.adminUser]);
    await dataSource.destroy();
  });

  it('نداء adminReject() مرتين على نفس الصرف — التاني بيترفض، صفر تكرار في إرجاع الفلوس', async () => {
    // أرباح حقيقية 500ج (فوق حد أقل صرف 200ج الافتراضي، وتحت حد الموافقة التلقائية 1000ج
    // الافتراضي — عشان الصرف يبقى UNDER_REVIEW ويحتاج adminReject/adminApprove صريح)
    // 1500ج — فوق حد أقل صرف 200ج الافتراضي **وفوق** حد الموافقة التلقائية 1000ج الافتراضي
    // (AUTO_APPROVE_LIMIT_CENTS_FALLBACK) — لازم الصرف يبقى UNDER_REVIEW عشان adminReject ينطبق.
    await walletsService.doubleEntry({
      fromWalletId: (await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID)).id,
      toWalletId: (await walletsService.findByUserIdOrThrow(ids.techUser)).id,
      amountCents: 150000,
      transactionType: WalletTxType.ORDER_EARNING,
      referenceType: 'order',
      referenceId: ids.techProfile,
      descriptionAr: 'أرباح محاكاة لاختبار الصرف',
      allowNegativeBalance: true,
    });

    const payout = await payoutsService.requestPayout(ids.techUser, {
      amount_cents: 150000,
      payout_method: PayoutMethod.BANK_TRANSFER,
    });
    expect(payout.payoutStatus).toBe(PayoutStatus.UNDER_REVIEW);

    const walletAfterRequest = await walletsService.findByUserIdOrThrow(ids.techUser);
    expect(walletAfterRequest.balanceCents).toBe(0); // الكل اتحجز
    expect(walletAfterRequest.reservedBalanceCents).toBe(150000);

    // أول رفض — لازم ينجح ويرجّع المبلغ لـbalance_cents
    const firstReject = await payoutsService.adminReject(ids.adminUser, payout.id, 'رفض أول — بيانات ناقصة');
    expect(firstReject.payoutStatus).toBe(PayoutStatus.REJECTED);

    const walletAfterFirstReject = await walletsService.findByUserIdOrThrow(ids.techUser);
    expect(walletAfterFirstReject.balanceCents).toBe(150000); // رجع كامل
    expect(walletAfterFirstReject.reservedBalanceCents).toBe(0);

    // رفض تاني على نفس الصرف (المُرفوض بالفعل) — قبل الإصلاح كان بيرجّع 150000 تانية للرصيد
    // (فلوس مخترعة). دلوقتي لازم يترفض بوضوح — الـstate machine guard (payoutStatus === REJECTED)
    // بيمسك الحالة العادية، وفحص reservedBalanceCents الجديد في releaseReservation() بيمسك حتى لو
    // الحالتين قرأوا payoutStatus قديم قبل ما أي حد يلتزم (السباق الحقيقي).
    await expect(payoutsService.adminReject(ids.adminUser, payout.id, 'رفض تاني — محاولة مكررة')).rejects.toThrow();

    const walletAfterSecondAttempt = await walletsService.findByUserIdOrThrow(ids.techUser);
    // أهم سطر في الاختبار كله: الرصيد فضل زي ما هو بالظبط بعد أول رفض — صفر تكرار
    expect(walletAfterSecondAttempt.balanceCents).toBe(150000);
    expect(walletAfterSecondAttempt.reservedBalanceCents).toBe(0);
  });

  it('releaseReservation() مباشرة — نداء تاني على نفس القيمة بلا حجز كافٍ بيترفض بوضوح', async () => {
    const wallet = await walletsService.findByUserIdOrThrow(ids.techUser);
    // اختبار مستقل تمامًا عن الاختبار اللي فات: بيحجز مبلغ جديد بنفسه أولاً، يفكه مرة (تنجح)،
    // وبعدين يحاول يفكه تاني (المفروض يترفض لأن مفيش حجز كافٍ فاضل).
    await dataSource.transaction(async (manager) => {
      await walletsService.reserveForPayout(wallet.id, 20000, manager);
    });
    await dataSource.transaction(async (manager) => {
      await walletsService.releaseReservation(wallet.id, 20000, manager);
    });
    const afterFirstRelease = await walletsService.findByUserIdOrThrow(ids.techUser);
    expect(afterFirstRelease.reservedBalanceCents).toBe(0);

    await dataSource.transaction(async (manager) => {
      await expect(walletsService.releaseReservation(wallet.id, 20000, manager)).rejects.toThrow(
        'المبلغ المحجوز أقل من مبلغ الحجز المطلوب إلغاؤه',
      );
    });
  });
});
