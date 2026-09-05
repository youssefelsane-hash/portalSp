import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Order } from './entities/order.entity';
import { RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { RecurringOrdersService } from './recurring-orders.service';

describe('RecurringOrdersService multi-instance occurrence claims (PostgreSQL)', () => {
  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { user: '', customer: '', category: '', service: '', address: '', template: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, RecurringOrderTemplate],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type)
       VALUES ($1, $2, 'customer') RETURNING id`,
      [`+2016${runId}`.slice(0, 15), `Recurring worker ${runId}`],
    );
    ids.user = user.id;
    const [customer] = await q(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
      [ids.user],
    );
    ids.customer = customer.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug)
       VALUES ($1, $2, $3) RETURNING id`,
      [`متكرر ${runId}`, `Recurring ${runId}`, `recurring-worker-${runId}`],
    );
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1, $2, $3, 'formula', 10000) RETURNING id`,
      [ids.category, `خدمة ${runId}`, `recurring-worker-service-${runId}`],
    );
    ids.service = service.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.user, `شارع ${runId}`],
    );
    ids.address = address.id;
    const [template] = await q(
      `INSERT INTO recurring_order_templates
         (customer_id, service_id, address_id, booking_mode, frequency, next_run_at, is_active)
       VALUES ($1, $2, $3, 'individual', 'weekly', now() - interval '1 minute', true)
       RETURNING id`,
      [ids.customer, ids.service, ids.address],
    );
    ids.template = template.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      if (ids.template) await q(`DELETE FROM recurring_order_occurrences WHERE template_id = $1`, [ids.template]);
      if (ids.template) await q(`UPDATE recurring_order_templates SET last_generated_order_id = NULL WHERE id = $1`, [ids.template]);
      if (ids.template) await q(`DELETE FROM orders WHERE recurring_template_id = $1`, [ids.template]);
      if (ids.template) await q(`DELETE FROM recurring_order_templates WHERE id = $1`, [ids.template]);
      if (ids.address) await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      if (ids.customer) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customer]);
      if (ids.user) await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
      if (ids.service) await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      if (ids.category) await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    } finally {
      await dataSource.destroy();
    }
  });

  function buildService(create: jest.Mock): RecurringOrdersService {
    return new RecurringOrdersService(
      dataSource.getRepository(RecurringOrderTemplate),
      { findByProfileIdOrThrow: jest.fn().mockResolvedValue({ userId: ids.user }) } as never,
      {} as never,
      {} as never,
      {} as never,
      { create } as never,
      { emit: jest.fn() } as never,
      {} as never, // buildingsService — التستات دي مالهاش قوالب مربوطة بعمارة,
      { createQueryRunner: () => ({ connect: async () => undefined, query: async () => [{ locked: true }], release: async () => undefined }) } as never,
    );
  }

  // نفس قفل/فلترة الـspecs المجاورة (71_208_019 + templateIds) — القالب هنا كان بيفضل مستحق
  // نشط طول الملف، فأي sweep غير مفلتر من worker موازي كان يقدر يخطف نوبته ويفسد العدّادات.
  // القفل بيتاخد **مرة واحدة** والسباق بين الـinstances بيحصل جواه (لو كل instance خد القفل
  // لوحده كانوا اتسلسلوا ومش سباق خالص).
  async function sweepConcurrently(services: RecurringOrdersService[]): Promise<void> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query(`SELECT pg_advisory_lock($1)`, [71_208_019]);
    try {
      await Promise.all(services.map((service) => service.sweep({ templateIds: [ids.template] })));
    } finally {
      await runner.query(`SELECT pg_advisory_unlock($1)`, [71_208_019]);
      await runner.release();
    }
  }

  it('creates at most one order when two API instances sweep the same occurrence', async () => {
    const create = jest.fn(
      async (_userId: string, _dto: unknown, identity: { templateId: string; scheduledFor: Date }) => {
        const [order] = await dataSource.query(
          `INSERT INTO orders
             (order_number, customer_id, service_id, address_id, order_status,
              total_amount_cents, technician_earning_cents, order_type,
              recurring_template_id, recurring_occurrence_at)
           VALUES ($1, $2, $3, $4, 'searching_technician', 0, 0, 'recurring', $5, $6)
           RETURNING id`,
          [
            `RC-${randomUUID().slice(0, 18)}`,
            ids.customer,
            ids.service,
            ids.address,
            identity.templateId,
            identity.scheduledFor,
          ],
        );
        return order;
      },
    );

    const first = buildService(create);
    const second = buildService(create);
    // نفس لحظة التنافس بالظبط، بس جوّه القفل المشترك — السباق الحقيقي جوّه sweep نفسه
    // (SKIP LOCKED + claim) مش بين الـworkers بتاعي وباقي ملفات الاختبار.
    await sweepConcurrently([first, second]);

    const [state] = await dataSource.query(
      `SELECT
         (SELECT count(*)::integer FROM orders WHERE recurring_template_id = $1) AS order_count,
         (SELECT count(*)::integer FROM recurring_order_occurrences
          WHERE template_id = $1 AND status = 'completed') AS completed_count`,
      [ids.template],
    );
    expect(state).toEqual({ order_count: 1, completed_count: 1 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('recovers a stale final claim after the order commit without creating or executing it again', async () => {
    const scheduledFor = new Date(Date.now() - 120_000);
    await dataSource.query(
      `UPDATE recurring_order_templates
       SET next_run_at = $2, is_active = true
       WHERE id = $1`,
      [ids.template, scheduledFor],
    );
    const [order] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, order_status,
          total_amount_cents, technician_earning_cents, order_type,
          recurring_template_id, recurring_occurrence_at)
       VALUES ($1, $2, $3, $4, 'searching_technician', 0, 0, 'recurring', $5, $6)
       RETURNING id`,
      [`CR-${randomUUID().slice(0, 18)}`, ids.customer, ids.service, ids.address, ids.template, scheduledFor],
    );
    await dataSource.query(
      `INSERT INTO recurring_order_occurrences
         (template_id, scheduled_for, status, attempt_count, claimed_at)
       VALUES ($1, $2, 'processing', 3, now() - interval '10 minutes')`,
      [ids.template, scheduledFor],
    );

    const create = jest.fn();
    await sweepConcurrently([buildService(create)]);

    const [occurrence] = await dataSource.query(
      `SELECT status, attempt_count, order_id
       FROM recurring_order_occurrences
       WHERE template_id = $1 AND scheduled_for = $2`,
      [ids.template, scheduledFor],
    );
    expect(occurrence).toEqual({ status: 'completed', attempt_count: 3, order_id: order.id });
    expect(create).not.toHaveBeenCalled();
  });

  it('moves an exhausted stale claim without an order to manual review instead of leaving it processing', async () => {
    const scheduledFor = new Date(Date.now() - 180_000);
    await dataSource.query(`UPDATE recurring_order_templates SET next_run_at = $2 WHERE id = $1`, [ids.template, scheduledFor]);
    await dataSource.query(
      `INSERT INTO recurring_order_occurrences
         (template_id, scheduled_for, status, attempt_count, claimed_at)
       VALUES ($1, $2, 'processing', 3, now() - interval '10 minutes')`,
      [ids.template, scheduledFor],
    );

    const create = jest.fn();
    await sweepConcurrently([buildService(create)]);

    const [occurrence] = await dataSource.query(
      `SELECT status, attempt_count, last_error
       FROM recurring_order_occurrences
       WHERE template_id = $1 AND scheduled_for = $2`,
      [ids.template, scheduledFor],
    );
    expect(occurrence.status).toBe('manual_review');
    expect(occurrence.attempt_count).toBe(3);
    expect(occurrence.last_error).toContain('انتهت مهلة آخر محاولة');
    expect(create).not.toHaveBeenCalled();
  });
});
