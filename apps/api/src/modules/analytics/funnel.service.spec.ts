import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { OrderSourceChannel } from '../orders/entities/order.entity';
import { BookingFunnelEvent } from './entities/booking-funnel-event.entity';
import { describeFunnelFailure, resolveFunnelSession } from './funnel-request.util';
import { FunnelTrackerService } from './funnel-tracker.service';
import { FunnelService } from './funnel.service';

/**
 * ADR-0081 — الفنل هو الرد المباشر على سؤال المالك «الفلو بيتكسر فين؟»، فالاختبار هنا بيبني
 * رحلات حقيقية بأرقام معروفة وبيتأكد إن التقرير بيقولها بالظبط:
 *
 * - عدّ **بالمحاولة** قبل الطلب و**بالطلب** بعده، والاتنين بيتقابلوا عند `order_placed`.
 * - التسرّب بين كل مرحلتين، وأسوأ نقطة تسرّب.
 * - المحاولات **الفاشلة** متفصولة عن اللي انسحبوا — دول سؤالين مختلفين تمامًا.
 * - المراحل بعد الطلب بتتحسب من `order_status_history` مش من الجدول (مصدر حقيقة واحد).
 */
describe('FunnelService + FunnelTracker (ADR-0081) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let funnel: FunnelService;
  let tracker: FunnelTrackerService;

  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    otherService: '',
    customerUser: '',
    customerProfile: '',
    address: '',
  };
  const orders: string[] = [];
  /** كل رحلة اختبار ليها UUID خاص بيها عشان الاختبارات ماتتلخبطش مع بعض ولا مع بيانات قديمة. */
  const sessions: string[] = [];
  let windowStart: Date;

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  const session = (): string => {
    const value = crypto.randomUUID();
    sessions.push(value);
    return value;
  };

  async function makeOrder(status: string[] = []): Promise<string> {
    const [order] = await q<{ id: string }[]>(
      `INSERT INTO orders (commission_rate_applied,order_number, customer_id, service_id, address_id, service_zone_id,
                           order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode)
       VALUES (20,$1,$2,$3,$4,$5,'searching_technician','pending',30000,0,'individual') RETURNING id`,
      [`FNL-${runId}-${orders.length}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    orders.push(order.id);
    for (const s of status) {
      await q(
        `INSERT INTO order_status_history (order_id, new_status, change_source) VALUES ($1, $2::order_status, 'system')`,
        [order.id, s],
      );
    }
    return order.id;
  }

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [BookingFunnelEvent],
    }).initialize();
    funnel = new FunnelService(dataSource);
    tracker = new FunnelTrackerService(dataSource.getRepository(BookingFunnelEvent));

    const [country] = await q<{ id: string }[]>(
      `INSERT INTO countries (name_ar, name_en, iso_code, currency_code, phone_prefix)
       VALUES ($1,$2,$3,'EGP','+20') RETURNING id`,
      [`دولة فنل ${runId}`, `Funnel Country ${runId}`, runId.slice(-2).toUpperCase()],
    );
    ids.country = country.id;
    const [city] = await q<{ id: string }[]>(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة فنل ${runId}`, `Funnel City ${runId}`, `fnl-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q<{ id: string }[]>(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [city.id, `نطاق فنل ${runId}`, `Funnel Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q<{ id: string }[]>(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة فنل ${runId}`, `Funnel Category ${runId}`, `fnl-cat-${runId}`],
    );
    ids.category = category.id;
    const mkService = async (label: string): Promise<string> => {
      const [row] = await q<{ id: string }[]>(
        `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
         VALUES ($1,$2,$3,'formula',30000,20,0) RETURNING id`,
        [category.id, `خدمة ${label} ${runId}`, `fnl-svc-${label}-${runId}`],
      );
      return row.id;
    };
    ids.service = await mkService('أ');
    ids.otherService = await mkService('ب');

    const [customerUser] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+20f${runId}`.slice(0, 15), `عميل فنل ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [profile] = await q<{ id: string }[]>(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
      [customerUser.id],
    );
    ids.customerProfile = profile.id;
    const [address] = await q<{ id: string }[]>(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع فنل ${runId}`],
    );
    ids.address = address.id;
  });

  beforeEach(() => {
    // النافذة بتبدأ **لحظة** بداية الاختبار — فبيانات الاختبارات اللي فاتت مابتدخلش في
    // الحساب. `occurred_at` بيتحط من Node زي الـwindow دي بالظبط، فمفيش فرق ساعات بين
    // التطبيق والقاعدة يلخبط المقارنة.
    windowStart = new Date();
  });

  afterAll(async () => {
    // لازم الأحداث تتمسح قبل الخدمات — الأحداث بلا `funnel_session_id` (اختبار التغطية)
    // مربوطة بالخدمة بمفتاح أجنبي، وكانت بتمنع حذفها.
    await q(
      `DELETE FROM booking_funnel_events
        WHERE funnel_session_id = ANY($1::uuid[]) OR order_id = ANY($2::uuid[]) OR service_id = ANY($3::uuid[])`,
      [sessions, orders, [ids.service, ids.otherService]],
    );
    await q(`DELETE FROM order_status_history WHERE order_id = ANY($1)`, [orders]);
    await q(`DELETE FROM orders WHERE id = ANY($1)`, [orders]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.service, ids.otherService]]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    await dataSource.destroy();
  });

  const now = (): Date => new Date(Date.now() + 1000);
  const stage = (report: Awaited<ReturnType<FunnelService['bookingFunnel']>>, name: string) =>
    report.stages.find((s) => s.stage === name)!;

  describe('التتبّع نفسه', () => {
    it('بيكتب الحدث بكل حقوله', async () => {
      const sid = session();
      await tracker.track({
        stage: 'price_previewed',
        source: 'server',
        funnelSessionId: sid,
        userId: ids.customerUser,
        serviceId: ids.service,
        cityId: ids.city,
        clientChannel: OrderSourceChannel.WEB,
      });

      const [row] = await q<Record<string, unknown>[]>(
        `SELECT stage, source, outcome, failure_reason, user_id, service_id, city_id, client_channel
           FROM booking_funnel_events WHERE funnel_session_id = $1`,
        [sid],
      );
      expect(row).toMatchObject({
        stage: 'price_previewed',
        source: 'server',
        outcome: 'success',
        failure_reason: null,
        user_id: ids.customerUser,
        service_id: ids.service,
        city_id: ids.city,
        client_channel: 'web',
      });
    });

    it('**فشل التتبّع مايرميش أبدًا** — إحصائية ناقصة مقبولة، حجز اتعطّل لأ', async () => {
      const broken = new FunnelTrackerService({
        insert: () => Promise.reject(new Error('القاعدة وقعت')),
      } as never);
      // لو ده رمى، كان معناه إن `POST /orders` بيفشل لما جدول تحليلات يبوظ.
      await expect(broken.track({ stage: 'order_placed', source: 'server' })).resolves.toBeUndefined();
    });

    it('سبب فشل أطول من العمود بيتقص بدل ما يرمي على مستوى القاعدة', async () => {
      const sid = session();
      await tracker.track({
        stage: 'price_previewed',
        source: 'server',
        funnelSessionId: sid,
        outcome: 'failed',
        failureReason: 'x'.repeat(400),
      });
      const [row] = await q<{ failure_reason: string }[]>(
        `SELECT failure_reason FROM booking_funnel_events WHERE funnel_session_id = $1`,
        [sid],
      );
      expect(row.failure_reason).toHaveLength(120);
    });

    it('فشل بلا سبب بياخد سبب افتراضي — القيد في القاعدة بيرفض «فشل بلا سبب»', async () => {
      const sid = session();
      await tracker.track({ stage: 'order_placed', source: 'server', funnelSessionId: sid, outcome: 'failed' });
      const [row] = await q<{ failure_reason: string | null }[]>(
        `SELECT failure_reason FROM booking_funnel_events WHERE funnel_session_id = $1`,
        [sid],
      );
      expect(row?.failure_reason).toBe('unknown');
    });
  });

  describe('الفنل الكامل', () => {
    it('بيعد المراحل صح وبيحسب التسرّب وبيحدد أسوأ نقطة', async () => {
      // ٤ محاولات شافت السعر، ٣ منهم شافوا الفنيين، واحد بس عمل طلب.
      const attempts = [session(), session(), session(), session()];
      for (const sid of attempts) {
        await tracker.track({ stage: 'price_previewed', source: 'server', funnelSessionId: sid, serviceId: ids.service });
      }
      for (const sid of attempts.slice(0, 3)) {
        await tracker.track({ stage: 'providers_viewed', source: 'server', funnelSessionId: sid, serviceId: ids.service });
      }
      const orderId = await makeOrder(['technician_assigned', 'technician_arrived', 'completed']);
      await tracker.track({
        stage: 'order_placed',
        source: 'server',
        funnelSessionId: attempts[0],
        serviceId: ids.service,
        orderId,
      });

      const report = await funnel.bookingFunnel(windowStart, now());

      expect(stage(report, 'price_previewed').count).toBe(4);
      expect(stage(report, 'providers_viewed').count).toBe(3);
      expect(stage(report, 'order_placed').count).toBe(1);

      // التسرّب: ١ من ٤ بين السعر والفنيين، و٢ من ٣ بين الفنيين والطلب.
      expect(stage(report, 'providers_viewed').dropped_from_previous).toBe(1);
      expect(stage(report, 'providers_viewed').drop_rate_from_previous).toBe(25);
      expect(stage(report, 'order_placed').dropped_from_previous).toBe(2);
      expect(stage(report, 'order_placed').drop_rate_from_previous).toBeCloseTo(66.67, 1);

      // أسوأ نقطة تسرّب = الرد المباشر على «الفلو بيتكسر فين؟».
      expect(report.worst_drop?.stage).toBe('order_placed');
      expect(report.worst_drop?.dropped).toBe(2);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // بلاغ المالك 2026-09-11: «شاف الخدمة عدده أقل من شاف الفنيين» — فنل صاعد.
    //
    // السبب: العد كان `COALESCE(order_id, funnel_session_id, id)`، و`id` مفتاح الصف —
    // **فريد لكل صف بحكم التعريف**. فأي حدث بلا معرّف محاولة كان بيتعد «محاولة» لوحده،
    // والمرحلة بتتضخّم بعدد النداءات مش بعدد الناس.
    // ═══════════════════════════════════════════════════════════════════════
    it('أحداث بلا معرّف محاولة مابتتعدّش كمحاولات — ومابتتخبّاش', async () => {
      // شخص واحد (محاولة واحدة) شاف السعر، مقابل ٥ أحداث مجهولة لنفس المرحلة.
      const real = session();
      await tracker.track({ stage: 'price_previewed', source: 'server', funnelSessionId: real, serviceId: ids.service });
      for (let i = 0; i < 5; i++) {
        await tracker.track({ stage: 'price_previewed', source: 'server', funnelSessionId: null, serviceId: ids.service });
      }

      const report = await funnel.bookingFunnel(windowStart, now());
      const row = stage(report, 'price_previewed');

      // قبل الإصلاح كان بيطلع ٦ (١ + ٥ صفوف كل واحد «محاولة»).
      expect(row.count).toBe(1);
      // ومابتتخبّاش: الأدمن لازم يفرّق بين «مفيش حركة» و«حركة مش متتبّعة».
      expect(row.untracked_count).toBe(5);
    });

    it('تكرار نفس المرحلة في نفس المحاولة بيتعد مرة واحدة (الرجوع بالسهم مايضخّمش)', async () => {
      // السيناريو اللي وصفه المالك بالحرف: العميل بيرجع بالسهم كذا مرة، فالشاشة بتعيد
      // النداء. نفس معرّف المحاولة ⇒ محاولة واحدة مهما تكرر النداء.
      const sid = session();
      for (let i = 0; i < 7; i++) {
        await tracker.track({ stage: 'providers_viewed', source: 'server', funnelSessionId: sid, serviceId: ids.service });
      }

      const report = await funnel.bookingFunnel(windowStart, now());
      expect(stage(report, 'providers_viewed').count).toBe(1);
      expect(stage(report, 'providers_viewed').untracked_count).toBe(0);
    });

    it('الفنل مايصعدش: كل مرحلة أقل من أو تساوي اللي قبلها لمحاولات معروفة', async () => {
      // ٣ محاولات كاملة من أول مرحلة لآخر واحدة قبل الطلب — الشكل الطبيعي للفنل.
      const attempts = [session(), session(), session()];
      for (const sid of attempts) {
        await tracker.track({ stage: 'service_viewed', source: 'client', funnelSessionId: sid, serviceId: ids.service });
      }
      for (const sid of attempts.slice(0, 2)) {
        await tracker.track({ stage: 'price_previewed', source: 'server', funnelSessionId: sid, serviceId: ids.service });
      }
      await tracker.track({
        stage: 'providers_viewed',
        source: 'server',
        funnelSessionId: attempts[0],
        serviceId: ids.service,
      });

      const report = await funnel.bookingFunnel(windowStart, now());
      const ordered = ['service_viewed', 'price_previewed', 'providers_viewed'].map((st) => stage(report, st).count);

      for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i]).toBeLessThanOrEqual(ordered[i - 1]);
      }
    });

    it('المراحل بعد الطلب بتتحسب من `order_status_history` مش من الجدول', async () => {
      const done = await makeOrder(['technician_assigned', 'technician_arrived', 'completed']);
      const arrivedOnly = await makeOrder(['technician_assigned', 'technician_arrived']);
      const assignedOnly = await makeOrder(['technician_assigned']);
      const neverAssigned = await makeOrder([]);

      for (const orderId of [done, arrivedOnly, assignedOnly, neverAssigned]) {
        await tracker.track({
          stage: 'order_placed',
          source: 'server',
          funnelSessionId: session(),
          serviceId: ids.service,
          orderId,
        });
      }

      const report = await funnel.bookingFunnel(windowStart, now());
      expect(stage(report, 'order_placed').count).toBe(4);
      expect(stage(report, 'technician_assigned').count).toBe(3);
      expect(stage(report, 'technician_arrived').count).toBe(2);
      expect(stage(report, 'order_completed').count).toBe(1);
      expect(stage(report, 'order_completed').trust).toBe('derived');
    });

    it('**المحاولات الفاشلة متفصولة عن اللي انسحبوا** — دول سؤالين مختلفين', async () => {
      const ok = session();
      const failed = session();
      await tracker.track({ stage: 'price_previewed', source: 'server', funnelSessionId: ok, serviceId: ids.service });
      await tracker.track({
        stage: 'price_previewed',
        source: 'server',
        funnelSessionId: failed,
        serviceId: ids.service,
        outcome: 'failed',
        failureReason: ErrorCode.ORDR_001,
      });

      const report = await funnel.bookingFunnel(windowStart, now());
      // الفاشلة مش داخلة في عدّاد اللي «وصلوا للمرحلة» — لأنهم فعليًا ما وصلوش لنتيجة.
      expect(stage(report, 'price_previewed').count).toBe(1);
      expect(stage(report, 'price_previewed').failed_count).toBe(1);
      expect(report.top_failures).toContainEqual({
        stage: 'price_previewed',
        failure_reason: ErrorCode.ORDR_001,
        count: 1,
      });
    });

    it('مصدر كل مرحلة بيتعرض عشان القارئ يعرف الرقم ده يعتمد على إيه', async () => {
      const sid = session();
      await tracker.track({ stage: 'service_viewed', source: 'client', funnelSessionId: sid, serviceId: ids.service });
      await tracker.track({ stage: 'price_previewed', source: 'server', funnelSessionId: sid, serviceId: ids.service });

      const report = await funnel.bookingFunnel(windowStart, now());
      expect(stage(report, 'service_viewed').trust).toBe('client');
      expect(stage(report, 'price_previewed').trust).toBe('server');
    });

    // **الاختبار ده كان بيثبّت السلوك الغلط** (بلاغ المالك 2026-09-11): كان بيتوقّع إن حدث
    // بلا معرّف محاولة يتعد «١» في المرحلة. ده بالظبط اللي كان بيخلّي الفنل يصعد — حدث
    // مجهول واحد بيتعد محاولة، فعشرة أحداث مجهولة بيبقوا عشر «محاولات» وهُمّا ممكن يكونوا
    // شخص واحد بيرجع بالسهم. التوقّع الصح: مايدخلش العدّاد، ويتعرض منفصل.
    it('محاولة بلا معرّف رحلة مابتتعدّش في المرحلة — بتتعرض كحركة مجهولة', async () => {
      await tracker.track({ stage: 'price_previewed', source: 'server', serviceId: ids.service });
      const report = await funnel.bookingFunnel(windowStart, now());
      expect(stage(report, 'price_previewed').count).toBe(0);
      expect(stage(report, 'price_previewed').untracked_count).toBe(1);
      expect(report.sessions_untracked).toBe(1);
      expect(report.sessions_tracked).toBe(0);
    });

    it('نفس الرحلة بتسجّل نفس المرحلة مرتين = محاولة واحدة (retry مايضخّمش الرقم)', async () => {
      const sid = session();
      await tracker.track({ stage: 'price_previewed', source: 'server', funnelSessionId: sid, serviceId: ids.service });
      await tracker.track({ stage: 'price_previewed', source: 'server', funnelSessionId: sid, serviceId: ids.service });

      const report = await funnel.bookingFunnel(windowStart, now());
      expect(stage(report, 'price_previewed').count).toBe(1);
    });

    it('برّه المدى الزمني مابيتحسبش', async () => {
      const sid = session();
      await tracker.track({ stage: 'price_previewed', source: 'server', funnelSessionId: sid, serviceId: ids.service });
      await q(`UPDATE booking_funnel_events SET occurred_at = now() - interval '40 days' WHERE funnel_session_id = $1`, [
        sid,
      ]);

      const report = await funnel.bookingFunnel(windowStart, now());
      expect(stage(report, 'price_previewed').count).toBe(0);
    });
  });

  describe('الفنل بالخدمة — «أنهي خدمة بتخسر ناس؟»', () => {
    it('بيرجّع نسبة التحويل لكل خدمة على حدة', async () => {
      // خدمة أ: محاولتين، طلب واحد (٥٠٪). خدمة ب: محاولتين، صفر طلبات.
      for (const serviceId of [ids.service, ids.service, ids.otherService, ids.otherService]) {
        await tracker.track({ stage: 'price_previewed', source: 'server', funnelSessionId: session(), serviceId });
      }
      const orderId = await makeOrder([]);
      await tracker.track({
        stage: 'order_placed',
        source: 'server',
        funnelSessionId: session(),
        serviceId: ids.service,
        orderId,
      });

      const rows = await funnel.funnelByService(windowStart, now());
      const good = rows.find((r) => r.service_id === ids.service);
      const bad = rows.find((r) => r.service_id === ids.otherService);
      expect(good?.conversion_pct).toBe(50);
      expect(bad?.conversion_pct).toBe(0);
      expect(bad?.started).toBe(2);
    });
  });

  describe('الهيدرز والأسباب', () => {
    it('معرّف رحلة مش UUID بيترفض بدل ما يوصل للقاعدة ويضيّع الحدث', () => {
      const valid = crypto.randomUUID();
      expect(resolveFunnelSession(valid.toUpperCase())).toBe(valid);
      expect(resolveFunnelSession('not-a-uuid')).toBeNull();
      expect(resolveFunnelSession(undefined)).toBeNull();
      expect(resolveFunnelSession('   ')).toBeNull();
    });

    it('سبب الفشل بيبقى كود قابل للتجميع مش نص رسالة (فيه بيانات عميل وبيكسر GROUP BY)', () => {
      expect(describeFunnelFailure(new ApiException(ErrorCode.ORDR_002, 'مفيش فنيين في منطقة المعادي'))).toBe(
        ErrorCode.ORDR_002,
      );
      expect(describeFunnelFailure(new Error('boom'))).toBe('internal_error');
    });
  });

  it('غلاف fire-and-forget بيكتب فعلاً (مش بيضيع الوعد بصمت)', async () => {
    const sid = session();
    tracker.trackDetached({ stage: 'booking_started', source: 'client', funnelSessionId: sid });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const [row] = await q<{ count: string }[]>(
      `SELECT COUNT(*) FROM booking_funnel_events WHERE funnel_session_id = $1`,
      [sid],
    );
    expect(Number(row.count)).toBe(1);
  });
});
