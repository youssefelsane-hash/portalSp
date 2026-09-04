import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PermissionsService } from '../admin/permissions.service';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { StorageService } from '../../common/storage/storage.service';
import { SUPPORT_CHAT_MESSAGE_RECEIVED_EVENT } from '../../common/events/support-chat-message-received.event';
import { ChatService } from './chat.service';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatThread } from './entities/chat-thread.entity';

// اختبار حي ضد Postgres حقيقي — §24: كانت فجوة موثّقة صراحة — صفر حدث بيتصدّر على رسالة شات
// دعم جديدة، فمفيش طريقة توجيه إشعار لأدمن زي complaint.filed. اتقفلت: chat.support_message_
// received بيتصدّر لما العميل (مش الأدمن) يبعت في خيط support_chat، مربوطة بـmigration 0111.
describe('ChatService — حدث رسالة دعم جديدة (docs/08 §24)', () => {
  let dataSource: DataSource;
  let service: ChatService;
  let emitSpy: jest.Mock;
  const runId = Date.now().toString(36);
  const ids = {
    customerUser: '',
    adminUser: '',
    technicianUser: '',
    customerProfile: '',
    technicianProfile: '',
    supportThread: '',
    orderThread: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, CustomerProfile, TechnicianProfile, ChatThread, ChatMessage],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2011${runId}`.slice(0, 15),
      `عميل اختبار شات ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2012${runId}`.slice(0, 15),
      `أدمن اختبار شات ${runId}`,
    ]);
    ids.adminUser = adminUser.id;
    const [technicianUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2013${runId}`.slice(0, 15), `فني اختبار شات ${runId}`],
    );
    ids.technicianUser = technicianUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level)
       VALUES ($1,$2,2,'new') RETURNING id`,
      [ids.technicianUser, `TCCHAT${runId}`.slice(0, 20)],
    );
    ids.technicianProfile = technicianProfile.id;

    const [supportThread] = await q(
      `INSERT INTO chat_threads (thread_type, customer_id) VALUES ('support_chat', $1) RETURNING id`,
      [ids.customerProfile],
    );
    ids.supportThread = supportThread.id;
    const [orderThread] = await q(
      `INSERT INTO chat_threads (thread_type, customer_id, technician_id) VALUES ('order_chat', $1, $2) RETURNING id`,
      [ids.customerProfile, ids.technicianProfile],
    );
    ids.orderThread = orderThread.id;

    emitSpy = jest.fn();

    service = new ChatService(
      dataSource.getRepository(ChatThread),
      dataSource.getRepository(ChatMessage),
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(User),
      { save: async () => 'https://example.com/f' } as unknown as StorageService,
      { hasPermission: async () => true } as unknown as PermissionsService,
      { emit: emitSpy } as unknown as EventEmitter2,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM notifications WHERE reference_type = 'chat_thread' AND reference_id IN ($1,$2)`, [ids.supportThread, ids.orderThread]);
    await q(`DELETE FROM chat_messages WHERE thread_id IN ($1,$2)`, [ids.supportThread, ids.orderThread]);
    await q(`DELETE FROM chat_threads WHERE id IN ($1,$2)`, [ids.supportThread, ids.orderThread]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [ids.customerUser, ids.adminUser, ids.technicianUser]);
    await dataSource.destroy();
  });

  it('رسالة العميل في خيط دعم عام — الحدث بيتصدّر', async () => {
    emitSpy.mockClear();
    await service.sendMessage(ids.customerUser, ids.supportThread, { content: 'محتاج مساعدة' });
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(SUPPORT_CHAT_MESSAGE_RECEIVED_EVENT, expect.objectContaining({ threadId: ids.supportThread }));
  });

  it('رد الأدمن على نفس الخيط — الحدث ماينفجرش (مش هنبعت إشعار لرد الأدمن نفسه)', async () => {
    emitSpy.mockClear();
    await service.sendMessage(ids.adminUser, ids.supportThread, { content: 'أهلاً، اتفضل قوللي المشكلة' });
    expect(emitSpy).not.toHaveBeenCalled();
    const notifications = await dataSource.query(
      `SELECT user_id, notification_type FROM notifications
       WHERE reference_id = $1 AND notification_type = 'support_chat_reply_received'`,
      [ids.supportThread],
    );
    expect(notifications).toContainEqual({ user_id: ids.customerUser, notification_type: 'support_chat_reply_received' });
  });

  it('رسالة العميل في خيط order_chat تحفظ إشعارًا دائمًا للفني فقط', async () => {
    emitSpy.mockClear();
    await service.sendMessage(ids.customerUser, ids.orderThread, { content: 'إمتى الفني هيوصل؟' });
    expect(emitSpy).not.toHaveBeenCalled();
    const notifications = await dataSource.query(
      `SELECT user_id, notification_type FROM notifications
       WHERE reference_id = $1 AND notification_type = 'order_chat_message_received'`,
      [ids.orderThread],
    );
    expect(notifications).toContainEqual({ user_id: ids.technicianUser, notification_type: 'order_chat_message_received' });
    expect(notifications).not.toContainEqual(expect.objectContaining({ user_id: ids.customerUser }));
  });

  it('رد الفني في خيط الطلب يحفظ إشعارًا دائمًا للعميل', async () => {
    await service.sendMessage(ids.technicianUser, ids.orderThread, { content: 'هوصل خلال عشر دقائق' });
    const notifications = await dataSource.query(
      `SELECT user_id, notification_type FROM notifications
       WHERE reference_id = $1 AND notification_type = 'order_chat_message_received'`,
      [ids.orderThread],
    );
    expect(notifications).toContainEqual({ user_id: ids.customerUser, notification_type: 'order_chat_message_received' });
  });
});
