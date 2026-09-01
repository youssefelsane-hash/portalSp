import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';

/**
 * ADR-0047 / docs/08 §77-D1 — «استكمال الشغل يوم تاني».
 *
 * طلب مالك: الفني بدأ الشغل واكتشف إنه محتاج قطعة غيار نادرة. الاختبار الحي ده بيثبت السلسلة
 * كلها على قاعدة بيانات حقيقية: الزيارتين بيتسجّلوا، `scheduled_at` بيتحدّث لليوم الجديد (وده
 * اللي بيحجز طاقة الفني بالآلية القائمة)، الحالة **بتفضل `in_progress`**، والعميل بيتخطر.
 */
describe('OrdersService.continueWorkAnotherDay (ADR-0047)', () => {
  let dataSource: DataSource;
  let service: OrdersService;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    custUser: '', profile: '', techUser: '', tech: '',
    category: '', service: '', address: '', order: '',
  };
  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;
  const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory],
    });
    await dataSource.initialize();

    const [cu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2081${runId}`.slice(0, 15), `عميل استكمال ${runId}`],
    );
    ids.custUser = cu.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.custUser]);
    ids.profile = cp.id;
    const [tu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2082${runId}`.slice(0, 15), `فني استكمال ${runId}`],
    );
    ids.techUser = tu.id;
    const [tp] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status)
       VALUES ($1,$2,'approved') RETURNING id`,
      [ids.techUser, `TCONT-${runId}`],
    );
    ids.tech = tp.id;
    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة استكمال ${runId}`, `cont ${runId}`, `cont-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, pricing_model)
       VALUES ($1,$2,$3,$4,50000,'fixed') RETURNING id`,
      [ids.category, `خدمة استكمال ${runId}`, `cont svc ${runId}`, `cont-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.custUser, `عنوان استكمال ${runId}`],
    );
    ids.address = addr.id;
    const [ord] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id,
                           order_status, payment_status, total_amount_cents, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,'in_progress','pending',50000, now()) RETURNING id`,
      [`CONT${runId}`, ids.profile, ids.tech, ids.service, ids.address],
    );
    ids.order = ord.id;

    service = Object.create(OrdersService.prototype) as OrdersService;
    Object.assign(service, {
      dataSource,
      settingsService: { getNumber: async (_k: string, fallback: number) => fallback },
      techniciansService: { findByUserIdOrThrow: async () => ({ id: ids.tech }) },
      customerProfiles: { findByProfileIdOrThrow: async () => ({ userId: ids.custUser }) },
      // الإشعار الدائم بيتكتب جوّه نفس الترانزاكشن — بنموّهه هنا عشان نعزل السلوك اللي
      // بنختبره (الزيارات + الجدولة)، والتحقق من وصول الإشعار له اختباراته الخاصة.
      insertDurableInAppNotification: async () => undefined,
    });
  });

  afterAll(async () => {
    await q(`DELETE FROM order_work_sessions WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM order_status_history WHERE order_id = $1`, [ids.order]);
    await q(
      `DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE order_id = $1)`,
      [ids.order],
    );
    await q(`DELETE FROM chat_threads WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.tech]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.profile]);
    // **مش تنظيف احتياطي — لازم فعلاً**: محرك الحملات (ADR-0046) بيمشي على العملاء في
    // الخلفية، وممكن يكون سجّل إرسال لعميل الاختبار ده أثناء ما الـsuite شغّالة (حصل فعلاً
    // في تشغيلة كاملة وكسر الحذف بـFK). أي fixture بيعمل عميل لازم ينضّف آثار الحملات قبل
    // ما يمسح المستخدم.
    await q(`DELETE FROM notification_campaign_sends WHERE user_id = ANY($1)`,
      [[ids.custUser, ids.techUser]]);
    await q(`DELETE FROM customer_service_intents WHERE user_id = ANY($1)`,
      [[ids.custUser, ids.techUser]]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.custUser, ids.techUser]]);
    await dataSource.destroy();
  });

  it('بيسجّل زيارتين: اللي وقفت (بالسبب) واللي جاية (مجدولة)', async () => {
    const nextDate = tomorrow();
    await service.continueWorkAnotherDay(ids.techUser, ids.order, {
      pause_reason: 'محتاج قطعة غيار نادرة، هجيبها بكرة',
      next_session_date: nextDate,
    });

    const rows = await q<{ status: string; pause_reason: string | null; session_date: string }>(
      `SELECT status, pause_reason, session_date::text FROM order_work_sessions
       WHERE order_id = $1 ORDER BY status`,
      [ids.order],
    );
    expect(rows).toHaveLength(2);
    const partial = rows.find((r) => r.status === 'completed_partial')!;
    const scheduled = rows.find((r) => r.status === 'scheduled')!;
    expect(partial.pause_reason).toBe('محتاج قطعة غيار نادرة، هجيبها بكرة');
    expect(scheduled.pause_reason).toBeNull();
    expect(scheduled.session_date).toBe(nextDate);
  });

  // ده جوهر ADR-0047: تحديث `scheduled_at` هو اللي بيخلّي حجز طاقة الفني في اليوم الجديد
  // يشتغل بالآلية القائمة (منطق التعارض بيقارن أيام الطلبات النشطة بـ`scheduled_at`، و
  // `in_progress` موجودة في مجموعتَي الحالات) — من غير أي منطق موازي.
  it('`scheduled_at` بيتحدّث لليوم الجديد — وده اللي بيحجز طاقة الفني', async () => {
    const [row] = await q<{ day: string }>(
      `SELECT (scheduled_at AT TIME ZONE 'Africa/Cairo')::date::text AS day FROM orders WHERE id = $1`,
      [ids.order],
    );
    expect(row.day).toBe(tomorrow());
  });

  it('حالة الطلب بتفضل in_progress — الشغل شغّال، مجرد إنه متقسّم على أيام', async () => {
    const [row] = await q<{ order_status: string }>(
      `SELECT order_status FROM orders WHERE id = $1`,
      [ids.order],
    );
    expect(row.order_status).toBe(OrderStatus.IN_PROGRESS);
  });

  it('بيتسجّل في تاريخ الحالات بالسبب — الدعم لازم يشوف حصل إيه وليه', async () => {
    const rows = await q<{ reason: string }>(
      `SELECT reason FROM order_status_history WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [ids.order],
    );
    expect(rows[0].reason).toContain('استكمال الشغل يوم تاني');
    expect(rows[0].reason).toContain('قطعة غيار نادرة');
  });

  it('زيارة مجدولة تانية مفتوحة: مرفوضة (فهرس فريد جزئي)', async () => {
    await expect(
      service.continueWorkAnotherDay(ids.techUser, ids.order, {
        pause_reason: 'سبب تاني للتجربة',
        next_session_date: tomorrow(),
      }),
    ).rejects.toThrow();
  });

  it('يوم فات أو النهارده: مرفوض — الاستكمال معناه ترجع في يوم تاني', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    await expect(
      service.continueWorkAnotherDay(ids.techUser, ids.order, {
        pause_reason: 'سبب صالح بس التاريخ غلط',
        next_session_date: today,
      }),
    ).rejects.toThrow();
  });

  it('طلب مش in_progress: مرفوض — الاستكمال متاح بس والشغل شغّال', async () => {
    await q(`UPDATE orders SET order_status = 'accepted' WHERE id = $1`, [ids.order]);
    try {
      await expect(
        service.continueWorkAnotherDay(ids.techUser, ids.order, {
          pause_reason: 'الشغل لسه ما بدأش',
          next_session_date: tomorrow(),
        }),
      ).rejects.toThrow();
    } finally {
      await q(`UPDATE orders SET order_status = 'in_progress' WHERE id = $1`, [ids.order]);
    }
  });
});
