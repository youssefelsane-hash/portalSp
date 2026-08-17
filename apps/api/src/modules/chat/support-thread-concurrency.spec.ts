import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ChatService } from './chat.service';
import { ChatThread } from './entities/chat-thread.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';

// Script 2 Part F (finding #31) — getOrCreateSupportThread كانت "search then create" بلا حماية
// DB، فطلبين متزامنين من نفس العميل ممكن يعدّوا الاتنين على "مفيش خيط" ويعملوا صفين. الإصلاح:
// فهرس فريد جزئي (migration 0128) + ON CONFLICT DO NOTHING، زي نفس نمط createThreadForOrder.
describe('ChatService support-thread get-or-create concurrency (PostgreSQL)', () => {
  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { customerUser: '', customer: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [ChatThread, CustomerProfile],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1, $2, 'customer') RETURNING id`,
      [`+2013${runId}`.slice(0, 15), `Support thread customer ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customer] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customer = customer.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      if (ids.customer) await q(`DELETE FROM chat_threads WHERE customer_id = $1`, [ids.customer]);
      if (ids.customer) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customer]);
      if (ids.customerUser) await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    } finally {
      await dataSource.destroy();
    }
  });

  function service(): ChatService {
    return new ChatService(
      dataSource.getRepository(ChatThread),
      {} as never,
      dataSource.getRepository(CustomerProfile),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('creates exactly one support thread when two requests race for the same customer', async () => {
    const [first, second] = await Promise.all([
      service().getOrCreateSupportThread(ids.customerUser),
      service().getOrCreateSupportThread(ids.customerUser),
    ]);

    expect(first.id).toBe(second.id);
    const [state] = await dataSource.query(
      `SELECT count(*)::integer AS thread_count FROM chat_threads WHERE customer_id = $1 AND thread_type = 'support_chat'`,
      [ids.customer],
    );
    expect(state.thread_count).toBe(1);
  });

  it('returns the same thread on a third sequential call (idempotent, not just race-safe)', async () => {
    const third = await service().getOrCreateSupportThread(ids.customerUser);
    const [state] = await dataSource.query(
      `SELECT count(*)::integer AS thread_count FROM chat_threads WHERE customer_id = $1 AND thread_type = 'support_chat'`,
      [ids.customer],
    );
    expect(state.thread_count).toBe(1);
    expect(third.customerId).toBe(ids.customer);
  });
});
