import { DataSource } from 'typeorm';
import { PLATFORM_SYSTEM_USER_ID, Wallet, WalletOwnerType } from './entities/wallet.entity';
import { WalletTransaction, WalletTxType } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';
import { User } from '../auth/entities/user.entity';
import { deleteWalletTransactions } from './wallet-cleanup.testing';

/**
 * الدالة اللي بتنضّف حركات المحافظ في السبيكات لازم **ترجّع الرصيد زي ما كان** — وده بالظبط
 * اللي التنظيف اليدوي كان بيفوّته، فينحرف رصيد محفظة المنصة المشتركة على كل تشغيلة.
 *
 * الاختبار ده بيقيس الطرفين: محفظة الفني (بتتمسح مع السبيك) **ومحفظة المنصة** (بتفضل موجودة
 * للأبد، وهي اللي كانت بتتراكم عليها المخالفات).
 */
describe('تنضيف حركات المحافظ — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let walletsService: WalletsService;
  const runId = Date.now().toString(36);
  const ids = { techUserId: '', techWalletId: '', platformWalletId: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  /** الرصيد الدفتري = `balance + reserved` — نفس اللي `balance_before/after_cents` بيسجّلوه. */
  async function ledger(walletId: string): Promise<number> {
    const [row] = await q(`SELECT balance_cents + reserved_balance_cents AS c FROM wallets WHERE id = $1`, [
      walletId,
    ]);
    return Number((row as { c: string }).c);
  }

  /** مجموع أثر الحركات الباقية — الطرف اللي الرصيد المفروض يطابقه. */
  async function ledgerFromTransactions(walletId: string): Promise<number> {
    const [row] = await q(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END), 0) AS c
         FROM wallet_transactions WHERE wallet_id = $1`,
      [walletId],
    );
    return Number((row as { c: string }).c);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Wallet, WalletTransaction, User],
    });
    await dataSource.initialize();

    walletsService = new WalletsService(
      dataSource.getRepository(Wallet),
      dataSource.getRepository(WalletTransaction),
      dataSource,
    );

    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1, $2, 'technician') RETURNING id`,
      [`+2098${runId}`.slice(0, 15), `فني تنضيف ${runId}`],
    );
    ids.techUserId = (user as { id: string }).id;

    const platformWallet = await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);
    ids.platformWalletId = platformWallet.id;
    const techWallet = await walletsService.getOrCreateWallet(ids.techUserId, WalletOwnerType.TECHNICIAN);
    ids.techWalletId = techWallet.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await deleteWalletTransactions(q, `wallet_id = $1`, [ids.techWalletId]);
    await q(`DELETE FROM wallets WHERE id = $1`, [ids.techWalletId]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.techUserId]);
    await dataSource.destroy();
  });

  it('بترجّع رصيد الطرفين — الفني **ومحفظة المنصة** — زي ما كانوا بالظبط', async () => {
    const techBefore = await ledger(ids.techWalletId);
    const platformBefore = await ledger(ids.platformWalletId);

    const reference = `cleanup-${runId}`;
    for (const amountCents of [12_345, 6_789, 50_000]) {
      await walletsService.doubleEntry({
        fromWalletId: ids.platformWalletId,
        toWalletId: ids.techWalletId,
        amountCents,
        transactionType: WalletTxType.ORDER_EARNING,
        referenceType: reference,
        referenceId: ids.techUserId,
        descriptionAr: 'حركة تدقيق تنضيف',
        allowNegativeBalance: true,
      });
    }

    // الأرصدة اتحركت فعلاً — من غير كده الاختبار بيعدّي على لا حاجة.
    expect(await ledger(ids.techWalletId)).toBe(techBefore + 69_134);
    expect(await ledger(ids.platformWalletId)).toBe(platformBefore - 69_134);

    const deleted = await deleteWalletTransactions(q, `reference_type = $1`, [reference]);
    expect(deleted).toBe(6); // قيد مزدوج × ٣ حركات

    expect(await ledger(ids.techWalletId)).toBe(techBefore);
    // **ده جوهر البَقّة**: محفظة المنصة مابتتمسحش أبدًا، فلو الرصيد ما رجعش هنا، الانحراف
    // بيتراكم على كل تشغيلة اختبارات للأبد.
    expect(await ledger(ids.platformWalletId)).toBe(platformBefore);
  });

  it('بتسيب حركات مش مطابقة للشرط وأرصدتها زي ما هي', async () => {
    const keptReference = `cleanup-kept-${runId}`;
    const dropReference = `cleanup-drop-${runId}`;

    await walletsService.doubleEntry({
      fromWalletId: ids.platformWalletId,
      toWalletId: ids.techWalletId,
      amountCents: 7_000,
      transactionType: WalletTxType.ORDER_EARNING,
      referenceType: keptReference,
      referenceId: ids.techUserId,
      descriptionAr: 'حركة لازم تفضل',
      allowNegativeBalance: true,
    });
    const afterKept = await ledger(ids.techWalletId);

    await walletsService.doubleEntry({
      fromWalletId: ids.platformWalletId,
      toWalletId: ids.techWalletId,
      amountCents: 3_000,
      transactionType: WalletTxType.ORDER_EARNING,
      referenceType: dropReference,
      referenceId: ids.techUserId,
      descriptionAr: 'حركة هتتمسح',
      allowNegativeBalance: true,
    });

    await deleteWalletTransactions(q, `reference_type = $1`, [dropReference]);

    expect(await ledger(ids.techWalletId)).toBe(afterKept);
    // الرصيد لازم يطابق مجموع الحركات الباقية — ده نفس الثابت اللي عدّاد المطابقة بيقيسه.
    expect(await ledger(ids.techWalletId) - (await ledgerFromTransactions(ids.techWalletId))).toBe(0);

    await deleteWalletTransactions(q, `reference_type = $1`, [keptReference]);
  });

  it('بتعيد حياكة السلسلة: مفيش فجوة بين حركة والتانية بعد الحذف', async () => {
    // حذف حركة من **نص** تاريخ محفظة بيكسر `balance_before = balance_after` بتاعت اللي
    // قبلها. ده الفحص التاني في عدّاد المطابقة، ولو فضل مكسور العدّاد يفضل صارخ على طول.
    const middleReference = `cleanup-middle-${runId}`;
    const keepReference = `cleanup-keep-chain-${runId}`;

    const write = async (amountCents: number, referenceType: string) =>
      walletsService.doubleEntry({
        fromWalletId: ids.platformWalletId,
        toWalletId: ids.techWalletId,
        amountCents,
        transactionType: WalletTxType.ORDER_EARNING,
        referenceType,
        referenceId: ids.techUserId,
        descriptionAr: 'حركة سلسلة',
        allowNegativeBalance: true,
      });

    await write(1_000, keepReference);
    await write(2_500, middleReference); // اللي هتتشال من النص
    await write(4_000, keepReference);

    await deleteWalletTransactions(q, `reference_type = $1`, [middleReference]);

    const gaps = (await q(
      `WITH ordered AS (
         SELECT balance_before_cents,
                LAG(balance_after_cents) OVER (PARTITION BY wallet_id ORDER BY created_at, id) AS previous_after
           FROM wallet_transactions WHERE wallet_id = ANY($1::uuid[])
       )
       SELECT COUNT(*)::int AS n FROM ordered
        WHERE previous_after IS NOT NULL AND balance_before_cents <> previous_after`,
      [[ids.techWalletId, ids.platformWalletId]],
    )) as { n: number }[];
    expect(gaps[0].n).toBe(0);

    // وآخر رصيد في السلسلة لازم يساوي رصيد المحفظة الفعلي — الاتنين مربوطين مش متصادفين.
    const [last] = (await q(
      `SELECT balance_after_cents FROM wallet_transactions
        WHERE wallet_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [ids.techWalletId],
    )) as { balance_after_cents: number }[];
    expect(Number(last.balance_after_cents)).toBe(await ledger(ids.techWalletId));

    await deleteWalletTransactions(q, `reference_type = $1`, [keepReference]);
  });

  it('شرط ما بيطابقش حاجة مابيغيّرش أي رصيد', async () => {
    const techBefore = await ledger(ids.techWalletId);
    const platformBefore = await ledger(ids.platformWalletId);

    const deleted = await deleteWalletTransactions(q, `reference_type = $1`, [`cleanup-none-${runId}`]);

    expect(deleted).toBe(0);
    expect(await ledger(ids.techWalletId)).toBe(techBefore);
    expect(await ledger(ids.platformWalletId)).toBe(platformBefore);
  });
});
