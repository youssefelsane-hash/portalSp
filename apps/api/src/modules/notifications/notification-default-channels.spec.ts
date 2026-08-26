import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLogService } from '../audit/audit-log.service';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { User } from '../auth/entities/user.entity';
import { Notification, NotificationChannel } from './entities/notification.entity';
import { NotificationTypeConfig } from './entities/notification-type-config.entity';
import { NotificationWorkflow } from './entities/notification-workflow.entity';
import { UserDevice } from './entities/user-device.entity';
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
import { NotificationsService } from './notifications.service';
import { NotificationWorkflowService } from './notification-workflow.service';

// docs/08 §69 — اختبار حي على Postgres حقيقي: `notification_type_configs.default_channels` كان
// عمود بيتعدّل من لوحة الإدارة و**مالوش أي أثر** على القنوات اللي بتترسل فعلاً. الاختبار ده
// بيثبّت إنه بقى هو مصدر القرار، وإن نوع بلا صف إعدادات لسه in_app بس زي الأول بالحرف.
describe('قنوات الإشعار بتتقرا من إعدادات النوع (docs/08 §69)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: NotificationsService;
  let cache: RedisCacheService;
  const dispatched: { channel: NotificationChannel; targets: string[] }[] = [];
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = { user: '' };
  const TYPE_PUSH = `spec_push_${runId}`.slice(0, 60);
  const TYPE_IN_APP_ONLY = `spec_inapp_${runId}`.slice(0, 60);
  const TYPE_NO_CONFIG = `spec_none_${runId}`.slice(0, 60);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Notification, NotificationWorkflow, NotificationTypeConfig, UserDevice, UserNotificationPreference, User, Setting],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2013${runId}`.slice(0, 15), `عميل قنوات ${runId}`],
    );
    ids.user = user.id;
    // جهاز بتوكن وهمي — الهدف إن قناة push يبقى ليها target فعلي، مش إرسال FCM حقيقي.
    await q(
      `INSERT INTO user_devices (user_id, device_id, fcm_token, platform, is_active)
       VALUES ($1,$2,$3,'android',true)`,
      [ids.user, `dev-${runId}`, `token-${runId}`],
    );
    await q(`INSERT INTO notification_type_configs (notification_type, default_channels) VALUES ($1, $2::jsonb)`, [
      TYPE_PUSH,
      JSON.stringify(['push', 'in_app']),
    ]);
    await q(`INSERT INTO notification_type_configs (notification_type, default_channels) VALUES ($1, $2::jsonb)`, [
      TYPE_IN_APP_ONLY,
      JSON.stringify(['in_app']),
    ]);

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
    const workflowService = new NotificationWorkflowService(
      dataSource.getRepository(NotificationWorkflow),
      dataSource.getRepository(NotificationTypeConfig),
      settingsService,
    );
    const dispatcher = {
      dispatch: (input: { channel: NotificationChannel; targets: string[] }) => {
        dispatched.push({ channel: input.channel, targets: input.targets });
        return Promise.resolve({ delivered: true, failureReason: null });
      },
    };
    service = new NotificationsService(
      dataSource.getRepository(Notification),
      dataSource.getRepository(UserDevice),
      dataSource.getRepository(User),
      dataSource.getRepository(UserNotificationPreference),
      dataSource.getRepository(NotificationTypeConfig),
      dispatcher as never,
      workflowService,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM notifications WHERE user_id = $1`, [ids.user]);
    await q(`DELETE FROM user_devices WHERE user_id = $1`, [ids.user]);
    await q(`DELETE FROM notification_type_configs WHERE notification_type = ANY($1)`, [[TYPE_PUSH, TYPE_IN_APP_ONLY]]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
    await dataSource.destroy();
    await cache.onModuleDestroy?.();
  });

  async function rowsFor(notificationType: string) {
    return dataSource.getRepository(Notification).find({ where: { userId: ids.user, notificationType } });
  }

  it('نوع مضبوط على ["push","in_app"] بيتبعت على القناتين', async () => {
    await service.notify({ userId: ids.user, notificationType: TYPE_PUSH, titleAr: 'عنوان', bodyAr: 'نص' });
    const rows = await rowsFor(TYPE_PUSH);
    expect(rows.map((r) => r.channel).sort()).toEqual(['in_app', 'push']);
    // القناة push لقت توكن الجهاز فعلاً — مش صف فاضي.
    const pushDispatch = dispatched.find((d) => d.channel === NotificationChannel.PUSH);
    expect(pushDispatch?.targets).toEqual([`token-${runId}`]);
  });

  it('القيمة الراجعة لسه صف in_app (النداءات القديمة اللي بتستخدمها ما اتكسرتش)', async () => {
    const returned = await service.notify({
      userId: ids.user,
      notificationType: TYPE_PUSH,
      titleAr: 'عنوان 2',
      bodyAr: 'نص 2',
    });
    expect(returned.channel).toBe(NotificationChannel.IN_APP);
  });

  it('نوع مضبوط على ["in_app"] بس ما بيبعتش push', async () => {
    await service.notify({ userId: ids.user, notificationType: TYPE_IN_APP_ONLY, titleAr: 'عنوان', bodyAr: 'نص' });
    const rows = await rowsFor(TYPE_IN_APP_ONLY);
    expect(rows.map((r) => r.channel)).toEqual(['in_app']);
  });

  it('نوع بلا صف إعدادات = in_app بس (نفس السلوك القديم، صفر مفاجآت)', async () => {
    await service.notify({ userId: ids.user, notificationType: TYPE_NO_CONFIG, titleAr: 'عنوان', bodyAr: 'نص' });
    const rows = await rowsFor(TYPE_NO_CONFIG);
    expect(rows.map((r) => r.channel)).toEqual(['in_app']);
  });

  it('قناة صريحة لسه بتتحترم زي ما هي (notifyMultiChannel وnotify بقناة)', async () => {
    const before = (await rowsFor(TYPE_IN_APP_ONLY)).length;
    await service.notify(
      { userId: ids.user, notificationType: TYPE_IN_APP_ONLY, titleAr: 'صريح', bodyAr: 'نص' },
      NotificationChannel.PUSH,
    );
    const rows = await rowsFor(TYPE_IN_APP_ONLY);
    expect(rows).toHaveLength(before + 1);
    // الإعدادات بتقول in_app بس، بس النداء الصريح طلب push — الصريح بيكسب.
    expect(rows.filter((r) => r.channel === NotificationChannel.PUSH)).toHaveLength(1);
  });
});
