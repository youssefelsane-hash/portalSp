import { DataSource } from 'typeorm';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { User } from '../auth/entities/user.entity';
import { RecurringOrdersService } from './recurring-orders.service';
import { RecurringOrderFrequency, RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { Order } from './entities/order.entity';

// اختبار حي ضد Postgres حقيقي — بيثبت إصلاح فجوة حقيقية (docs/08 §19 بند 20): كانت
// generateFromTemplate() بتحرّك next_run_at قدّام دايمًا مهما كان سبب الفشل، يعني فشل مؤقت
// كان بيسقط الموعد نهائيًا من أول محاولة بصمت. دلوقتي: إعادة محاولة محدودة (MAX_CONSECUTIVE_FAILURES=3)
// قبل ما يتخطّى الموعد كـ"dead letter" مع تسجيل السبب + إشعار ops_manager.
describe('RecurringOrdersService — موثوقية التوليد (retry/dead-letter, docs/08 §19 بند 20)', () => {
  let dataSource: DataSource;
  let service: RecurringOrdersService;
  let createSpy: jest.Mock;
  let emitSpy: jest.Mock;

  const runId = Date.now().toString(36);
  const ids = { customerUser: '', customerProfile: '', service: '', address: '', category: '', template: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [RecurringOrderTemplate, CustomerProfile, User, Order],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2018${runId}`.slice(0, 15), `عميل اختبار موثوقية ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.customerUser,
    ]);
    ids.customerProfile = customerProfile.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة موثوقية ${runId}`, `Reliability Category ${runId}`, `reliability-category-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة موثوقية ${runId}`, `reliability-service-${runId}`],
    );
    ids.service = serviceRow.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع موثوقية ${runId}`],
    );
    ids.address = address.id;

    const [template] = await q(
      `INSERT INTO recurring_order_templates (customer_id, service_id, address_id, booking_mode, frequency, next_run_at, is_active)
       VALUES ($1,$2,$3,'individual','weekly', now() - interval '1 minute', true) RETURNING id`,
      [ids.customerProfile, ids.service, ids.address],
    );
    ids.template = template.id;

    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    createSpy = jest.fn();
    emitSpy = jest.fn();

    service = new RecurringOrdersService(
      dataSource.getRepository(RecurringOrderTemplate),
      customerProfilesService,
      {} as never,
      {} as never,
      {} as never,
      { create: createSpy } as never,
      { emit: emitSpy } as never,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM recurring_order_templates WHERE customer_id = $1`, [ids.customerProfile]);
    // بتتنضّف هنا بس (مش داخل كل it) عشان لو it فشلت (assertion throw) قبل ما توصل لسطر الحذف
    // بتاعها، مفيش صف orders يتيم يمنع حذف addresses تحت (FK) — نفس درس "نضّف في afterAll دايمًا".
    await q(`DELETE FROM orders WHERE address_id = $1`, [ids.address]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  async function loadTemplate() {
    const [row] = await dataSource.query(
      `SELECT next_run_at, consecutive_failure_count, last_failure_reason, last_failed_at FROM recurring_order_templates WHERE id = $1`,
      [ids.template],
    );
    return row as {
      next_run_at: Date;
      consecutive_failure_count: number;
      last_failure_reason: string | null;
      last_failed_at: Date | null;
    };
  }

  it('فشل مؤقت (تحت السقف) — next_run_at ميتحركش، consecutive_failure_count بيزيد، صفر إشعار', async () => {
    const before = await loadTemplate();
    createSpy.mockRejectedValueOnce(new Error('DB blip مؤقت'));

    const generated = await service.sweep();

    expect(generated).toBe(0);
    const after = await loadTemplate();
    expect(after.next_run_at.getTime()).toBe(before.next_run_at.getTime());
    expect(after.consecutive_failure_count).toBe(1);
    expect(after.last_failure_reason).toBe('DB blip مؤقت');
    expect(after.last_failed_at).not.toBeNull();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('محاولة تانية فاشلة — لسه ميتخطاش، العداد بقى 2', async () => {
    createSpy.mockRejectedValueOnce(new Error('فشل تاني'));
    await service.sweep();
    const after = await loadTemplate();
    expect(after.consecutive_failure_count).toBe(2);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('المحاولة الثالثة (وصلت السقف) — dead-letter: next_run_at بيتخطّى، العداد يرجع صفر، إشعار ops_manager بيتصدّر', async () => {
    const before = await loadTemplate();
    createSpy.mockRejectedValueOnce(new Error('فشل ثالث ونهائي'));

    await service.sweep();

    const after = await loadTemplate();
    expect(after.next_run_at.getTime()).toBeGreaterThan(before.next_run_at.getTime());
    expect(after.consecutive_failure_count).toBe(0);
    // last_failure_reason/last_failed_at بيفضلوا محفوظين حتى بعد الـdead-letter — دليل تشخيصي للأدمن
    expect(after.last_failure_reason).toBe('فشل ثالث ونهائي');
    expect(after.last_failed_at).not.toBeNull();
    expect(emitSpy).toHaveBeenCalledTimes(1);
    const [eventName, eventPayload] = emitSpy.mock.calls[0] as [string, { attempts: number; reason: string }];
    expect(eventName).toBe('orders.recurring_template_generation_failing');
    expect(eventPayload.attempts).toBe(3);
    expect(eventPayload.reason).toBe('فشل ثالث ونهائي');
  });

  it('نجاح بعد كده — consecutive_failure_count وlast_failure_reason بيترجعوا يتصفروا', async () => {
    // الـdead-letter في الاختبار اللي فات حرّك next_run_at أسبوع قدّام (nextOccurrence لـweekly) —
    // بنرجّعه للماضي يدويًا عشان القالب يبقى "مستحق" تاني في sweep() الجاية.
    await dataSource.query(`UPDATE recurring_order_templates SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [
      ids.template,
    ]);

    const [fakeOrder] = await dataSource.query(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,'draft',0,0) RETURNING id`,
      [`TESTREL-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address],
    );
    createSpy.mockResolvedValueOnce({ id: fakeOrder.id });

    const generated = await service.sweep();

    expect(generated).toBe(1);
    const after = await loadTemplate();
    expect(after.consecutive_failure_count).toBe(0);
    expect(after.last_failure_reason).toBeNull();
    expect(after.last_failed_at).toBeNull();
  });
});
