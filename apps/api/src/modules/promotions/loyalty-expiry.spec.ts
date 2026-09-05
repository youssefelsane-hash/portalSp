import { DataSource } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { LoyaltyTransaction, LoyaltyDirection, LoyaltySource } from './entities/loyalty-transaction.entity';
import { LoyaltyExpiryService } from './loyalty-expiry.service';
import { LoyaltyService } from './loyalty.service';

/**
 * تدقيق L-6 — النقاط ماكانتش بتنتهي أبدًا رغم إن المخطّط معمول للانتهاء.
 *
 * الاختبارات هنا حيّة على Postgres حقيقي لأن جوهر الميزة SQL: نافذة تراكمية بترتيب FIFO فوق
 * `loyalty_transactions`. اختبار بـmocks كان هيثبت إن الدالة بتتنادى، مش إن الحساب صح.
 */
describe('انتهاء صلاحية نقاط الولاء (تدقيق L-6) — حي', () => {
  // اختبار حي على قاعدة مشتركة: أول اتصال + تنظيف صف `customer_profiles` (وراه FKs كتير)
  // بيعدّوا الـ5 ثواني الافتراضية أحيانًا. نفس القيمة المتّبعة في باقي السبيكات الحيّة.
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let loyalty: LoyaltyService;
  let expiry: LoyaltyExpiryService;

  const runId = Date.now().toString(36);
  const notified: { userId: string; body: string }[] = [];
  let userId = '';
  let profileId = '';
  let expiryMonths = 12;

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [CustomerProfile, LoyaltyTransaction],
    });
    await dataSource.initialize();

    const settings = {
      getNumber: async (_key: string, fallback: number) => (expiryMonths === -1 ? fallback : expiryMonths),
    } as unknown as SettingsService;
    const notifications = {
      notify: async (input: { userId: string; bodyAr: string }) => {
        notified.push({ userId: input.userId, body: input.bodyAr });
        return {} as never;
      },
    } as unknown as NotificationsService;

    loyalty = new LoyaltyService(
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(LoyaltyTransaction),
      dataSource,
      settings,
    );
    expiry = new LoyaltyExpiryService(dataSource, notifications);
  });

  beforeEach(async () => {
    notified.length = 0;
    expiryMonths = 12;
    const [user] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+20L6${Date.now().toString(36)}`.slice(0, 15), `عميل ولاء ${runId}`],
    );
    userId = user.id;
    const [profile] = await q<{ id: string }[]>(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [userId]);
    profileId = profile.id;
  });

  afterEach(async () => {
    await q(`DELETE FROM loyalty_transactions WHERE user_id = $1`, [userId]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [profileId]);
    await q(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  /** دفعة بتاريخ اكتساب/انتهاء محدّد — بنكتبها مباشرةً عشان نقدر نرجّع الزمن للورا. */
  async function seedLot(points: number, createdDaysAgo: number, expiresInDays: number): Promise<string> {
    const [row] = await q<{ id: string }[]>(
      `INSERT INTO loyalty_transactions (user_id, points_amount, direction, source, balance_after, created_at, expires_at)
       VALUES ($1, $2, 'earn', 'order', 0, now() - ($3 || ' days')::interval, now() + ($4 || ' days')::interval)
       RETURNING id`,
      [userId, points, String(createdDaysAgo), String(expiresInDays)],
    );
    await q(`UPDATE customer_profiles SET loyalty_points_balance = loyalty_points_balance + $1 WHERE id = $2`, [
      points,
      profileId,
    ]);
    return row.id;
  }

  const balance = async (): Promise<number> => {
    const [row] = await q<{ loyalty_points_balance: number }[]>(
      `SELECT loyalty_points_balance FROM customer_profiles WHERE id = $1`,
      [profileId],
    );
    return Number(row.loyalty_points_balance);
  };

  it('دفعة انتهت بالكامل ومحدش استهلك منها بتتشال من الرصيد وبيتكتب لها صف expire', async () => {
    await seedLot(100, 400, -1);
    expect(await balance()).toBe(100);

    expect(await expiry.expireForUser(userId)).toBe(100);

    expect(await balance()).toBe(0);
    const [row] = await q<{ direction: string; points_amount: number; balance_after: number }[]>(
      `SELECT direction, points_amount, balance_after FROM loyalty_transactions
       WHERE user_id = $1 AND direction = 'expire'`,
      [userId],
    );
    expect(row).toEqual({ direction: 'expire', points_amount: -100, balance_after: 0 });
  });

  it('FIFO: الاستبدال بياكل الأقدم الأول، فاللي بينتهي هو الباقي من الدفعة القديمة بس', async () => {
    await seedLot(100, 400, -1); // قديمة ومنتهية
    await seedLot(50, 10, 300); // جديدة ولسه سارية
    await loyalty.redeem(userId, 70, LoyaltySource.PROMOTION);
    expect(await balance()).toBe(80);

    // الاستبدال أكل 70 من الدفعة القديمة (100)، فباقي فيها 30 هي اللي تنتهي. الدفعة الجديدة
    // مالهاش أي علاقة — لسه سارية.
    expect(await expiry.expireForUser(userId)).toBe(30);
    expect(await balance()).toBe(50);
  });

  it('دفعة انتهت وكانت مستهلكة بالكامل مابتخصمش حاجة، ومابترجعش في دورة تانية', async () => {
    const lotId = await seedLot(40, 400, -1);
    await loyalty.redeem(userId, 40, LoyaltySource.PROMOTION);
    expect(await balance()).toBe(0);

    expect(await expiry.expireForUser(userId)).toBe(0);
    expect(await balance()).toBe(0);

    const [lot] = await q<{ expired_at: Date | null }[]>(`SELECT expired_at FROM loyalty_transactions WHERE id = $1`, [
      lotId,
    ]);
    expect(lot.expired_at).not.toBeNull();
    // الفحص التاني مايشوفش الصف ده خالص.
    expect(await expiry.expireForUser(userId)).toBe(0);
  });

  it('تشغيل الـsweep مرتين مابيخصمش مرتين (الحساب مايتكررش)', async () => {
    await seedLot(100, 400, -1);
    expect(await expiry.expireForUser(userId)).toBe(100);
    expect(await expiry.expireForUser(userId)).toBe(0);
    expect(await balance()).toBe(0);
    const [{ count }] = await q<{ count: string }[]>(
      `SELECT count(*) FROM loyalty_transactions WHERE user_id = $1 AND direction = 'expire'`,
      [userId],
    );
    expect(Number(count)).toBe(1);
  });

  it('دفعة لسه سارية مابتتلمسش', async () => {
    await seedLot(60, 5, 300);
    expect(await expiry.expireForUser(userId)).toBe(0);
    expect(await balance()).toBe(60);
  });

  it('العميل بياخد إشعار بالرقم اللي انتهى والرصيد الجديد', async () => {
    await seedLot(100, 400, -1);
    await seedLot(25, 5, 300);
    await expiry.expireForUser(userId);
    expect(notified).toHaveLength(1);
    expect(notified[0].userId).toBe(userId);
    expect(notified[0].body).toContain('100');
    expect(notified[0].body).toContain('25');
  });

  it('earn() بيحط تاريخ انتهاء من الإعداد تلقائيًا — القيمة الافتراضية 12 شهر', async () => {
    const tx = await loyalty.earn(userId, 10, LoyaltySource.ORDER);
    expect(tx.expiresAt).not.toBeNull();
    const months = (tx.expiresAt!.getUTCFullYear() - tx.createdAt.getUTCFullYear()) * 12 +
      (tx.expiresAt!.getUTCMonth() - tx.createdAt.getUTCMonth());
    expect(months).toBe(12);
    expect(tx.direction).toBe(LoyaltyDirection.EARN);
  });

  it('الإعداد = 0 معناه ماتنتهيش خالص', async () => {
    expiryMonths = 0;
    const tx = await loyalty.earn(userId, 10, LoyaltySource.ORDER);
    expect(tx.expiresAt).toBeNull();
  });

  it('`null` صريح لسه ممكن — دفعة ماتنتهيش بقرار مقصود مش سهو', async () => {
    const tx = await loyalty.earn(userId, 10, LoyaltySource.MANUAL, null, null);
    expect(tx.expiresAt).toBeNull();
  });

  it('الـsweep العام بيلاقي المستخدم المستحق ويخصم منه', async () => {
    await seedLot(15, 400, -1);
    const expired = await expiry.sweep();
    expect(expired).toBeGreaterThanOrEqual(15);
    expect(await balance()).toBe(0);
  });
});
