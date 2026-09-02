import { randomUUID } from 'crypto';
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
  let setBehaviorForThisTemplate: (fn: () => Promise<{ id: string }>) => void;

  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
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
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة موثوقية ${runId}`, `reliability-service-${runId}`],
    );
    ids.service = serviceRow.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع موثوقية ${runId}`],
    );
    ids.address = address.id;

    // is_active=false هنا عمدًا (مش true) — راجع sweepOwnTemplateOnly() تحت لسبب مفصّل.
    const [template] = await q(
      `INSERT INTO recurring_order_templates (customer_id, service_id, address_id, booking_mode, frequency, next_run_at, is_active)
       VALUES ($1,$2,$3,'individual','weekly', now() - interval '1 minute', false) RETURNING id`,
      [ids.customerProfile, ids.service, ids.address],
    );
    ids.template = template.id;

    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    // sweep() بيدور على *كل* القوالب المستحقة في الجدول الحقيقي، مش بس قالب الاختبار ده — لو ملف
    // اختبار تاني (recurring-orders-payment-method.spec.ts مثلاً) شغّال بالتوازي (jest worker
    // process منفصل، نفس قاعدة البيانات الحقيقية) وعنده قالب مستحق في نفس اللحظة، sweep() هينادي
    // createSpy لقالب الاختبار التاني كمان — لو استخدمنا mockRejectedValueOnce/mockResolvedValueOnce
    // العاديين، الرفض/النجاح المتحكم فيه ممكن "يتاكل" من نداء قالب مش بتاعنا خالص (بَقّة عزل اختبار
    // حقيقية اتلقطت أثناء تشغيل الـsuite كامل — docs/08 §20). الحل: نفلتر بـservice_id (فريد لكل
    // ملف اختبار عبر runId) — قوالب تانية بتاخد نجاح فوري تلقائي (مالهاش أثر على العدّاد بتاعنا)،
    // وبس قالب الاختبار ده اللي بياخد السلوك المتحكم فيه (نجاح/فشل) اللي كل it() بيحدده.
    let behaviorForThisTemplate: () => Promise<{ id: string }> = () => Promise.resolve({ id: 'unused' });
    createSpy = jest.fn(async (_userId: string, dto: { service_id: string }) => {
      if (dto.service_id !== ids.service) return { id: randomUUID() };
      return behaviorForThisTemplate();
    });
    setBehaviorForThisTemplate = (fn) => {
      behaviorForThisTemplate = fn;
    };
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
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      if (ids.template) await q(`DELETE FROM recurring_order_occurrences WHERE template_id = $1`, [ids.template]);
      if (ids.template) {
        await q(`UPDATE recurring_order_templates SET last_generated_order_id = NULL WHERE id = $1`, [ids.template]);
      }
      // بتتنضّف هنا بس (مش داخل كل it) عشان لو it فشلت (assertion throw) قبل ما توصل لسطر الحذف
      // بتاعها، مفيش صف orders يتيم يمنع حذف addresses تحت (FK) — نفس درس "نضّف في afterAll دايمًا".
      if (ids.address) await q(`DELETE FROM orders WHERE address_id = $1`, [ids.address]);
      if (ids.customerProfile) await q(`DELETE FROM recurring_order_templates WHERE customer_id = $1`, [ids.customerProfile]);
      if (ids.address) await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      if (ids.customerProfile) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (ids.customerUser) await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      if (ids.service) await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      if (ids.category) await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    } finally {
      await dataSource.destroy();
    }
  });

  // sweep() الحقيقية بتدور على *كل* القوالب المستحقة في الجدول، مش قالب معيّن — لو ملف اختبار
  // تاني (recurring-orders-payment-method.spec.ts) شغّال بالتوازي (jest worker process منفصل،
  // نفس قاعدة البيانات الحقيقية) وعنده قالب مستحق في نفس اللحظة، sweep() بتاعه ممكن "يسرق"
  // ويعالج قالب الاختبار ده كمان (ومنطقه هو دايمًا بينجح، فهيصفّر consecutive_failure_count بتاعنا
  // في نص السلسلة المتحكم فيها) — بَقّة عزل اختبار حقيقية تانية اتلقطت أثناء تشغيل الـsuite كامل
  // (docs/08 §20)، أعمق من فلترة createSpy بس (اللي بتحمي نداءات الاختبار ده من قوالب غريبة، لكن
  // مش العكس). الحل: القالب `is_active=false` طول الوقت إلا في اللحظة الفعلية لنداء sweep()
  // بتاعنا نفسه — نافذة الظهور لأي sweep() تانية بتتقلّص لأجزاء من الثانية بدل عمر الملف كله.
  async function sweepOwnTemplateOnly(): Promise<void> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query(`SELECT pg_advisory_lock($1)`, [71_208_019]);
    try {
      await runner.query(
        `UPDATE recurring_order_occurrences
         SET next_attempt_at = now() - interval '1 second'
         WHERE template_id = $1 AND status = 'failed'`,
        [ids.template],
      );
      await runner.query(`UPDATE recurring_order_templates SET is_active = true WHERE id = $1`, [ids.template]);
      try {
        // الفلترة بقالب الاختبار ده بس — worker موازي (ملف تكامل حي مثلاً) ميتسرقش منه،
        // ولو اتصرف عن قوالب تانية بالغلط ميبقاش ممكن أصلًا.
        await service.sweep({ templateIds: [ids.template] });
      } finally {
        await runner.query(`UPDATE recurring_order_templates SET is_active = false WHERE id = $1`, [ids.template]);
      }
    } finally {
      await runner.query(`SELECT pg_advisory_unlock($1)`, [71_208_019]);
      await runner.release();
    }
  }

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

  async function loadLatestOccurrence(): Promise<{ status: string; attempt_count: number; last_error: string | null }> {
    const [row] = await dataSource.query(
      `SELECT status, attempt_count, last_error
       FROM recurring_order_occurrences
       WHERE template_id = $1
       ORDER BY scheduled_for DESC
       LIMIT 1`,
      [ids.template],
    );
    return row;
  }

  it('فشل مؤقت (تحت السقف) — next_run_at ميتحركش، consecutive_failure_count بيزيد، صفر إشعار', async () => {
    const before = await loadTemplate();
    setBehaviorForThisTemplate(() => Promise.reject(new Error('DB blip مؤقت')));

    // مفيش تأكيد على القيمة الرجعة من sweep() هنا عمدًا — sweep() بترجّع عدد كل القوالب اللي
    // اتولّدت بنجاح في التشغيلة دي (مش قالب الاختبار ده بس)، فممكن تتأثر بقوالب تانية مستحقة في
    // نفس اللحظة من ملفات اختبار تانية شغالة بالتوازي. حالة قالب الاختبار ده نفسه (تحت) هي
    // التأكيد الدقيق والمعزول فعليًا.
    await sweepOwnTemplateOnly();

    const after = await loadTemplate();
    expect(after.next_run_at.getTime()).toBe(before.next_run_at.getTime());
    expect(after.consecutive_failure_count).toBe(1);
    expect(after.last_failure_reason).toBe('DB blip مؤقت');
    expect(after.last_failed_at).not.toBeNull();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('محاولة تانية فاشلة — لسه ميتخطاش، العداد بقى 2', async () => {
    setBehaviorForThisTemplate(() => Promise.reject(new Error('فشل تاني')));
    await sweepOwnTemplateOnly();
    const after = await loadTemplate();
    expect(after.consecutive_failure_count).toBe(2);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('المحاولة الثالثة (وصلت السقف) — dead-letter: next_run_at بيتخطّى، العداد يرجع صفر، إشعار ops_manager بيتصدّر', async () => {
    const before = await loadTemplate();
    setBehaviorForThisTemplate(() => Promise.reject(new Error('فشل ثالث ونهائي')));

    await sweepOwnTemplateOnly();

    const after = await loadTemplate();
    expect(after.next_run_at.getTime()).toBeGreaterThan(before.next_run_at.getTime());
    expect(after.consecutive_failure_count).toBe(0);
    // last_failure_reason/last_failed_at بيفضلوا محفوظين حتى بعد الـdead-letter — دليل تشخيصي للأدمن
    expect(after.last_failure_reason).toBe('فشل ثالث ونهائي');
    expect(after.last_failed_at).not.toBeNull();
    await expect(loadLatestOccurrence()).resolves.toMatchObject({
      status: 'manual_review',
      attempt_count: 3,
      last_error: 'فشل ثالث ونهائي',
    });
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
    setBehaviorForThisTemplate(() => Promise.resolve({ id: fakeOrder.id as string }));

    // نفس ملاحظة الاختبار الأول — مفيش تأكيد على القيمة الرجعة من sweep() (ممكن تتأثر بقوالب
    // تانية من ملفات اختبار متوازية)، حالة قالب الاختبار ده نفسه هي التأكيد الدقيق.
    await sweepOwnTemplateOnly();

    const after = await loadTemplate();
    expect(after.consecutive_failure_count).toBe(0);
    expect(after.last_failure_reason).toBeNull();
    expect(after.last_failed_at).toBeNull();
  });
});
