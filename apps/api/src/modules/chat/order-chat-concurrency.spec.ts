import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ChatService } from './chat.service';
import { ChatThread } from './entities/chat-thread.entity';

describe('ChatService order-thread replay safety (PostgreSQL)', () => {
  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    customerUser: '',
    customer: '',
    technicianUser: '',
    technician: '',
    category: '',
    service: '',
    address: '',
    order: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [ChatThread],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1, $2, 'customer') RETURNING id`,
      [`+2015${runId}`.slice(0, 15), `Chat customer ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customer] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customer = customer.id;
    const [technicianUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1, $2, 'technician') RETURNING id`,
      [`+2014${runId}`.slice(0, 15), `Chat technician ${runId}`],
    );
    ids.technicianUser = technicianUser.id;
    const [technician] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status)
       VALUES ($1, $2, 'new', 'approved') RETURNING id`,
      [ids.technicianUser, `CHAT${runId}`.slice(0, 20)],
    );
    ids.technician = technician.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1, $2, $3) RETURNING id`,
      [`شات ${runId}`, `Chat ${runId}`, `chat-recovery-${runId}`],
    );
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1, $2, $3, 'fixed', 10000) RETURNING id`,
      [ids.category, `خدمة شات ${runId}`, `chat-recovery-service-${runId}`],
    );
    ids.service = service.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع ${runId}`],
    );
    ids.address = address.id;
    const [order] = await q(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, order_status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, 'accepted', now()) RETURNING id`,
      [`CHAT-${runId}`.slice(0, 24), ids.customer, ids.technician, ids.service, ids.address],
    );
    ids.order = order.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      if (ids.order) await q(`DELETE FROM chat_threads WHERE order_id = $1`, [ids.order]);
      if (ids.order) await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      if (ids.address) await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      if (ids.customer) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customer]);
      if (ids.customerUser) await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      if (ids.technician) await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technician]);
      if (ids.technicianUser) await q(`DELETE FROM users WHERE id = $1`, [ids.technicianUser]);
      if (ids.service) await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      if (ids.category) await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    } finally {
      await dataSource.destroy();
    }
  });

  function service(): ChatService {
    return new ChatService(
      dataSource.getRepository(ChatThread),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('creates exactly one thread when two recovery workers replay the accepted order', async () => {
    const [first, second] = await Promise.all([
      service().createThreadForOrder(ids.order, ids.customer, ids.technician),
      service().createThreadForOrder(ids.order, ids.customer, ids.technician),
    ]);

    expect(first.id).toBe(second.id);
    const [state] = await dataSource.query(
      `SELECT count(*)::integer AS thread_count FROM chat_threads WHERE order_id = $1`,
      [ids.order],
    );
    expect(state.thread_count).toBe(1);
  });
});
