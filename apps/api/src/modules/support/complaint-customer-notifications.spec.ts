import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User, UserType } from '../auth/entities/user.entity';
import { JwtPayload } from '../auth/types/authenticated-request';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Order } from '../orders/entities/order.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { ComplaintAttachment } from './entities/complaint-attachment.entity';
import { Complaint, ComplaintResolutionType } from './entities/complaint.entity';
import { ComplaintMessage } from './entities/complaint-message.entity';
import { SupportService } from './support.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { COMPLAINT_MESSAGE_ADDED_EVENT, ComplaintMessageAddedEvent } from '../../common/events/complaint-message-added.event';
import { COMPLAINT_STATUS_CHANGED_EVENT, ComplaintStatusChangedEvent } from '../../common/events/complaint-status-changed.event';
import { purgeAuditLogs } from '../../common/db/audit-purge.testing';

// بلاغ مالك صريح (docs/08 §73 بند 2): "الأدمن يرد على شكوى، الرسالة توصل، مفيش notification لصاحبها".
// نفس منهجية complaint-decision-concurrency.spec.ts (DataSource حقيقي، Postgres حي) — بس هنا
// بنستخدم EventEmitter2 حقيقي مع مستمع تجسسي بدل mock فاضي، عشان نتأكد إن الحدث بيتصدّر فعلاً
// بالـpayload الصح، مش بس إن الكود بيcompile. تكامل notify()→notification row نفسه اتأكد حي
// بـcurl مباشر (POST /complaints/:id/messages كأدمن → صف في جدول notifications) وقت التنفيذ.
describe('SupportService — إشعارات صاحب الشكوى (رد الأدمن + تغيير الحالة)', () => {
  let dataSource: DataSource;
  let service: SupportService;
  let emitted: Array<{ event: string; payload: unknown }>;
  const runId = Date.now().toString(36);
  const ids = { customerUser: '', customerProfile: '', adminUser: '', complaints: [] as string[] };

  async function createComplaint(label: string): Promise<string> {
    const [complaint] = await dataSource.query(
      `INSERT INTO complaints
         (complaint_number, filed_by_user_id, category, severity, title, description, complaint_status, sla_due_at)
       VALUES ($1,$2,'other','medium',$3,$4,'open',now() + interval '24 hours') RETURNING id`,
      [`CMPN${runId}-${label}`.slice(0, 24), ids.customerUser, `شكوى ${label}`, `وصف شكوى ${label}`],
    );
    ids.complaints.push(complaint.id);
    return complaint.id;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, CustomerProfile, Order, Wallet, WalletTransaction, Complaint, ComplaintMessage, ComplaintAttachment, AuditLog],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [customer] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2075${runId}`.slice(0, 15),
      `عميل إشعار ${runId}`,
    ]);
    ids.customerUser = customer.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = profile.id;
    const [admin] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2076${runId}`.slice(0, 15),
      `أدمن إشعار ${runId}`,
    ]);
    ids.adminUser = admin.id;

    const walletsService = { getOrCreateWallet: async () => ({ id: 'noop', balanceCents: 0 }) } as unknown as WalletsService;
    const auditLog = new AuditLogService(dataSource.getRepository(AuditLog));
    const events = new EventEmitter2();
    emitted = [];
    events.on(COMPLAINT_MESSAGE_ADDED_EVENT, (payload) => emitted.push({ event: COMPLAINT_MESSAGE_ADDED_EVENT, payload }));
    events.on(COMPLAINT_STATUS_CHANGED_EVENT, (payload) => emitted.push({ event: COMPLAINT_STATUS_CHANGED_EVENT, payload }));

    service = new SupportService(
      dataSource.getRepository(Complaint),
      dataSource.getRepository(ComplaintMessage),
      dataSource.getRepository(ComplaintAttachment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      { findByUserIdOrThrow: async () => Promise.reject(new Error('not a technician')) } as never,
      walletsService,
      auditLog,
      events,
      {} as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
      await q(`DELETE FROM complaint_messages WHERE complaint_id = ANY($1::uuid[])`, [ids.complaints]);
      await purgeAuditLogs(dataSource, `DELETE FROM audit_logs WHERE entity_type = 'complaint' AND entity_id = ANY($1::uuid[])`, [ids.complaints]);
      await q(`DELETE FROM complaints WHERE id = ANY($1::uuid[])`, [ids.complaints]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.customerUser, ids.adminUser]]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  const adminJwt = (): JwtPayload => ({ sub: ids.adminUser, userType: UserType.ADMIN, amr: ['otp'] });

  it('addMessage() — رد الأدمن العادي بيصدّر حدث للعميل صاحب الشكوى', async () => {
    const complaintId = await createComplaint('reply-notifies');
    emitted.length = 0;
    await service.addMessage(adminJwt(), complaintId, { message: 'بنراجع شكواك' });

    const messageEvents = emitted.filter((e) => e.event === COMPLAINT_MESSAGE_ADDED_EVENT);
    expect(messageEvents).toHaveLength(1);
    const payload = messageEvents[0].payload as ComplaintMessageAddedEvent;
    expect(payload.complaintId).toBe(complaintId);
    expect(payload.recipientUserId).toBe(ids.customerUser);
  });

  it('addMessage() — ملاحظة داخلية ماتصدّرش أي حدث خالص', async () => {
    const complaintId = await createComplaint('internal-note-silent');
    emitted.length = 0;
    await service.addMessage(adminJwt(), complaintId, { message: 'ملاحظة لفريق الدعم بس', is_internal_note: true });

    expect(emitted.filter((e) => e.event === COMPLAINT_MESSAGE_ADDED_EVENT)).toHaveLength(0);
  });

  it('resolve()/reject()/close() — كل واحد بيصدّر حدث تغيير حالة للعميل', async () => {
    const resolveId = await createComplaint('resolve-notifies');
    emitted.length = 0;
    await service.resolve(ids.adminUser, resolveId, { resolution_type: ComplaintResolutionType.NO_ACTION, resolution_notes: 'اتراجعت' });
    let statusEvents = emitted.filter((e) => e.event === COMPLAINT_STATUS_CHANGED_EVENT);
    expect(statusEvents).toHaveLength(1);
    expect((statusEvents[0].payload as ComplaintStatusChangedEvent).recipientUserId).toBe(ids.customerUser);

    const rejectId = await createComplaint('reject-notifies');
    emitted.length = 0;
    await service.reject(ids.adminUser, rejectId, { resolution_notes: 'مش مقبولة' });
    statusEvents = emitted.filter((e) => e.event === COMPLAINT_STATUS_CHANGED_EVENT);
    expect(statusEvents).toHaveLength(1);

    const closeId = await createComplaint('close-notifies');
    await service.resolve(ids.adminUser, closeId, { resolution_type: ComplaintResolutionType.NO_ACTION, resolution_notes: 'اتراجعت' });
    emitted.length = 0;
    await service.close(ids.adminUser, closeId);
    statusEvents = emitted.filter((e) => e.event === COMPLAINT_STATUS_CHANGED_EVENT);
    expect(statusEvents).toHaveLength(1);
  });

  it('addMessage() — رسالة العميل نفسه (مش أدمن) ماتصدّرش أي حدث خالص', async () => {
    const complaintId = await createComplaint('customer-message-silent');
    emitted.length = 0;
    await service.addMessage({ sub: ids.customerUser, userType: UserType.CUSTOMER, amr: ['otp'] }, complaintId, {
      message: 'متابعة مني',
    });

    expect(emitted.filter((e) => e.event === COMPLAINT_MESSAGE_ADDED_EVENT)).toHaveLength(0);
  });

  // docs/08 §73 بند 3 المؤجّل (اتفعّل) — شاشة تفاصيل الطلب في الأدمن بتحتاج تعرض شكاوى الطلب ده بس.
  it('listAllForAdmin(orderId) — بيرجّع شكاوى الطلب المحدد بس، مش كل الشكاوى', async () => {
    const linkedComplaintId = await createComplaint('order-linked');
    const otherComplaintId = await createComplaint('order-unrelated');

    const [service_] = await dataSource.query(`SELECT id FROM services LIMIT 1`);
    const [address] = await dataSource.query(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار شكاوى ${runId}`],
    );
    const [order] = await dataSource.query(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status, payment_status, total_amount_cents)
       VALUES ($1,$2,$3,$4,'completed','paid',10000) RETURNING id`,
      [`TESTCPF-${runId}`.slice(0, 24), ids.customerProfile, service_.id, address.id],
    );
    await dataSource.query(`UPDATE complaints SET order_id = $1 WHERE id = $2`, [order.id, linkedComplaintId]);

    try {
      const filtered = await service.listAllForAdmin(order.id);
      expect(filtered.map((c) => c.id)).toEqual([linkedComplaintId]);

      const all = await service.listAllForAdmin();
      const allIds = all.map((c) => c.id);
      expect(allIds).toEqual(expect.arrayContaining([linkedComplaintId, otherComplaintId]));
    } finally {
      await dataSource.query(`UPDATE complaints SET order_id = NULL WHERE id = $1`, [linkedComplaintId]);
      await dataSource.query(`DELETE FROM order_status_history WHERE order_id = $1`, [order.id]);
      await dataSource.query(`DELETE FROM orders WHERE id = $1`, [order.id]);
      await dataSource.query(`DELETE FROM addresses WHERE id = $1`, [address.id]);
    }
  });
});
