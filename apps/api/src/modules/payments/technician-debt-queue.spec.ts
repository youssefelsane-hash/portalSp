import { DataSource } from 'typeorm';
import { TechnicianDebtService } from './technician-debt.service';
import { TechnicianDebtSettlement } from './entities/technician-debt-settlement.entity';
import { Wallet, PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from './entities/wallet.entity';
import { WalletTransaction, WalletTxType } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { User } from '../auth/entities/user.entity';
import { deleteWalletTransactions } from './wallet-cleanup.testing';

/**
 * **طابور المديونية لازم يقول مين** (ADR-0041).
 *
 * `listTechniciansInDebt` كانت بترجّع معرّفات بس — طابور شغل بمعرّفات UUID مالوش أي قيمة:
 * موظف المالية محتاج اسم ورقم عشان يكلّم الراجل، فكان لازم يفتح كل فني على حدة، وهو نفس
 * اللي الطابور اتعمل عشان يلغيه.
 */
describe('قايمة الفنيين المديونين — بتقول مين (ADR-0041)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: TechnicianDebtService;
  const runId = Date.now().toString(36);
  const ids = { techUserId: '', techId: '', techWalletId: '' };
  const fullName = `فني طابور المديونية ${runId}`;
  const phone = `+2098${runId}`.slice(0, 15);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Wallet, WalletTransaction, TechnicianDebtSettlement, TechnicianProfile, User],
    });
    await dataSource.initialize();

    const walletsService = new WalletsService(
      dataSource.getRepository(Wallet),
      dataSource.getRepository(WalletTransaction),
      dataSource,
    );

    const [u] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [phone, fullName],
    );
    ids.techUserId = u.id;
    const [p] = await dataSource.query(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status)
       VALUES ($1,$2,'professional','approved') RETURNING id`,
      [u.id, `DQ${runId}`.slice(0, 20)],
    );
    ids.techId = p.id;

    const platformWallet = await walletsService.getOrCreateWallet(
      PLATFORM_SYSTEM_USER_ID,
      WalletOwnerType.PLATFORM,
    );
    const wallet = await walletsService.getOrCreateWallet(ids.techUserId, WalletOwnerType.TECHNICIAN);
    ids.techWalletId = wallet.id;
    // رصيد سالب = مديون. بيمشي على نفس مسار المحفظة الحقيقي (قيد مزدوج) مش UPDATE مباشر.
    await walletsService.doubleEntry({
      fromWalletId: ids.techWalletId,
      toWalletId: platformWallet.id,
      amountCents: 75_000,
      transactionType: WalletTxType.COMMISSION_DEDUCTION,
      referenceType: 'order',
      referenceId: ids.techId,
      descriptionAr: 'عمولة كاش',
      allowNegativeBalance: true,
    });

    service = new TechnicianDebtService(
      dataSource,
      walletsService,
      {
        findByProfileIdOrThrow: async (id: string) => {
          const [row] = await dataSource.query(
            `SELECT id, user_id AS "userId" FROM technician_profiles WHERE id = $1`,
            [id],
          );
          return row;
        },
      } as never,
      { getNumber: async (_k: string, fb: number) => fb } as never,
      { record: async () => undefined } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, p?: unknown[]) => dataSource.query(sql, p);
    await deleteWalletTransactions(q, `wallet_id = $1`, [ids.techWalletId]);
    await q(`DELETE FROM wallets WHERE id = $1`, [ids.techWalletId]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techId]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.techUserId]);
    await dataSource.destroy();
  });

  it('الفني المديون بيظهر في القايمة باسمه ورقمه ومبلغه', async () => {
    const list = await service.listTechniciansInDebt();
    const mine = list.find((row) => row.technicianId === ids.techId);

    expect(mine).toBeDefined();
    expect(mine!.fullName).toBe(fullName);
    expect(mine!.phoneNumber).toBe(phone);
    // الرصيد سالب في القاعدة، و`debtCents` بيتعرض كقيمة موجبة في الواجهة.
    expect(mine!.balanceCents).toBe(-75_000);
    expect(mine!.debtCents).toBeGreaterThan(0);
  });
});
