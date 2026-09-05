import { DataSource } from 'typeorm';
import { Notification, NotificationChannel, NotificationDeliveryStatus } from './entities/notification.entity';

/**
 * تدقيق L-7 — الحالة `delivered` و`delivered_at` كانوا في المخطّط ومحدش بيكتبهم أبدًا.
 *
 * دورة الحياة الفعلية كانت `queued → sent → read` وخلاص، يعني `sent` بتعني «بوابة الإرسال قبلت»
 * مش «وصل». الفرق ده هو بالظبط اللي بيفرّق بين «الفني مشافش الإشعار» و«الإشعار ماوصلش أصلاً»
 * وقت أي بلاغ تشغيلي — ومكانش فيه أي طريقة تعرف مين الاتنين.
 *
 * الاختبارات هنا حيّة لأن اللي بيتقاس هو `UPDATE ... WHERE delivery_status = 'sent'` نفسه:
 * أحادية الانتقال شرط في SQL، مش فرع في TypeScript.
 */
describe('تأكيد استلام الإشعارات (تدقيق L-7) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36);
  let userId = '';
  let otherUserId = '';

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  /** `markDelivered` بالحرف زي `NotificationsService` — نفس شرط الانتقال الأحادي. */
  async function markDelivered(forUserId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await dataSource
      .createQueryBuilder()
      .update(Notification)
      .set({ deliveryStatus: NotificationDeliveryStatus.DELIVERED, deliveredAt: () => 'now()' })
      .where('user_id = :userId', { userId: forUserId })
      .andWhere('id IN (:...ids)', { ids })
      .andWhere('delivery_status = :sent', { sent: NotificationDeliveryStatus.SENT })
      .execute();
    return result.affected ?? 0;
  }

  async function seedNotification(
    ownerId: string,
    status: NotificationDeliveryStatus,
    channel = NotificationChannel.PUSH,
  ): Promise<string> {
    const [row] = await q<{ id: string }[]>(
      `INSERT INTO notifications (user_id, notification_type, channel, title_ar, body_ar, delivery_status)
       VALUES ($1, 'test_l7', $2, 'عنوان', 'نص', $3) RETURNING id`,
      [ownerId, channel, status],
    );
    return row.id;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Notification],
    });
    await dataSource.initialize();

    const mkUser = async (label: string): Promise<string> => {
      const [row] = await q<{ id: string }[]>(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
        [`+20L7${label}${runId}`.slice(0, 15), `عميل L7 ${label} ${runId}`],
      );
      return row.id;
    };
    userId = await mkUser('a');
    otherUserId = await mkUser('b');
  });

  afterAll(async () => {
    await q(`DELETE FROM notifications WHERE user_id = ANY($1)`, [[userId, otherUserId]]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [[userId, otherUserId]]);
    await dataSource.destroy();
  });

  it('إشعار `sent` بيتحوّل `delivered` ومعاه `delivered_at`', async () => {
    const id = await seedNotification(userId, NotificationDeliveryStatus.SENT);
    expect(await markDelivered(userId, [id])).toBe(1);

    const [row] = await q<{ delivery_status: string; delivered_at: Date | null }[]>(
      `SELECT delivery_status, delivered_at FROM notifications WHERE id = $1`,
      [id],
    );
    expect(row.delivery_status).toBe('delivered');
    expect(row.delivered_at).not.toBeNull();
  });

  it('`read` مابترجعش لورا — القراية أعلى من الاستلام', async () => {
    const id = await seedNotification(userId, NotificationDeliveryStatus.READ);
    expect(await markDelivered(userId, [id])).toBe(0);
    const [row] = await q<{ delivery_status: string }[]>(`SELECT delivery_status FROM notifications WHERE id = $1`, [
      id,
    ]);
    expect(row.delivery_status).toBe('read');
  });

  it('`failed` و`queued` مابيتحوّلوش — تأكيد استلام لحاجة مااتبعتتش تناقض', async () => {
    const failedId = await seedNotification(userId, NotificationDeliveryStatus.FAILED);
    const queuedId = await seedNotification(userId, NotificationDeliveryStatus.QUEUED);
    expect(await markDelivered(userId, [failedId, queuedId])).toBe(0);
  });

  it('تأكيد مكرر بيرجّع صفر من غير خطأ (idempotent — الجهاز ممكن يعيد بعد انقطاع شبكة)', async () => {
    const id = await seedNotification(userId, NotificationDeliveryStatus.SENT);
    expect(await markDelivered(userId, [id])).toBe(1);
    expect(await markDelivered(userId, [id])).toBe(0);
  });

  it('مينفعش حد يأكّد استلام إشعار حد تاني', async () => {
    const id = await seedNotification(otherUserId, NotificationDeliveryStatus.SENT);
    expect(await markDelivered(userId, [id])).toBe(0);
    const [row] = await q<{ delivery_status: string }[]>(`SELECT delivery_status FROM notifications WHERE id = $1`, [
      id,
    ]);
    expect(row.delivery_status).toBe('sent');
  });

  it('دفعة فيها المستحق وغير المستحق: بيتحوّل المستحق بس', async () => {
    const sentId = await seedNotification(userId, NotificationDeliveryStatus.SENT);
    const readId = await seedNotification(userId, NotificationDeliveryStatus.READ);
    const foreignId = await seedNotification(otherUserId, NotificationDeliveryStatus.SENT);
    expect(await markDelivered(userId, [sentId, readId, foreignId])).toBe(1);
  });
});
