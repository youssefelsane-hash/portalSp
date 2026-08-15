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
import { ChatThread, ChatThreadType } from './entities/chat-thread.entity';

// اختبار حي ضد Postgres حقيقي — §24: كانت فجوة موثّقة صراحة — صفر حدث بيتصدّر على رسالة شات
// دعم جديدة، فمفيش طريقة توجيه إشعار لأدمن زي complaint.filed. اتقفلت: chat.support_message_
// received بيتصدّر لما العميل (مش الأدمن) يبعت في خيط support_chat، مربوطة بـmigration 0111.
describe('ChatService — حدث رسالة دعم جديدة (docs/08 §24)', () => {
  let dataSource: DataSource;
  let service: ChatService;
  let emitSpy: jest.Mock;
  const runId = Date.now().toString(36);
  const ids = { customerUser: '', adminUser: '', customerProfile: '', supportThread: '', orderThread: '' };

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
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;

    const [supportThread] = await q(
      `INSERT INTO chat_threads (thread_type, customer_id) VALUES ('support_chat', $1) RETURNING id`,
      [ids.customerProfile],
    );
    ids.supportThread = supportThread.id;
    const [orderThread] = await q(
      `INSERT INTO chat_threads (thread_type, customer_id) VALUES ('order_chat', $1) RETURNING id`,
      [ids.customerProfile],
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
    await q(`DELETE FROM chat_messages WHERE thread_id IN ($1,$2)`, [ids.supportThread, ids.orderThread]);
    await q(`DELETE FROM chat_threads WHERE id IN ($1,$2)`, [ids.supportThread, ids.orderThread]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.customerUser, ids.adminUser]);
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
  });

  it('رسالة العميل في خيط order_chat (مش دعم عام) — الحدث ماينفجرش', async () => {
    emitSpy.mockClear();
    await service.sendMessage(ids.customerUser, ids.orderThread, { content: 'إمتى الفني هيوصل؟' });
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
