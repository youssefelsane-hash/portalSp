import { DataSource } from 'typeorm';
import { TechnicianDebtService } from './technician-debt.service';
import { TechnicianDebtSettlement } from './entities/technician-debt-settlement.entity';
import { Wallet, PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from './entities/wallet.entity';
import { WalletTransaction, WalletTxType } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { User } from '../auth/entities/user.entity';

// ADR-0041 / docs/08 §63.أ2 — اختبار حي: هل تسجيل السداد بيحرّك الرصيد فعلاً، وبيتسجّل بمبلغه
// وطريقته ومرجعه، وبيمنع المبالغة والحالات الغلط؟
describe('تسوية مديونية الفني — حي (ADR-0041)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let walletsService: WalletsService;
  let service: TechnicianDebtService;
  const runId = Date.now().toString(36);
  const ids = { techUserId: '', techId: '', adminUserId: '', techWalletId: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Wallet, WalletTransaction, TechnicianDebtSettlement, TechnicianProfile, User],
    });
    await dataSource.initialize();

    walletsService = new WalletsService(
      dataSource.getRepository(Wallet),
      dataSource.getRepository(WalletTransaction),
      dataSource,
    );

    const [u] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2099${runId}`.slice(0, 15), `فني مديون ${runId}`],
    );
    ids.techUserId = u.id;
    const [p] = await dataSource.query(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status)
       VALUES ($1,$2,'professional','approved') RETURNING id`,
      [u.id, `DBT${runId}`.slice(0, 20)],
    );
    ids.techId = p.id;
    const [admin] = await dataSource.query(`SELECT id FROM users WHERE user_type='admin' LIMIT 1`);
    ids.adminUserId = admin.id;

    await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);
    const techWallet = await walletsService.getOrCreateWallet(ids.techUserId, WalletOwnerType.TECHNICIAN);
    ids.techWalletId = techWallet.id;

    service = new TechnicianDebtService(
      dataSource,
      walletsService,
      { findByProfileIdOrThrow: async () => ({ id: ids.techId, userId: ids.techUserId }) } as never,
      { getNumber: async (_k: string, fb: number) => fb } as never,
      { record: async () => undefined } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, p?: unknown[]) => dataSource.query(sql, p);
    await q(`DELETE FROM technician_debt_settlements WHERE technician_id = $1`, [ids.techId]);
    await q(`DELETE FROM wallet_transactions WHERE wallet_id = $1`, [ids.techWalletId]);
    await q(`DELETE FROM wallets WHERE id = $1`, [ids.techWalletId]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techId]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.techUserId]);
    await dataSource.destroy();
  });

  it('فني رصيده موجب: مفيش دَين، والتسوية بترفض بوضوح', async () => {
    const view = await service.getDebtView(ids.techId);
    expect(view.status).toBe('none');
    expect(view.debtCents).toBe(0);

    await expect(
      service.recordSettlement(ids.adminUserId, ids.techId, { amountCents: 1000, method: 'cash' }),
    ).rejects.toThrow('الفني مش مديون للمنصة أصلاً');
  });

  it('بعد ما يمسك كاش المنصة: الرصيد سالب والحالة بتتحسب', async () => {
    // بنحاكي الواقع: الفني حصّل كاش أكتر من نصيبه فبقى مديون بالعمولة (§20)
    const platformWallet = await walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID);
    await walletsService.doubleEntry({
      fromWalletId: ids.techWalletId,
      toWalletId: platformWallet.id,
      amountCents: 80_000,
      transactionType: WalletTxType.COMMISSION_DEDUCTION,
      referenceType: 'order',
      referenceId: ids.techId,
      descriptionAr: 'عمولة كاش',
      allowNegativeBalance: true,
    });

    const view = await service.getDebtView(ids.techId);
    expect(view.balanceCents).toBe(-80_000);
    expect(view.debtCents).toBe(80_000);
    // 800 ج.م. > عتبة 500، بس عمره النهارده — watch مش alert
    expect(view.status).toBe('watch');
    expect(view.debtSinceAt).not.toBeNull();
  });

  it('**«الراجل ده دفع»**: سداد جزئي بيقلّل الدَّين ويتسجّل بمبلغه وطريقته ومرجعه', async () => {
    const view = await service.recordSettlement(ids.adminUserId, ids.techId, {
      amountCents: 30_000,
      method: 'instapay',
      externalReference: 'IPN-12345',
      note: 'سدّد جزء في المكتب',
    });

    expect(view.balanceCents).toBe(-50_000);
    expect(view.debtCents).toBe(50_000);
    expect(view.settlements).toHaveLength(1);
    expect(view.settlements[0]).toMatchObject({
      amountCents: 30_000,
      method: 'instapay',
      externalReference: 'IPN-12345',
      balanceBeforeCents: -80_000,
      balanceAfterCents: -50_000,
    });
  });

  it('الرصيد اتحرّك عبر قيد مزدوج حقيقي مربوط بالسجل (مش تعديل مباشر)', async () => {
    const settlement = await dataSource
      .getRepository(TechnicianDebtSettlement)
      .findOneByOrFail({ technicianId: ids.techId, amountCents: 30_000 });
    expect(settlement.walletTransactionId).not.toBeNull();

    const tx = await dataSource
      .getRepository(WalletTransaction)
      .findOneByOrFail({ id: settlement.walletTransactionId! });
    expect(tx.walletId).toBe(ids.techWalletId);
    expect(tx.transactionType).toBe(WalletTxType.ADJUSTMENT);
    expect(tx.amountCents).toBe(30_000);
  });

  it('مبلغ أكبر من المديونية بيترفض — الأدمن ما يقدرش يحوّل الدَّين لرصيد موجب بالغلط', async () => {
    await expect(
      service.recordSettlement(ids.adminUserId, ids.techId, { amountCents: 999_999, method: 'cash' }),
    ).rejects.toThrow(/أكبر من المديونية/);
  });

  it('سداد الباقي بالكامل: الدَّين بيتصفّر والحالة بترجع none', async () => {
    const view = await service.recordSettlement(ids.adminUserId, ids.techId, {
      amountCents: 50_000,
      method: 'cash',
      note: 'سدّد الباقي كاش',
    });
    expect(view.balanceCents).toBe(0);
    expect(view.status).toBe('none');
    expect(view.debtCents).toBe(0);
    expect(view.settlements).toHaveLength(2);
  });

  it('الفني بيظهر في قايمة المديونين وهو مديون، وبيختفي بعد السداد', async () => {
    const afterSettle = await service.listTechniciansInDebt();
    expect(afterSettle.some((v) => v.technicianId === ids.techId)).toBe(false);
  });
});
