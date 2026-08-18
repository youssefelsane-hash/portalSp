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
import { SettingsService } from '../settings/settings.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AuditLog } from '../audit/entities/audit-log.entity';

// اختبار حي ضد Postgres حقيقي — بَقّة حقيقية اتلقطت واتصلحت في docs/08 §20 بند 9:
// WalletsService.releaseReservation() (بتنادى من PayoutsService.adminReject()) كانت بتطرح
// amountCents من reserved_balance_cents من غير أي فحص إن المحجوز كافٍ — عكس finalizePayout()
// اللي عندها نفس الفحص بالظبط. لو adminReject() اتنادت مرتين على نفس الصرف (double-click/إعادة
// محاولة)، الفني كان بياخد المبلغ مرتين (فلوس بتتخلق من العدم). اختبارات المرحلة السادسة تحت
// تضيف سباقات Promise.all حقيقية بين كل انتقالات الأدمن وتثبت تطابق الحالة مع الرصيد المحجوز.
describe('Payout transitions — serialized state and reserved-wallet integrity', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let payoutsService: PayoutsService;
  let walletsService: WalletsService;
  let auditLog: AuditLogService;

  const runId = Date.now().toString(36);
  const ids = { techUser: '', techProfile: '', adminUser: '' };

  async function createReviewPayout(amountCents = 150000): Promise<Payout> {
    await walletsService.doubleEntry({
      fromWalletId: (await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID)).id,
      toWalletId: (await walletsService.findByUserIdOrThrow(ids.techUser)).id,
      amountCents,
      transactionType: WalletTxType.ORDER_EARNING,
      referenceType: 'payout_phase6_test',
      referenceId: ids.techProfile,
      descriptionAr: `أرباح محاكاة لاختبار انتقال الصرف ${runId}`,
      allowNegativeBalance: true,
    });
    return payoutsService.requestPayout(ids.techUser, {
      amount_cents: amountCents,
      payout_method: PayoutMethod.BANK_TRANSFER,
    });
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Payout, PayoutOrderItem, Wallet, WalletTransaction, User, TechnicianProfile, TechnicianCompany, AuditLog],
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

    const settingsService = {
      getNumber: async (key: string, fallback: number) => {
        if (key === 'payouts.min_amount_cents') return 20000;
        if (key === 'payouts.auto_approve_limit_cents') return 100000;
        return fallback;
      },
    } as unknown as SettingsService;
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never, // technicianServicesRepo
      {} as never, // servicesRepo
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
    );
    walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);

    await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);
    await walletsService.getOrCreateWallet(ids.techUser, WalletOwnerType.TECHNICIAN);
    auditLog = new AuditLogService(dataSource.getRepository(AuditLog));

    payoutsService = new PayoutsService(
      dataSource.getRepository(Payout),
      dataSource.getRepository(PayoutOrderItem),
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(User),
      dataSource,
      techniciansService,
      walletsService,
      auditLog,
      settingsService,
      { emit: () => undefined } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
      await q(
        `DELETE FROM audit_logs
         WHERE entity_type = 'payout'
           AND entity_id IN (SELECT id FROM payouts WHERE technician_id = $1)`,
        [ids.techProfile],
      );
      await q(
        `DELETE FROM wallet_transactions
         WHERE reference_type = 'payout_phase6_test'
            OR (reference_type = 'payout' AND reference_id IN (SELECT id FROM payouts WHERE technician_id = $1))`,
        [ids.techProfile],
      );
      await q(`DELETE FROM payout_order_items WHERE payout_id IN (SELECT id FROM payouts WHERE technician_id = $1)`, [ids.techProfile]);
      await q(`DELETE FROM payouts WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_user_id = $1)`, [ids.techUser]);
      await q(`DELETE FROM wallets WHERE owner_user_id = $1`, [ids.techUser]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id IN ($1, $2)`, [ids.techUser, ids.adminUser]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('نداء adminReject() مرتين على نفس الصرف — التاني بيترفض، صفر تكرار في إرجاع الفلوس', async () => {
    // أرباح حقيقية 500ج (فوق حد أقل صرف 200ج الافتراضي، وتحت حد الموافقة التلقائية 1000ج
    // الافتراضي — عشان الصرف يبقى UNDER_REVIEW ويحتاج adminReject/adminApprove صريح)
    // 1500ج — فوق حد أقل صرف 200ج الافتراضي **وفوق** حد الموافقة التلقائية 1000ج الافتراضي
    // (AUTO_APPROVE_LIMIT_CENTS_FALLBACK) — لازم الصرف يبقى UNDER_REVIEW عشان adminReject ينطبق.
    const payout = await createReviewPayout();
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

  it('approve×reject: الحالة النهائية تظل متسقة دائمًا مع الرصيد المحجوز', async () => {
    const payout = await createReviewPayout();
    const before = await walletsService.findByUserIdOrThrow(ids.techUser);
    const outcomes = await Promise.allSettled([
      payoutsService.adminApprove(ids.adminUser, payout.id),
      payoutsService.adminReject(ids.adminUser, payout.id, 'رفض متزامن مع الموافقة'),
    ]);
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);

    const persisted = await dataSource.getRepository(Payout).findOneByOrFail({ id: payout.id });
    const wallet = await walletsService.findByUserIdOrThrow(ids.techUser);
    if (persisted.payoutStatus === PayoutStatus.APPROVED) {
      expect(wallet.reservedBalanceCents).toBe(before.reservedBalanceCents);
      expect(wallet.balanceCents).toBe(before.balanceCents);
    } else {
      expect(persisted.payoutStatus).toBe(PayoutStatus.REJECTED);
      expect(wallet.reservedBalanceCents).toBe(before.reservedBalanceCents - payout.amountCents);
      expect(wallet.balanceCents).toBe(before.balanceCents + payout.amountCents);
    }
  });

  it('complete×complete: finalizePayout المحمي يخرج المبلغ مرة واحدة فقط', async () => {
    const payout = await createReviewPayout();
    await payoutsService.adminApprove(ids.adminUser, payout.id);
    const before = await walletsService.findByUserIdOrThrow(ids.techUser);

    const outcomes = await Promise.allSettled([
      payoutsService.adminComplete(ids.adminUser, payout.id),
      payoutsService.adminComplete(ids.adminUser, payout.id),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const persisted = await dataSource.getRepository(Payout).findOneByOrFail({ id: payout.id });
    expect(persisted.payoutStatus).toBe(PayoutStatus.COMPLETED);
    const wallet = await walletsService.findByUserIdOrThrow(ids.techUser);
    expect(wallet.reservedBalanceCents).toBe(before.reservedBalanceCents - payout.netAmountCents);
    expect(wallet.balanceCents).toBe(before.balanceCents);
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM wallet_transactions
       WHERE wallet_id = $1 AND reference_type = 'payout' AND reference_id = $2 AND direction = 'debit'`,
      [wallet.id, payout.id],
    );
    expect(count).toBe(1);
  });

  it('complete×reject: فائز طرفي واحد، إما خروج نهائي أو تحرير كامل بلا حالة هجينة', async () => {
    const payout = await createReviewPayout();
    await payoutsService.adminApprove(ids.adminUser, payout.id);
    const before = await walletsService.findByUserIdOrThrow(ids.techUser);

    const outcomes = await Promise.allSettled([
      payoutsService.adminComplete(ids.adminUser, payout.id),
      payoutsService.adminReject(ids.adminUser, payout.id, 'رفض متزامن مع الإكمال'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const persisted = await dataSource.getRepository(Payout).findOneByOrFail({ id: payout.id });
    const wallet = await walletsService.findByUserIdOrThrow(ids.techUser);
    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM wallet_transactions
       WHERE wallet_id = $1 AND reference_type = 'payout' AND reference_id = $2 AND direction = 'debit'`,
      [wallet.id, payout.id],
    );
    if (persisted.payoutStatus === PayoutStatus.COMPLETED) {
      expect(count).toBe(1);
      expect(wallet.balanceCents).toBe(before.balanceCents);
    } else {
      expect(persisted.payoutStatus).toBe(PayoutStatus.REJECTED);
      expect(count).toBe(0);
      expect(wallet.balanceCents).toBe(before.balanceCents + payout.amountCents);
    }
    expect(wallet.reservedBalanceCents).toBe(before.reservedBalanceCents - payout.amountCents);
  });

  it('rolls back payout rejection when audit persistence fails, then releases funds once on retry', async () => {
    const payout = await createReviewPayout(160000);
    const before = await walletsService.findByUserIdOrThrow(ids.techUser);
    const failure = jest.spyOn(auditLog, 'record').mockRejectedValueOnce(new Error('simulated payout audit failure'));

    try {
      await expect(
        payoutsService.adminReject(ids.adminUser, payout.id, 'اختبار فشل سجل التدقيق'),
      ).rejects.toThrow('simulated payout audit failure');
    } finally {
      failure.mockRestore();
    }

    expect((await dataSource.getRepository(Payout).findOneByOrFail({ id: payout.id })).payoutStatus).toBe(
      PayoutStatus.UNDER_REVIEW,
    );
    const rolledBackWallet = await walletsService.findByUserIdOrThrow(ids.techUser);
    expect(rolledBackWallet.balanceCents).toBe(before.balanceCents);
    expect(rolledBackWallet.reservedBalanceCents).toBe(before.reservedBalanceCents);
    expect(await dataSource.getRepository(AuditLog).count({ where: { entityId: payout.id } })).toBe(0);

    await payoutsService.adminReject(ids.adminUser, payout.id, 'اختبار فشل سجل التدقيق');
    const retriedWallet = await walletsService.findByUserIdOrThrow(ids.techUser);
    expect(retriedWallet.balanceCents).toBe(before.balanceCents + payout.amountCents);
    expect(retriedWallet.reservedBalanceCents).toBe(before.reservedBalanceCents - payout.amountCents);
    expect(await dataSource.getRepository(AuditLog).count({
      where: { action: 'payout.rejected', entityId: payout.id },
    })).toBe(1);
  });
});
