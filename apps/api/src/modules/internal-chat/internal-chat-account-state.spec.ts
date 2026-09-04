import { DataSource } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { InternalChatService } from './internal-chat.service';
import { InternalChatThread } from './entities/internal-chat-thread.entity';
import { InternalMessage } from './entities/internal-message.entity';

describe('Internal chat account-state integrity (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: InternalChatService;
  const runId = Date.now().toString(36);
  const ids = { admin: '', peer: '', blocked: '', inactive: '', thread: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, InternalChatThread, InternalMessage],
    });
    await dataSource.initialize();
    service = new InternalChatService(
      dataSource.getRepository(InternalChatThread),
      dataSource.getRepository(InternalMessage),
      dataSource.getRepository(User),
    );

    const rows = await dataSource.query<{ id: string; label: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type, is_active, is_blocked) VALUES
         ($1,$2,'admin',true,false),
         ($3,$4,'technician',true,false),
         ($5,$6,'technician',true,true),
         ($7,$8,'admin',false,false)
       RETURNING id, full_name AS label`,
      [
        `+2013${runId}a`.slice(0, 15), `admin-${runId}`,
        `+2013${runId}p`.slice(0, 15), `peer-${runId}`,
        `+2013${runId}b`.slice(0, 15), `blocked-${runId}`,
        `+2013${runId}i`.slice(0, 15), `inactive-${runId}`,
      ],
    );
    for (const row of rows) {
      if (row.label.startsWith('admin-')) ids.admin = row.id;
      if (row.label.startsWith('peer-')) ids.peer = row.id;
      if (row.label.startsWith('blocked-')) ids.blocked = row.id;
      if (row.label.startsWith('inactive-')) ids.inactive = row.id;
    }
    ids.thread = (await service.getOrCreateThread(ids.admin, ids.peer)).id;
  });

  afterAll(async () => {
    await dataSource.query(
      `DELETE FROM notifications WHERE reference_type = 'internal_chat_thread' AND reference_id = $1`,
      [ids.thread],
    );
    await dataSource.query(`DELETE FROM internal_messages WHERE thread_id = $1`, [ids.thread]);
    await dataSource.query(`DELETE FROM internal_chat_threads WHERE id = $1`, [ids.thread]);
    await dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [ids.admin, ids.peer, ids.blocked, ids.inactive],
    ]);
    await dataSource.destroy();
  });

  it('omits blocked and inactive accounts from contact discovery', async () => {
    const contacts = await service.listContactsFor(ids.admin);
    const contactIds = new Set(contacts.map((contact) => contact.userId));
    expect(contactIds.has(ids.peer)).toBe(true);
    expect(contactIds.has(ids.blocked)).toBe(false);
    expect(contactIds.has(ids.inactive)).toBe(false);
  });

  it('rejects creating a new thread with blocked or inactive participants', async () => {
    await expect(service.getOrCreateThread(ids.admin, ids.blocked)).rejects.toMatchObject({ code: 'AUTH_001' });
    await expect(service.getOrCreateThread(ids.admin, ids.inactive)).rejects.toMatchObject({ code: 'AUTH_001' });
  });

  it('persists an in-app notification for the other participant with the message', async () => {
    await service.sendMessage(ids.admin, ids.thread, { content: 'راجع تفاصيل الطلب الجديد' });

    const notifications = await dataSource.query<
      Array<{ user_id: string; notification_type: string; deep_link: string }>
    >(
      `SELECT user_id, notification_type, deep_link
       FROM notifications
       WHERE reference_type = 'internal_chat_thread' AND reference_id = $1`,
      [ids.thread],
    );
    expect(notifications).toContainEqual({
      user_id: ids.peer,
      notification_type: 'internal_chat_message_received',
      deep_link: `/technician/internal-chat/${ids.thread}`,
    });
    expect(notifications).not.toContainEqual(expect.objectContaining({ user_id: ids.admin }));
  });

  it('preserves historical thread visibility but blocks new delivery after a participant is blocked', async () => {
    await dataSource.query(`UPDATE users SET is_blocked = true WHERE id = $1`, [ids.peer]);
    const historical = await service.listThreadsForUser(ids.admin);
    expect(historical.some(({ thread }) => thread.id === ids.thread)).toBe(true);
    await expect(service.sendMessage(ids.admin, ids.thread, { content: 'must not deliver' })).rejects.toMatchObject({
      code: 'AUTH_001',
    });
  });
});
