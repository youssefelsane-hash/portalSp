import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { User } from '../auth/entities/user.entity';
import { RecurringOrdersService } from './recurring-orders.service';
import { RecurringOrderFrequency, RecurringOrderTemplate } from './entities/recurring-order-template.entity';
import { BookingMode, Order, OrderType } from './entities/order.entity';
import type { CreateOrderDto } from './dto/create-order.dto';

// اختبار حي ضد Postgres حقيقي — بيثبت إصلاح فجوة حقيقية (docs/08 §19 بند 6): generateFromTemplate()
// كانت بتبني CreateOrderDto من غير payment_method خالص، يعني كل طلب متولّد من قالب متكرر كان
// non-prepaid دايمًا مهما كان تفضيل العميل وقت إنشاء القالب (بيكسر قاعدة الدفع-قبل-التوزيع،
// ADR-0013). النطاق هنا مقصود وضيق: بنثبت إن template.paymentMethod بيوصل فعليًا لـ
// OrdersService.create() (مش بنعيد اختبار OrdersService.create() نفسها — دي حدود مسؤولية منفصلة
// ومختبرة في مكان تاني)، فـOrdersService هنا jest.fn() بيسجّل الـDTO اللي وصله بالظبط.
describe('RecurringOrdersService.generateFromTemplate() — payment_method يوصل صح (docs/08 §19 بند 6)', () => {
  let dataSource: DataSource;
  let service: RecurringOrdersService;
  let createSpy: jest.Mock;

  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    customerUser: '',
    customerProfile: '',
    service: '',
    address: '',
    category: '',
    fakeOrder: '',
  };

  // is_active=false وقت الإنشاء عمدًا (مش true) — راجع sweepOwnTemplateOnly() تحت لسبب مفصّل
  // (تضييق نافذة ظهور القالب لأي sweep() من ملف اختبار تاني شغّال بالتوازي على نفس القاعدة).
  async function insertTemplate(opts: { label: string; paymentMethod: 'card' | 'instapay' | null }) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [template] = await q(
      `INSERT INTO recurring_order_templates (customer_id, service_id, address_id, booking_mode, frequency, next_run_at, payment_method, is_active)
       VALUES ($1,$2,$3,'individual','weekly', now() - interval '1 minute', $4, false) RETURNING id`,
      [ids.customerProfile, ids.service, ids.address, opts.paymentMethod],
    );
    return template.id as string;
  }

  // نفس البَقّة الموثّقة في recurring-orders-generation-reliability.spec.ts بالحرف، بالاتجاه
  // العكسي: القالب هنا لو اتسيب is_active=true من لحظة الإنشاء، ملف الاختبار التاني (اللي شغّال
  // بالتوازي — jest worker process منفصل، نفس قاعدة البيانات الحقيقية) ممكن sweep() بتاعه يسبق
  // sweep() بتاعنا ويعالج القالب ده الأول (نجاح فوري من createSpy الفلترة بتاعته)، فـcallsForThisTest()
  // تحت هترجع صفر نداءات بدل واحد. القالب `is_active=false` طول الوقت إلا في اللحظة الفعلية
  // لنداء sweep() بتاعنا نفسه.
  async function sweepOwnTemplateOnly(templateId: string): Promise<void> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query(`SELECT pg_advisory_lock($1)`, [71_208_019]);
    try {
      await runner.query(`UPDATE recurring_order_templates SET is_active = true WHERE id = $1`, [templateId]);
      try {
        await service.sweep();
      } finally {
        await runner.query(`UPDATE recurring_order_templates SET is_active = false WHERE id = $1`, [templateId]);
      }
    } finally {
      await runner.query(`SELECT pg_advisory_unlock($1)`, [71_208_019]);
      await runner.release();
    }
  }

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
      [`+2017${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.customerUser,
    ]);
    ids.customerProfile = customerProfile.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-rot-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-rot-${runId}`],
    );
    ids.service = serviceRow.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);

    // last_generated_order_id عنده FK حقيقي لـorders(id) — لازم صف طلب حقيقي موجود فعلاً عشان
    // generateFromTemplate() تقدر تحدّثه بأمان، حتى لو مش بنختبر تفاصيل الطلب نفسه هنا (ده مسؤولية
    // OrdersService.create() المزيّفة تحت).
    const [fakeOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,'draft',0,0) RETURNING id`,
      [`TESTROT-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address],
    );
    ids.fakeOrder = fakeOrder.id;

    createSpy = jest.fn(async (_userId: string, _dto: CreateOrderDto) => ({ id: fakeOrder.id as string }) as Order);

    service = new RecurringOrdersService(
      dataSource.getRepository(RecurringOrderTemplate),
      customerProfilesService,
      {} as never, // addressesService — مش متنادى (generateFromTemplate بس بيتفحص هنا)
      {} as never, // catalogService
      {} as never, // techniciansService
      { create: createSpy } as never, // ordersService — مزيّف عشان نسجّل الـDTO اللي وصله
      { emit: jest.fn() } as never, // eventEmitter — مش متنادى في المسار السعيد (docs/08 §19 بند 20)
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      if (ids.customerProfile) {
        await q(
          `DELETE FROM recurring_order_occurrences
           WHERE template_id IN (SELECT id FROM recurring_order_templates WHERE customer_id = $1)`,
          [ids.customerProfile],
        );
      }
      if (ids.fakeOrder) {
        await q(`UPDATE recurring_order_templates SET last_generated_order_id = NULL WHERE last_generated_order_id = $1`, [ids.fakeOrder]);
        await q(`DELETE FROM orders WHERE id = $1`, [ids.fakeOrder]);
      }
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

  // sweep() بيدور على *كل* القوالب المستحقة في الجدول الحقيقي، مش بس اللي الاختبار ده عمله —
  // لو ملف اختبار تاني (recurring-orders-generation-reliability.spec.ts مثلاً) شغّال بالتوازي
  // (jest worker process منفصل، نفس قاعدة البيانات الحقيقية) وعنده قالب مستحق في نفس اللحظة،
  // createSpy المشترك هنا هيتنادى منه كمان — بَقّة عزل اختبار حقيقية اتلقطت أثناء تشغيل الـsuite
  // كامل (docs/08 §20). الفلترة بـservice_id (فريد لكل ملف اختبار عبر runId) بتعزل نداءات
  // الاختبار ده بس، بغض النظر عن أي قوالب تانية اتسوّت في نفس sweep().
  function callsForThisTest(): [string, CreateOrderDto][] {
    return (createSpy.mock.calls as [string, CreateOrderDto][]).filter(([, dto]) => dto.service_id === ids.service);
  }

  it('قالب بـpayment_method=card — الطلب المتولّد بيتطلب دفع كارت مسبق (payment_method بيوصل لـOrdersService.create())', async () => {
    const templateId = await insertTemplate({ label: `card-${runId}`, paymentMethod: 'card' });
    createSpy.mockClear();

    await sweepOwnTemplateOnly(templateId);

    const calls = callsForThisTest();
    expect(calls).toHaveLength(1);
    const [, dto] = calls[0];
    expect(dto.payment_method).toBe('card');
    expect(dto.order_type).toBe(OrderType.RECURRING);
    expect(dto.booking_mode).toBe(BookingMode.INDIVIDUAL);
  });

  it('قالب بـpayment_method=instapay — نفس المنطق', async () => {
    const templateId = await insertTemplate({ label: `insta-${runId}`, paymentMethod: 'instapay' });
    createSpy.mockClear();

    await sweepOwnTemplateOnly(templateId);

    const calls = callsForThisTest();
    expect(calls).toHaveLength(1);
    const [, dto] = calls[0];
    expect(dto.payment_method).toBe('instapay');
  });

  it('قالب من غير payment_method (الافتراضي زي زمان) — CreateOrderDto مالوش payment_method خالص (regression: مفيش دفع مسبق كاذب)', async () => {
    const templateId = await insertTemplate({ label: `none-${runId}`, paymentMethod: null });
    createSpy.mockClear();

    await sweepOwnTemplateOnly(templateId);

    const calls = callsForThisTest();
    expect(calls).toHaveLength(1);
    const [, dto] = calls[0];
    expect(dto.payment_method).toBeUndefined();
  });
});
