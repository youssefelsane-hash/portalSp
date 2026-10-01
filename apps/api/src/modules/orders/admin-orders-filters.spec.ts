import { DataSource } from 'typeorm';
import { AdminOrdersService } from './admin-orders.service';
import { Order } from './entities/order.entity';

describe('Admin orders search and advanced filters', () => {
  jest.setTimeout(30_000);

  let db: DataSource;
  let service: AdminOrdersService;
  const runId = Date.now().toString(36).toUpperCase();
  const prefix = `FLT-${runId}`;
  const ids = { user: '', profile: '', techUser: '', tech: '', address: '', city: '', zoneA: '', zoneB: '', category: '', serviceA: '', serviceB: '', template: '' };
  const q = (sql: string, params?: unknown[]) => db.query(sql, params);
  const number = (suffix: string) => `${prefix}-${suffix}`;
  const resultNumbers = async (filters: Record<string, unknown>) => {
    const result = await service.list({ scope: 'all', search: prefix, ...filters } as never);
    return result.items.map((order) => order.orderNumber);
  };

  beforeAll(async () => {
    db = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak', entities: [Order] });
    await db.initialize();
    service = Object.create(AdminOrdersService.prototype) as AdminOrdersService;
    Object.assign(service, { orders: db.getRepository(Order) });

    const [country] = await q('SELECT id FROM countries LIMIT 1');
    const [city] = await q(`INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة فلتر ${runId}`, `Filter ${runId}`, `filter-${runId.toLowerCase()}`]);
    ids.city = city.id;
    const [zoneA] = await q(`INSERT INTO service_zones (city_id,name_ar,name_en) VALUES ($1,$2,$3) RETURNING id`, [ids.city, `منطقة أ ${runId}`, `Zone A ${runId}`]);
    const [zoneB] = await q(`INSERT INTO service_zones (city_id,name_ar,name_en) VALUES ($1,$2,$3) RETURNING id`, [ids.city, `منطقة ب ${runId}`, `Zone B ${runId}`]);
    ids.zoneA = zoneA.id;
    ids.zoneB = zoneB.id;
    const [user] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2086${runId}`.slice(0, 15), `عميل فلتر ${runId}`]);
    ids.user = user.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.user]);
    ids.profile = profile.id;
    const [techUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2087${runId}`.slice(0, 15), `فني فلتر ${runId}`]);
    ids.techUser = techUser.id;
    const [code] = await q(`SELECT next_technician_code() AS code`);
    const [tech] = await q(`INSERT INTO technician_profiles (user_id,technician_code) VALUES ($1,$2) RETURNING id`, [ids.techUser, code.code]);
    ids.tech = tech.id;
    const [address] = await q(`INSERT INTO addresses (user_id,city_id,street_name,location)
      VALUES ($1,$2,$3,ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`, [ids.user, ids.city, 'شارع الفلتر']);
    ids.address = address.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة فلتر ${runId}`, `Filter ${runId}`, `filter-cat-${runId.toLowerCase()}`]);
    ids.category = category.id;
    for (const suffix of ['A', 'B'] as const) {
      const [svc] = await q(`INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents)
        VALUES ($1,$2,$3,'formula',10000) RETURNING id`, [ids.category, `خدمة ${suffix} ${runId}`, `filter-svc-${suffix.toLowerCase()}-${runId.toLowerCase()}`]);
      ids[suffix === 'A' ? 'serviceA' : 'serviceB'] = svc.id;
    }
    const [template] = await q(`INSERT INTO recurring_order_templates (customer_id,service_id,address_id,frequency,next_run_at)
      VALUES ($1,$2,$3,'monthly',now() + interval '1 month') RETURNING id`, [ids.profile, ids.serviceB, ids.address]);
    ids.template = template.id;

    const addOrder = async (suffix: string, scheduledAt: string, status: string, payment: string, serviceId: string, zoneId: string,
      technicianId: string | null = null, recurring = false, requiredTechnicians = 1, placedAt = scheduledAt) => {
      await q(`INSERT INTO orders (commission_rate_applied,order_number,customer_id,technician_id,service_id,address_id,service_zone_id,
          order_status,payment_status,total_amount_cents,technician_earning_cents,scheduled_at,placed_at,work_completed_at,
          recurring_template_id,recurring_occurrence_at,required_technicians,order_type)
        VALUES (20,$1,$2,$3,$4,$5,$6,$7,$8,10000,8000,$9,$15,$10,$11,$12,$13,$14)`,
      [number(suffix), ids.profile, technicianId, serviceId, ids.address, zoneId, status, payment, scheduledAt,
        status === 'completed' ? scheduledAt : null, recurring ? ids.template : null, recurring ? scheduledAt : null,
        requiredTechnicians, recurring ? 'recurring' : 'standard', placedAt]);
    };
    await addOrder('A', '2026-10-04 00:30:00+03', 'searching_technician', 'unpaid', ids.serviceA, ids.zoneA, null, false, 2);
    await addOrder('B', '2026-10-04 23:45:00+03', 'completed', 'paid', ids.serviceB, ids.zoneB, ids.tech, true);
    await addOrder('C', '2026-10-05 00:15:00+03', 'searching_technician', 'unpaid', ids.serviceA, ids.zoneA);
    await addOrder('D', '2026-10-06 12:00:00+03', 'searching_technician', 'unpaid', ids.serviceA, ids.zoneA,
      null, false, 1, '2026-10-04 16:00:00+03');
    await addOrder('TODAY', new Date().toISOString(), 'searching_technician', 'unpaid', ids.serviceA, ids.zoneA);
  });

  afterAll(async () => {
    if (!db?.isInitialized) return;
    try {
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`${prefix}-%`]);
      await q(`DELETE FROM recurring_order_templates WHERE id = $1`, [ids.template]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.profile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.tech]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.user, ids.techUser]]);
      await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [[ids.serviceA, ids.serviceB]]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1::uuid[])`, [[ids.zoneA, ids.zoneB]]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await db.destroy();
    }
  });

  it('finds an order by its full or partial number when the scope includes it', async () => {
    expect(await resultNumbers({ search: number('B') })).toEqual([number('B')]);
    expect(await resultNumbers({ search: `${prefix}-` })).toEqual(expect.arrayContaining([number('A'), number('B')]));
  });

  it('applies scope, explicit status, payment, service, zone, recurring, crew, and unassigned filters', async () => {
    expect(await resultNumbers({ scope: 'completed' })).toEqual([number('B')]);
    expect(await resultNumbers({ scope: 'current', order_status: 'completed' })).toEqual([number('B')]);
    expect(await resultNumbers({ payment_status: 'paid' })).toEqual([number('B')]);
    expect(await resultNumbers({ service_id: ids.serviceB })).toEqual([number('B')]);
    expect(await resultNumbers({ service_zone_id: ids.zoneB })).toEqual([number('B')]);
    expect(await resultNumbers({ recurring: 'true' })).toEqual([number('B')]);
    expect(await resultNumbers({ recurring: 'false' })).not.toContain(number('B'));
    expect(await resultNumbers({ crew: 'incomplete' })).toEqual([number('A')]);
    expect(await resultNumbers({ bucket: 'unassigned' })).not.toContain(number('B'));
    expect(await resultNumbers({ bucket: 'today' })).toContain(number('TODAY'));
  });

  it('treats both ends of a Cairo date as part of the selected execution day', async () => {
    const filters = { date_field: 'scheduled_at', from: '2026-10-04', to: '2026-10-04' };
    expect((await resultNumbers(filters)).sort()).toEqual([number('A'), number('B')]);
    const summary = await service.summary({ scope: 'all', search: prefix, ...filters } as never);
    expect(summary.total).toBe(2);
    const calendar = await service.calendar({ scope: 'all', search: prefix, ...filters } as never);
    expect(calendar).toEqual([expect.objectContaining({ day: '2026-10-04', total: 2 })]);
  });

  it('applies the selected date field rather than always using scheduled_at', async () => {
    const placedFilters = { date_field: 'placed_at', from: '2026-10-04', to: '2026-10-04' };
    expect((await resultNumbers(placedFilters)).sort()).toEqual([number('A'), number('B'), number('D')]);
    expect(await service.calendar({ scope: 'all', search: prefix, ...placedFilters } as never))
      .toEqual([expect.objectContaining({ day: '2026-10-04', total: 3 })]);
    expect(await resultNumbers({ date_field: 'completed_at', from: '2026-10-04', to: '2026-10-04' })).toEqual([number('B')]);
  });

  it('keeps precise timestamp bounds for existing API callers', async () => {
    expect(await resultNumbers({ from: '2026-10-04T00:00:00Z', to: '2026-10-04T21:00:00Z' })).toEqual([number('B')]);
  });

  it('sorts by the next execution time when requested', async () => {
    const result = await resultNumbers({ sort: 'soonest', date_field: 'scheduled_at', from: '2026-10-04', to: '2026-10-06' });
    expect(result).toEqual([number('A'), number('B'), number('C'), number('D')]);
  });

  it('keeps tomorrow, seven days, upcoming, and overdue buckets distinct', async () => {
    const seedAtCairoNoon = async (suffix: string, dayOffset: number) => {
      const [row] = await q(`SELECT (((now() AT TIME ZONE 'Africa/Cairo')::date + $1::int)::timestamp
        + interval '12 hours') AT TIME ZONE 'Africa/Cairo' AS scheduled_at`, [dayOffset]);
      await q(`INSERT INTO orders (commission_rate_applied,order_number,customer_id,service_id,address_id,service_zone_id,
        order_status,payment_status,total_amount_cents,scheduled_at,placed_at)
        VALUES (20,$1,$2,$3,$4,$5,'searching_technician','unpaid',10000,$6,now())`,
      [number(suffix), ids.profile, ids.serviceA, ids.address, ids.zoneA, row.scheduled_at]);
    };
    await seedAtCairoNoon('TOMORROW', 1);
    await seedAtCairoNoon('DAY6', 6);
    await seedAtCairoNoon('DAY7', 7);
    await seedAtCairoNoon('OVERDUE', -1);

    expect(await resultNumbers({ search: number('TOMORROW'), bucket: 'tomorrow' })).toEqual([number('TOMORROW')]);
    expect(await resultNumbers({ search: number('DAY6'), bucket: 'next7' })).toEqual([number('DAY6')]);
    expect(await resultNumbers({ search: number('DAY7'), bucket: 'next7' })).toEqual([]);
    expect(await resultNumbers({ search: number('TOMORROW'), bucket: 'upcoming' })).toEqual([number('TOMORROW')]);
    expect(await resultNumbers({ search: number('OVERDUE'), bucket: 'overdue' })).toEqual([number('OVERDUE')]);
    expect(await resultNumbers({ search: number('OVERDUE'), bucket: 'upcoming' })).toEqual([]);
  });
});
