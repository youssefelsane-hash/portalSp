import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { PaymentInstaPayTransferReportedEvent } from '../../common/events/payment-instapay-transfer-reported.event';
import { RecurringOrderAwaitingPaymentEvent } from '../../common/events/recurring-order-awaiting-payment.event';
import { OrderStatus } from '../orders/entities/order.entity';
import { NotificationTypeConfig } from './entities/notification-type-config.entity';
import { NotificationWorkflow } from './entities/notification-workflow.entity';
import { RecurringOrderAwaitingPaymentNotificationListener } from './listeners/recurring-order-awaiting-payment-notification.listener';
import { NotificationWorkflowReminderService } from './notification-workflow-reminder.service';
import { NotificationWorkflowService } from './notification-workflow.service';
import { computeScheduledJobCheckpoints } from './scheduled-job-checkpoints.util';

/**
 * **دورة تذكير دفع النوبة المتكررة على المحرك الحقيقي** (docs/08 §189 D-1، ADR-0116) — Postgres حقيقي،
 * `NotificationWorkflowService` + `NotificationWorkflowReminderService` الحقيقيين، والإرسال نفسه
 * stub بيسجّل. المطلوب بالحرف: إشعار فوري ⇒ تذكير بعد مدة ⇒ تذكير أخير قبل الميعاد ⇒ يقف بالدفع/التبليغ.
 *
 * الإعدادات stub (مش تعديل صفوف `settings` المشتركة): ساعات الهدوء مقفولة عشان النتيجة ماتعتمدش على
 * ساعة تشغيل الاختبار، والباقي بقيم السجل الافتراضية.
 */
describe('تذكيرات دفع النوبة المتكررة (ADR-0116)', () => {
  let dataSource: DataSource;
  let workflowService: NotificationWorkflowService;
  let reminderService: NotificationWorkflowReminderService;
  let listener: RecurringOrderAwaitingPaymentNotificationListener;
  const sent: Array<{ userId: string; notificationType: string; bodyAr: string; workflowId?: string }> = [];
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { user: '', profile: randomUUID() };

  const settings = {
    getNumber: async (_key: string, fallback: number) => fallback,
    getJson: async <T>(_key: string, fallback: T) => fallback,
    getString: async (key: string, fallback: string) => (key.includes('quiet_hours') ? '00:00' : fallback),
  };

  // افتراضيات السجل لـnotification_engine.scheduled_job_* (الـstub بيرجّعها زي ما هي).
  const SCHEDULED_JOB_DEFAULTS = { afterMinutes: 60, dayBeforeHourUtc: 8, preAppointmentMinutes: 120 };
  const mine = () => sent.filter((n) => n.userId === ids.user);
  const workflowFor = async (orderId: string) =>
    (await dataSource.getRepository(NotificationWorkflow).findOne({ where: { entityId: orderId } }))!;
  const makeDue = (orderId: string) =>
    dataSource.query(`UPDATE notification_workflows SET next_reminder_at = now() - interval '1 second' WHERE entity_id = $1`, [orderId]);

  async function generated(orderId: string, deadline: Date) {
    await listener.handleRecurringOrderAwaitingPayment(
      new RecurringOrderAwaitingPaymentEvent(orderId, `RPR-${runId}`, ids.profile, deadline, new Date(deadline.getTime() + 48 * 3600_000)),
    );
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [NotificationWorkflow, NotificationTypeConfig],
    });
    await dataSource.initialize();
    const [user] = await dataSource.query(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1, $2, 'customer') RETURNING id`,
      [`+2015${runId}`.slice(0, 15), `تذكير نوبة ${runId}`],
    );
    ids.user = user.id;

    workflowService = new NotificationWorkflowService(
      dataSource.getRepository(NotificationWorkflow),
      dataSource.getRepository(NotificationTypeConfig),
      settings as never,
    );
    const notifications = {
      notify: async (input: { userId: string; notificationType: string; bodyAr: string; workflowId?: string }) => {
        sent.push(input);
        return {};
      },
    };
    reminderService = new NotificationWorkflowReminderService(
      dataSource.getRepository(NotificationWorkflow),
      dataSource.getRepository(NotificationTypeConfig),
      dataSource,
      settings as never,
      notifications as never,
    );
    listener = new RecurringOrderAwaitingPaymentNotificationListener(
      { findByProfileIdOrThrow: async () => ({ userId: ids.user }) } as never,
      notifications as never,
      workflowService,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query(`DELETE FROM notification_workflows WHERE user_id = $1`, [ids.user]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [ids.user]);
    await dataSource.destroy();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it('التوليد ⇒ إشعار فوري فيه آخر ميعاد، مربوط بـworkflow على الميعاد نفسه', async () => {
    const orderId = randomUUID();
    const deadline = new Date(Date.now() + 24 * 3600_000);
    await generated(orderId, deadline);

    expect(mine()).toHaveLength(1);
    expect(mine()[0].notificationType).toBe('recurring_order_awaiting_payment');
    expect(mine()[0].bodyAr).toContain('ادفع قبل');
    expect(mine()[0].bodyAr).toContain('النوبة دي بس');

    const workflow = await workflowFor(orderId);
    expect(mine()[0].workflowId).toBe(workflow.id);
    expect(workflow.notificationType).toBe('recurring_order_payment_reminder');
    expect(workflow.actionType).toBe('pay_recurring_occurrence');
    expect(workflow.targetAt?.getTime()).toBe(deadline.getTime());
    expect(workflow.expiresAt?.getTime()).toBe(deadline.getTime());
    // أول تذكير = أول نقطة في حساب المحرك (بعد ساعة، إلا لو «صبح اليوم اللي قبله» جه قبلها)
    const [first] = computeScheduledJobCheckpoints(workflow.createdAt, deadline, SCHEDULED_JOB_DEFAULTS);
    // create() بيحسبها من ساعة السيرفر، و`created_at` من ساعة Postgres — فرق مللي ثواني مش أكتر.
    expect(Math.abs(workflow.nextReminderAt!.getTime() - first.getTime())).toBeLessThan(5_000);
    expect(first.getTime() - workflow.createdAt.getTime()).toBeLessThanOrEqual(60 * 60_000);
  });

  it('تذكير بعد مدة ⇒ … ⇒ تذكير أخير قبل الميعاد بساعتين ⇒ مفيش بعدها', async () => {
    const orderId = randomUUID();
    const deadline = new Date(Date.now() + 24 * 3600_000);
    await generated(orderId, deadline);
    sent.length = 0;

    // نفس حساب المحرك بالظبط — عدد النقط بيتغيّر حسب ساعة التشغيل («صبح اليوم اللي قبله» ممكن
    // يقع جوّه النطاق أو لأ)، فالاختبار بيمشي عليها كلها بدل رقم ثابت.
    const created = (await workflowFor(orderId)).createdAt;
    const checkpoints = computeScheduledJobCheckpoints(created, deadline, SCHEDULED_JOB_DEFAULTS);
    expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(checkpoints[checkpoints.length - 1].getTime()).toBe(deadline.getTime() - 120 * 60_000);

    for (let i = 0; i < checkpoints.length; i++) {
      await makeDue(orderId);
      await reminderService.sweep();
      expect(mine()).toHaveLength(i + 1);
      expect(mine()[i].notificationType).toBe('recurring_order_payment_reminder');
      const next = (await workflowFor(orderId)).nextReminderAt;
      expect(next?.getTime() ?? null).toBe(checkpoints[i + 1]?.getTime() ?? null);
    }
  });

  it('فتح الإشعار مش دفع ⇒ التذكيرات بتكمّل بعد القراءة', async () => {
    const orderId = randomUUID();
    await generated(orderId, new Date(Date.now() + 24 * 3600_000));
    await workflowService.acknowledgeById((await workflowFor(orderId)).id);
    sent.length = 0;

    await makeDue(orderId);
    await reminderService.sweep();
    expect(mine()).toHaveLength(1);
  });

  it('الدفع (خروج من pending_payment) ⇒ التذكيرات بتقف', async () => {
    const orderId = randomUUID();
    await generated(orderId, new Date(Date.now() + 24 * 3600_000));
    await listener.resolveWhenNoLongerAwaitingPayment(
      new OrderStatusChangedEvent(orderId, `RPR-${runId}`, OrderStatus.PENDING_PAYMENT, OrderStatus.SEARCHING_TECHNICIAN, ids.profile, null),
    );
    sent.length = 0;

    const workflow = await workflowFor(orderId);
    expect(workflow.resolvedAt).not.toBeNull();
    await makeDue(orderId);
    await reminderService.sweep();
    expect(mine()).toHaveLength(0);
  });

  it('العميل بلّغ تحويل InstaPay ⇒ مفيش «ادفع» تاني', async () => {
    const orderId = randomUUID();
    await generated(orderId, new Date(Date.now() + 24 * 3600_000));
    await listener.resolveWhenTransferReported(new PaymentInstaPayTransferReportedEvent(randomUUID(), orderId, `RPR-${runId}`, 30000));
    expect((await workflowFor(orderId)).resolvedAt).not.toBeNull();
  });

  it('تغيير حالة مالوش علاقة بالدفع ⇒ مابيقفلش التذكيرات', async () => {
    const orderId = randomUUID();
    await generated(orderId, new Date(Date.now() + 24 * 3600_000));
    await listener.resolveWhenNoLongerAwaitingPayment(
      new OrderStatusChangedEvent(orderId, `RPR-${runId}`, OrderStatus.ACCEPTED, OrderStatus.TECHNICIAN_ON_WAY, ids.profile, null),
    );
    expect((await workflowFor(orderId)).resolvedAt).toBeNull();
  });

  it('نوبة قديمة بلا ميعاد ⇒ الإشعار القديم بالظبط ومن غير workflow', async () => {
    const orderId = randomUUID();
    await listener.handleRecurringOrderAwaitingPayment(new RecurringOrderAwaitingPaymentEvent(orderId, `RPR-${runId}`, ids.profile));
    expect(mine()).toHaveLength(1);
    expect(mine()[0].workflowId).toBeUndefined();
    expect(await dataSource.getRepository(NotificationWorkflow).findOne({ where: { entityId: orderId } })).toBeNull();
  });
});
