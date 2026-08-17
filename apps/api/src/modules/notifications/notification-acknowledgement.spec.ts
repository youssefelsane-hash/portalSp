import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLogService } from '../audit/audit-log.service';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { User } from '../auth/entities/user.entity';
import { Notification, NotificationChannel } from './entities/notification.entity';
import { NotificationTypeConfig, NotificationPriorityTier } from './entities/notification-type-config.entity';
import { NotificationWorkflow } from './entities/notification-workflow.entity';
import { UserDevice } from './entities/user-device.entity';
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
import { NotificationsService } from './notifications.service';
import { NotificationWorkflowReminderService } from './notification-workflow-reminder.service';
import { NotificationWorkflowService } from './notification-workflow.service';

// Script 2 Part E — findings #26 (markAllRead كانت مش بتعتمد الـworkflows المرتبطة، فنظام
// التذكيرات كان يفضل يبعت للمستخدم بعد ما قرا كل حاجة) و#27 (reminderCount كان بيتاستهلك حتى
// لو notify() نفسها فشلت بالخطأ، مش بس "فشل تسليم" عادي).
describe('Notification acknowledgement integrity (PostgreSQL) — Script 2 Part E', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let settingsService: SettingsService;
  let workflowService: NotificationWorkflowService;
  let originalQuietHoursStart: string | null = null;
  let originalQuietHoursEnd: string | null = null;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { user: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Notification, NotificationWorkflow, NotificationTypeConfig, UserDevice, UserNotificationPreference, User, Setting],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1, $2, 'customer') RETURNING id`,
      [`+2012${runId}`.slice(0, 15), `Notif ack ${runId}`],
    );
    ids.user = user.id;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
    workflowService = new NotificationWorkflowService(
      dataSource.getRepository(NotificationWorkflow),
      dataSource.getRepository(NotificationTypeConfig),
      settingsService,
    );

    // ساعات الهدوء الافتراضية (22:00-08:00 UTC) ممكن تغطي وقت تشغيل الاختبار فعليًا وتخلّي
    // processOne يأجّل التذكير بدل ما يبعته — start=end معناها "معطّلة" (quiet-hours.util.ts).
    // بنعدّل الصفوف الموجودة فعلاً مباشرة ونبطل الكاش يدويًا (بدل SettingsService.update() اللي
    // بينادي AuditLogService حقيقي)، ونرجّعهم زي ما كانوا في afterAll.
    await q(`SELECT value FROM settings WHERE key = 'notification_engine.quiet_hours_start'`).then(
      ([row]) => (originalQuietHoursStart = row?.value ?? null),
    );
    await q(`SELECT value FROM settings WHERE key = 'notification_engine.quiet_hours_end'`).then(
      ([row]) => (originalQuietHoursEnd = row?.value ?? null),
    );
    await q(`UPDATE settings SET value = '"00:00"' WHERE key = 'notification_engine.quiet_hours_start'`);
    await q(`UPDATE settings SET value = '"00:00"' WHERE key = 'notification_engine.quiet_hours_end'`);
    await cache.del('settings:notification_engine.quiet_hours_start');
    await cache.del('settings:notification_engine.quiet_hours_end');
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      if (originalQuietHoursStart !== null) {
        await q(`UPDATE settings SET value = $1 WHERE key = 'notification_engine.quiet_hours_start'`, [
          JSON.stringify(originalQuietHoursStart),
        ]);
      }
      if (originalQuietHoursEnd !== null) {
        await q(`UPDATE settings SET value = $1 WHERE key = 'notification_engine.quiet_hours_end'`, [
          JSON.stringify(originalQuietHoursEnd),
        ]);
      }
      await cache.del('settings:notification_engine.quiet_hours_start');
      await cache.del('settings:notification_engine.quiet_hours_end');
      if (ids.user) await q(`DELETE FROM notifications WHERE user_id = $1`, [ids.user]);
      if (ids.user) await q(`DELETE FROM notification_workflows WHERE user_id = $1`, [ids.user]);
      if (ids.user) await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
    } finally {
      await dataSource.destroy();
      await cache.onModuleDestroy?.();
    }
  });

  function notificationsService(dispatcher: { dispatch: (...args: unknown[]) => unknown }): NotificationsService {
    return new NotificationsService(
      dataSource.getRepository(Notification),
      dataSource.getRepository(UserDevice),
      dataSource.getRepository(User),
      dataSource.getRepository(UserNotificationPreference),
      dataSource.getRepository(NotificationTypeConfig),
      dispatcher as never,
      workflowService,
    );
  }

  describe('finding #26 — markAllRead لازم يعتمد الـworkflows المرتبطة، مش بس read_at', () => {
    it('يوقف تذكيرات action_required المرتبطة بإشعارات اتقرت عبر "قرا الكل"', async () => {
      const svc = notificationsService({ dispatch: async () => ({ delivered: true, failureReason: null }) });
      const workflow = await workflowService.create({
        userId: ids.user,
        notificationType: `ack-test-${runId}`,
        titleAr: 'اختبار',
        bodyAr: 'اختبار',
      });
      await svc.notify(
        { userId: ids.user, notificationType: `ack-test-${runId}`, titleAr: 'اختبار', bodyAr: 'اختبار', workflowId: workflow.id },
        NotificationChannel.IN_APP,
      );

      const beforeCount = await svc.markAllRead(ids.user);
      expect(beforeCount).toBeGreaterThanOrEqual(1);

      const [row] = await dataSource.query(`SELECT acknowledged_at FROM notification_workflows WHERE id = $1`, [workflow.id]);
      expect(row.acknowledged_at).not.toBeNull();
    });

    it('مايلمسش workflows تانية غير مرتبطة بإشعارات المستخدم ده', async () => {
      const otherWorkflow = await workflowService.create({
        userId: ids.user,
        notificationType: `ack-untouched-${runId}`,
        titleAr: 'اختبار',
        bodyAr: 'اختبار',
      });
      // مفيش notification مرتبط بيه خالص — markAllRead متلمسوش لأن مفيش صف notifications يربطه.
      const svc = notificationsService({ dispatch: async () => ({ delivered: true, failureReason: null }) });
      await svc.markAllRead(ids.user);

      const [row] = await dataSource.query(`SELECT acknowledged_at FROM notification_workflows WHERE id = $1`, [otherWorkflow.id]);
      expect(row.acknowledged_at).toBeNull();
    });
  });

  describe('finding #27 — فشل notify() الفعلي مايستهلكش من حصة التذكيرات', () => {
    it('لو notify() رمت استثناء، الـreminderCount بيرجع زي ما كان وnextReminderAt يتقرّب مش يتأجّل لدورة كاملة', async () => {
      const workflow = await workflowService.create({
        userId: ids.user,
        notificationType: `reminder-fail-${runId}`,
        titleAr: 'تذكير اختبار',
        bodyAr: 'تذكير اختبار',
      });
      await dataSource.query(`UPDATE notification_workflows SET next_reminder_at = now() - interval '1 minute' WHERE id = $1`, [
        workflow.id,
      ]);
      const originalNextReminderAt: Date = (
        await dataSource.query(`SELECT next_reminder_at FROM notification_workflows WHERE id = $1`, [workflow.id])
      )[0].next_reminder_at;

      const failingNotifications = { notify: async () => { throw new Error('DB عابر أثناء إنشاء صف الإشعار'); } };
      const reminderService = new NotificationWorkflowReminderService(
        dataSource.getRepository(NotificationWorkflow),
        dataSource.getRepository(NotificationTypeConfig),
        dataSource,
        settingsService,
        failingNotifications as never,
      );

      const sent = await (reminderService as unknown as { processOne(id: string): Promise<boolean> }).processOne(workflow.id);
      expect(sent).toBe(false);

      const [row] = await dataSource.query(
        `SELECT reminder_count, next_reminder_at, resolved_at FROM notification_workflows WHERE id = $1`,
        [workflow.id],
      );
      // اتحسب 0→1 جوّه الترانزاكشن (claim)، وبعد فشل notify() اترجع لـ0 — الحصة ما اتهدرتش.
      expect(row.reminder_count).toBe(0);
      // معاد جدولته قريب (دقايق)، مش لدورة كاملة تانية ولا اتلغى.
      expect(new Date(row.next_reminder_at).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(row.next_reminder_at).getTime()).toBeLessThan(Date.now() + 5 * 60_000);
      expect(new Date(row.next_reminder_at).getTime()).not.toBe(originalNextReminderAt.getTime());
      expect(row.resolved_at).toBeNull();
    });

    it('لو notify() نجحت، الـreminderCount بيفضل متزايد عادي (مفيش تراجع لمحاولة ناجحة)', async () => {
      const workflow = await workflowService.create({
        userId: ids.user,
        notificationType: `reminder-success-${runId}`,
        titleAr: 'تذكير اختبار',
        bodyAr: 'تذكير اختبار',
      });
      await dataSource.query(`UPDATE notification_workflows SET next_reminder_at = now() - interval '1 minute' WHERE id = $1`, [
        workflow.id,
      ]);

      const succeedingNotifications = { notify: async () => ({}) };
      const reminderService = new NotificationWorkflowReminderService(
        dataSource.getRepository(NotificationWorkflow),
        dataSource.getRepository(NotificationTypeConfig),
        dataSource,
        settingsService,
        succeedingNotifications as never,
      );

      const sent = await (reminderService as unknown as { processOne(id: string): Promise<boolean> }).processOne(workflow.id);
      expect(sent).toBe(true);

      const [row] = await dataSource.query(`SELECT reminder_count FROM notification_workflows WHERE id = $1`, [workflow.id]);
      expect(row.reminder_count).toBe(1);
    });
  });
});
