import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CustomerProfile } from '../../modules/customers/entities/customer-profile.entity';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { LoyaltyTransaction } from '../../modules/promotions/entities/loyalty-transaction.entity';
import { LoyaltyExpiryService } from '../../modules/promotions/loyalty-expiry.service';
import { runExclusiveSweep } from './sweep-lock';

/**
 * تدقيق T-3 — **مفيش أي اختبار بيشغّل نسختين في نفس الوقت**.
 *
 * `sweep-lock.spec.ts` بيثبت إن القفل نفسه شغّال (النسخة التانية بتتخطّى). الاختبار ده بيثبت
 * اللي بعده وهو اللي فعلاً مهم: إن **عملية أعمال حقيقية** بتديك نفس النتيجة لما نسختين
 * يشتغلوا على نفس الصفوف في نفس اللحظة. الفرق مش شكلي — القفل ممكن يكون شغّال والعملية برضه
 * تتكرر لو الغلاف اتحط في المكان الغلط.
 *
 * اخترنا انتهاء نقاط الولاء (تدقيق L-6) لأنه بيلمس **فلوس العميل**: تكرار الدورة معناه خصم
 * الرصيد مرتين. النسختين اتصالين مستقلين تمامًا بالقاعدة — نفس شكل نسختين من التطبيق بالظبط.
 */
describe('دورة مجدولة على نسختين متزامنتين (تدقيق T-3) — حي', () => {
  jest.setTimeout(30_000);

  const logger = new Logger('MultiInstanceSweepSpec');
  const runId = Date.now().toString(36);
  const url = process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak';

  let a: DataSource;
  let b: DataSource;
  let serviceA: LoyaltyExpiryService;
  let serviceB: LoyaltyExpiryService;
  let userId = '';
  let profileId = '';

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => a.query(sql, params) as Promise<T>;

  const notifications = {
    notify: async () => ({}) as never,
  } as unknown as NotificationsService;

  beforeAll(async () => {
    const options = { type: 'postgres' as const, url, entities: [CustomerProfile, LoyaltyTransaction] };
    a = await new DataSource(options).initialize();
    b = await new DataSource(options).initialize();
    serviceA = new LoyaltyExpiryService(a, notifications);
    serviceB = new LoyaltyExpiryService(b, notifications);
  });

  afterAll(async () => {
    await a.destroy();
    await b.destroy();
  });

  beforeEach(async () => {
    const [user] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+20T3${Date.now().toString(36)}`.slice(0, 15), `عميل T3 ${runId}`],
    );
    userId = user.id;
    const [profile] = await q<{ id: string }[]>(
      `INSERT INTO customer_profiles (user_id, loyalty_points_balance) VALUES ($1, 100) RETURNING id`,
      [userId],
    );
    profileId = profile.id;
    await q(
      `INSERT INTO loyalty_transactions (user_id, points_amount, direction, source, balance_after, created_at, expires_at)
       VALUES ($1, 100, 'earn', 'order', 100, now() - interval '400 days', now() - interval '1 day')`,
      [userId],
    );
  });

  afterEach(async () => {
    await q(`DELETE FROM loyalty_transactions WHERE user_id = $1`, [userId]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [profileId]);
    await q(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  const balance = async (): Promise<number> => {
    const [row] = await q<{ loyalty_points_balance: number }[]>(
      `SELECT loyalty_points_balance FROM customer_profiles WHERE id = $1`,
      [profileId],
    );
    return Number(row.loyalty_points_balance);
  };

  const expireRows = async (): Promise<number> => {
    const [row] = await q<{ count: string }[]>(
      `SELECT count(*) FROM loyalty_transactions WHERE user_id = $1 AND direction = 'expire'`,
      [userId],
    );
    return Number(row.count);
  };

  it('نسختين بتشغّلوا نفس الدورة في نفس اللحظة: الخصم بيحصل مرة واحدة بالظبط', async () => {
    const lock = `loyalty-expiry-t3-${runId}`;
    const [resultA, resultB] = await Promise.all([
      runExclusiveSweep(a, lock, () => serviceA.sweep(), logger),
      runExclusiveSweep(b, lock, () => serviceB.sweep(), logger),
    ]);

    // واحدة اشتغلت والتانية اتخطّت — مش الاتنين.
    const ran = [resultA, resultB].filter((r) => r !== null);
    expect(ran).toHaveLength(1);

    expect(await balance()).toBe(0);
    expect(await expireRows()).toBe(1);
  });

  it('حتى من غير قفل، الحساب نفسه مابيخصمش مرتين — القفل تحسين مش الحارس الوحيد', async () => {
    // شبكة أمان مقصودة: القفل بيمنع الشغل المكرر، بس `expired_at` + إعادة حساب المستهلك
    // بيخلّوا الدورة idempotent أصلاً. لو القفل اتشال بالغلط يوم ما، الفلوس تفضل صح.
    await Promise.all([serviceA.expireForUser(userId), serviceB.expireForUser(userId)]);

    expect(await balance()).toBe(0);
    expect(await expireRows()).toBeLessThanOrEqual(1);
  });

  it('دورتين على مستخدمين مختلفين مابيعطّلوش بعض (القفل مش قفل عام على الجدول)', async () => {
    const [otherUser] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+20T3x${Date.now().toString(36)}`.slice(0, 15), `عميل T3 تاني ${runId}`],
    );
    const [otherProfile] = await q<{ id: string }[]>(
      `INSERT INTO customer_profiles (user_id, loyalty_points_balance) VALUES ($1, 50) RETURNING id`,
      [otherUser.id],
    );
    await q(
      `INSERT INTO loyalty_transactions (user_id, points_amount, direction, source, balance_after, created_at, expires_at)
       VALUES ($1, 50, 'earn', 'order', 50, now() - interval '400 days', now() - interval '1 day')`,
      [otherUser.id],
    );

    try {
      const [first, second] = await Promise.all([
        serviceA.expireForUser(userId),
        serviceB.expireForUser(otherUser.id),
      ]);
      expect(first).toBe(100);
      expect(second).toBe(50);
    } finally {
      await q(`DELETE FROM loyalty_transactions WHERE user_id = $1`, [otherUser.id]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [otherProfile.id]);
      await q(`DELETE FROM users WHERE id = $1`, [otherUser.id]);
    }
  });
});
