import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { WorkforceAnalyticsService } from './workforce-analytics.service';

/**
 * إحصائيات-٤ — إحصائيات القوى العاملة (ADR-0081).
 *
 * الاختبار كله **مقصور على شركة اختبار واحدة** (`companyId`)، مش على القاعدة كلها. السبب عملي:
 * قاعدة التطوير فيها مئات الفنيين من سبيكات تانية، فأي رقم مجمّع على القاعدة كلها كان هيبقى
 * متغيّر كل تشغيلة والاختبار يبقى إما كاذب أو هش. الفلتر ده هو **نفسه** اللي بيخدم لوحة مالك
 * الشركة، فاختباره هنا مش التفاف على المشكلة — ده تغطية للمسار الحقيقي.
 *
 * وكل قيمة متوقّعة هنا محسوبة بالإيد من البذور اللي فوق، مش مأخوذة من ناتج الخدمة نفسها.
 */
describe('WorkforceAnalyticsService — إحصائيات القوى العاملة (ADR-0081) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: WorkforceAnalyticsService;

  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    area: '',
    zone: '',
    category: '',
    service: '',
    company: '',
    ownerUser: '',
    leadUser: '',
    leadProfile: '',
    assistantUser: '',
    assistantProfile: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    reason: '',
    leadWallet: '',
    assistantWallet: '',
  };
  const orders: string[] = [];

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  /**
   * تنضيف مقاوم للفشل الجزئي: لو `beforeAll` وقع في النص، المعرّفات اللي ما اتملتش بتفضل `''`
   * و`= ANY(ARRAY[''])` بيرمي «invalid input syntax for uuid» فيوقف باقي التنضيف ويسيب زبالة
   * بتكسر التشغيلة الجاية. الفلتر ده بيخلّي كل سطر تنضيف يعدّي لوحده.
   */
  const del = async (sql: string, values: (string | undefined)[]): Promise<void> => {
    const clean = values.filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (clean.length === 0) return;
    await q(sql, [clean]);
  };

  /** القدرة اليومية ثابتة في الاختبار (٧٢٠ دقيقة = ١٢ ساعة) عشان الاستغلال يبقى رقم متوقّع. */
  const settings = { getNumber: async (_key: string, fallback: number) => fallback } as unknown as SettingsService;

  /** نافذة يومين في المستقبل البعيد — مستحيل تتقاطع مع بيانات تانية في القاعدة. */
  const from = new Date('2032-05-10T00:00:00Z');
  const to = new Date('2032-05-12T00:00:00Z');

  interface OrderSeed {
    status: string;
    placedAt: string;
    completedAt?: string | null;
    paidAt?: string | null;
    paymentStatus?: string;
    total?: number;
    commission?: number;
    earning?: number;
    onTime?: boolean | null;
    durationMinutes?: number | null;
    durationHours?: number | null;
    parentOrderId?: string | null;
    leaderId?: string | null;
  }

  async function makeOrder(seed: OrderSeed): Promise<string> {
    const [order] = await q<{ id: string }[]>(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id, address_id,
                           service_zone_id, order_status, payment_status, total_amount_cents, platform_commission_cents,
                           technician_earning_cents, booking_mode, placed_at, assigned_at, work_completed_at, paid_at,
                           was_on_time, duration_minutes, duration_hours, parent_order_id,
                           worker_pool_cents, calculation_algorithm_version)
       VALUES (20, $1, $2, $3, $4, $5, $6, $7::order_status, $8::order_payment_status, $9, $10, $11, 'individual',
               $12::timestamptz, $12::timestamptz, $13::timestamptz, $14::timestamptz, $15, $16, $17, $18, $11, 'v2')
       RETURNING id`,
      [
        `WF-${runId}-${orders.length}`.slice(0, 24),
        ids.customerProfile,
        seed.leaderId === null ? null : (seed.leaderId ?? ids.leadProfile),
        ids.service,
        ids.address,
        ids.zone,
        seed.status,
        seed.paymentStatus ?? 'unpaid',
        seed.total ?? 0,
        seed.commission ?? 0,
        seed.earning ?? 0,
        seed.placedAt,
        seed.completedAt ?? null,
        seed.paidAt ?? null,
        seed.onTime ?? null,
        seed.durationMinutes ?? null,
        seed.durationHours ?? null,
        seed.parentOrderId ?? null,
      ],
    );
    orders.push(order.id);
    return order.id;
  }

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    }).initialize();
    service = new WorkforceAnalyticsService(dataSource, settings);

    const [country] = await q<{ id: string }[]>(
      `INSERT INTO countries (name_ar, name_en, iso_code, currency_code, phone_prefix)
       VALUES ($1,$2,$3,'EGP','+20') RETURNING id`,
      [`دولة WF ${runId}`, `WF Country ${runId}`, runId.slice(-2).toUpperCase()],
    );
    ids.country = country.id;
    const [city] = await q<{ id: string }[]>(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة WF ${runId}`, `WF City ${runId}`, `wf-city-${runId}`],
    );
    ids.city = city.id;
    const [area] = await q<{ id: string }[]>(
      `INSERT INTO areas (city_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [city.id, `منطقة WF ${runId}`, `WF Area ${runId}`, `wf-area-${runId}`],
    );
    ids.area = area.id;
    const [zone] = await q<{ id: string }[]>(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [city.id, `نطاق WF ${runId}`, `WF Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [category] = await q<{ id: string }[]>(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة WF ${runId}`, `WF Category ${runId}`, `wf-cat-${runId}`],
    );
    ids.category = category.id;
    const [svc] = await q<{ id: string }[]>(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',30000,20,0) RETURNING id`,
      [category.id, `خدمة WF ${runId}`, `wf-svc-${runId}`],
    );
    ids.service = svc.id;

    // الرقم لاتيني بالكامل: الاسم العربي بيتحسب بالمحارف، والقصّ على ١٥ كان بيقصّ `runId` نفسه
    // فتشغيلتين قريبتين بيتصادموا على `users_phone_number_key`.
    let userSeq = 0;
    const mkUser = async (label: string, type: string): Promise<string> => {
      const [user] = await q<{ id: string }[]>(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,$3::user_type) RETURNING id`,
        [`+2019${runId}${userSeq++}`.slice(0, 15), `${label} ${runId}`, type],
      );
      return user.id;
    };

    ids.ownerUser = await mkUser('مالك', 'technician');
    const [company] = await q<{ id: string }[]>(
      `INSERT INTO technician_companies (owner_user_id, name) VALUES ($1,$2) RETURNING id`,
      [ids.ownerUser, `شركة WF ${runId}`],
    );
    ids.company = company.id;

    ids.leadUser = await mkUser('صنايعي', 'technician');
    const [lead] = await q<{ id: string }[]>(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status, approved_at, company_id,
                                        technician_kind, current_level, home_area_id)
       VALUES ($1,$2,'approved',$3::timestamptz,$4,'technician','professional',$5) RETURNING id`,
      [ids.leadUser, `WFL-${runId}`.slice(0, 20), '2032-01-01T00:00:00Z', ids.company, ids.area],
    );
    ids.leadProfile = lead.id;

    // المساعد اتعمد **نص النافذة** — عشان نثبت إن القدرة بتتناسب مع تاريخ الاعتماد.
    ids.assistantUser = await mkUser('مساعد', 'technician');
    const [assistant] = await q<{ id: string }[]>(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status, approved_at, company_id,
                                        technician_kind, current_level, home_area_id)
       VALUES ($1,$2,'approved',$3::timestamptz,$4,'assistant','new',$5) RETURNING id`,
      [ids.assistantUser, `WFA-${runId}`.slice(0, 20), '2032-05-11T00:00:00Z', ids.company, ids.area],
    );
    ids.assistantProfile = assistant.id;

    ids.customerUser = await mkUser('عميل', 'customer');
    const [customer] = await q<{ id: string }[]>(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
      [ids.customerUser],
    );
    ids.customerProfile = customer.id;
    const [address] = await q<{ id: string }[]>(
      `INSERT INTO addresses (user_id, area_id, city_id, street_name, location)
       VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.area, ids.city, `شارع WF ${runId}`],
    );
    ids.address = address.id;

    // ═══ الطلبات ═══
    // ١) مكتمل ومدفوع، في الميعاد، ٢٤٠ دقيقة — والمساعد معاه في الطاقم.
    const completed = await makeOrder({
      status: 'completed',
      paymentStatus: 'paid',
      placedAt: '2032-05-10T08:00:00Z',
      completedAt: '2032-05-10T12:00:00Z',
      paidAt: '2032-05-10T12:30:00Z',
      total: 100_000,
      commission: 20_000,
      earning: 80_000,
      onTime: true,
      durationMinutes: 240,
    });
    await q(
      `INSERT INTO order_team_members (order_id, technician_id, role_label, member_type, added_by_technician_id)
       VALUES ($1,$2,'مساعد','assistant',$3)`,
      [completed, ids.assistantProfile, ids.leadProfile],
    );

    // ٢) مكتمل بس **متأخر**، والمدة متسعّرة **بالساعة** بس (٣ ساعات) — ده اللي بيثبت إن
    // `duration_hours` بقت داخلة في الاستغلال بعد ما كانت بتتحسب صفر.
    const hourly = await makeOrder({
      status: 'completed',
      placedAt: '2032-05-11T08:00:00Z',
      completedAt: '2032-05-11T11:00:00Z',
      onTime: false,
      durationHours: 3,
    });

    // ٣) إعادة زيارة على الطلب المكتمل الأول — بتتنسب لصاحب الشغل الأصلي.
    await makeOrder({
      status: 'in_progress',
      placedAt: '2032-05-11T14:00:00Z',
      parentOrderId: completed,
      durationMinutes: 60,
    });

    // حصص الأرباح: القائد ٦٠٠٠٠ والمساعد ٢٠٠٠٠ من الطلب المدفوع.
    for (const [techId, role, share] of [
      [ids.leadProfile, 'leader', 60_000],
      [ids.assistantProfile, 'assistant', 20_000],
    ] as [string, string, number][]) {
      await q(
        `INSERT INTO order_earning_shares (order_id, technician_id, participant_role, technician_level, share_weight,
                                           pool_cents, share_cents, settlement_policy_version, calculation_method)
         VALUES ($1,$2,$3,'professional',1,80000,$4,1,'weighted_pool')`,
        [completed, techId, role, share],
      );
    }

    // عروض المطابقة: ٤ اتبعتوا للقائد، ٢ اتقبلوا — نسبة القبول ٥٠٪.
    for (const [i, status] of ['accepted', 'accepted', 'rejected', 'timeout'].entries()) {
      await q(
        `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at,
                                        responded_at, expires_at)
         VALUES ($1,$2,1,$3::order_assignment_status,$4::timestamptz,$5::timestamptz,$6::timestamptz)`,
        [
          completed,
          ids.leadProfile,
          status,
          `2032-05-10T07:0${i}:00Z`,
          status === 'timeout' ? null : `2032-05-10T07:0${i}:40Z`, // ٤٠ ثانية للرد
          '2032-05-10T07:30:00Z',
        ],
      );
    }

    const [reason] = await q<{ id: string }[]>(
      `INSERT INTO cancellation_reasons (reason_ar, reason_en, applies_to) VALUES ($1,$2,'technician') RETURNING id`,
      [`سبب WF ${runId}`, `WF reason ${runId}`],
    );
    ids.reason = reason.id;
    await q(
      `INSERT INTO technician_order_cancellations (order_id, technician_id, technician_user_id, cancellation_reason_id,
                                                   booking_mode, accepted_at, cancelled_at,
                                                   elapsed_seconds_after_acceptance, within_policy_window, recovery_action)
       VALUES ($1,$2,$3,$4,'individual','2032-05-11T09:00:00Z','2032-05-11T09:30:00Z',1800,true,'rebroadcast')`,
      [completed, ids.leadProfile, ids.leadUser, ids.reason],
    );

    // تقييمان للقائد: ٥ و٣ ⇒ المتوسط ٤. (تقييم واحد لكل طلب — `ratings_order_id_key`.)
    for (const [orderId, score] of [
      [completed, 5],
      [hourly, 3],
    ] as [string, number][]) {
      await q(
        `INSERT INTO ratings (order_id, rated_by_user_id, rated_user_id, rating_type, overall_rating, created_at)
         VALUES ($1,$2,$3,'customer_to_technician',$4,'2032-05-11T12:00:00Z')`,
        [orderId, ids.customerUser, ids.leadUser, score],
      );
    }

    await q(
      `INSERT INTO complaints (complaint_number, order_id, filed_by_user_id, against_user_id, category, title,
                               description, sla_due_at, created_at)
       VALUES ($1,$2,$3,$4,'poor_quality',$5,$6,'2032-05-13T00:00:00Z','2032-05-11T13:00:00Z')`,
      [`WFC-${runId}`.slice(0, 24), completed, ids.customerUser, ids.leadUser, 'شكوى اختبار', 'وصف شكوى الاختبار'],
    );

    // القائد مديون ٧٠٠٠٠ (فوق عتبة ٥٠٠٠٠)، والمساعد رصيده موجب.
    const [lw] = await q<{ id: string }[]>(
      `INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ($1,'technician',-70000) RETURNING id`,
      [ids.leadUser],
    );
    ids.leadWallet = lw.id;
    const [aw] = await q<{ id: string }[]>(
      `INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ($1,'technician',15000) RETURNING id`,
      [ids.assistantUser],
    );
    ids.assistantWallet = aw.id;
  });

  afterAll(async () => {
    await q(`DELETE FROM complaints WHERE order_id = ANY($1)`, [orders]);
    await q(`DELETE FROM ratings WHERE order_id = ANY($1)`, [orders]);
    await q(`DELETE FROM technician_order_cancellations WHERE order_id = ANY($1)`, [orders]);
    await del(`DELETE FROM cancellation_reasons WHERE id = ANY($1)`, [ids.reason]);
    await q(`DELETE FROM order_assignments WHERE order_id = ANY($1)`, [orders]);
    await q(`DELETE FROM order_earning_shares WHERE order_id = ANY($1)`, [orders]);
    await q(`DELETE FROM order_team_members WHERE order_id = ANY($1)`, [orders]);
    await q(`DELETE FROM orders WHERE id = ANY($1)`, [orders]);
    await del(`DELETE FROM wallets WHERE id = ANY($1)`, [ids.leadWallet, ids.assistantWallet]);
    await del(`DELETE FROM addresses WHERE id = ANY($1)`, [ids.address]);
    await del(`DELETE FROM customer_profiles WHERE id = ANY($1)`, [ids.customerProfile]);
    await del(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [ids.leadProfile, ids.assistantProfile]);
    await del(`DELETE FROM technician_companies WHERE id = ANY($1)`, [ids.company]);
    await del(`DELETE FROM users WHERE id = ANY($1)`, [
      ids.ownerUser,
      ids.leadUser,
      ids.assistantUser,
      ids.customerUser,
    ]);
    await del(`DELETE FROM services WHERE id = ANY($1)`, [ids.service]);
    await del(`DELETE FROM service_categories WHERE id = ANY($1)`, [ids.category]);
    await del(`DELETE FROM service_zones WHERE id = ANY($1)`, [ids.zone]);
    await del(`DELETE FROM areas WHERE id = ANY($1)`, [ids.area]);
    await del(`DELETE FROM cities WHERE id = ANY($1)`, [ids.city]);
    await del(`DELETE FROM countries WHERE id = ANY($1)`, [ids.country]);
    await dataSource.destroy();
  });

  const snapshot = () => service.supplySnapshot(from, to, ids.company);
  const cards = (sort?: 'completed' | 'earnings' | 'utilization' | 'rating' | 'idle' | 'debt') =>
    service.technicianScorecards(from, to, { companyId: ids.company, sort });
  const cardOf = async (technicianId: string, sort?: Parameters<typeof cards>[0]) => {
    const result = await cards(sort);
    return result.technicians.find((t) => t.technician_id === technicianId)!;
  };

  describe('لقطة العرض', () => {
    it('عدد الرؤوس بيتقسّم صنايعي/مساعد ومابيعدّش المحذوف', async () => {
      const snap = await snapshot();
      expect(snap.headcount.approved).toBe(2);
      expect(snap.headcount.approved_technicians).toBe(1);
      expect(snap.headcount.approved_assistants).toBe(1);
      expect(snap.headcount.in_pipeline).toBe(0);
    });

    it('«انضم في الفترة» بيعد اللي اتعمد جوّه النافذة بس', async () => {
      // القائد اتعمد في يناير، المساعد يوم ١١ مايو — واحد بس جوّه النافذة.
      const snap = await snapshot();
      expect(snap.headcount.new_joiners).toBe(1);
    });

    it('توزيع المستويات بيتحسب من الجدول مش من قايمة مكتوبة', async () => {
      const snap = await snapshot();
      expect(snap.by_level).toEqual(
        expect.arrayContaining([
          { level: 'professional', count: 1 },
          { level: 'new', count: 1 },
        ]),
      );
    });

    it('المشاركة بتشمل عضو الطاقم — الاتنين نشطين مش واحد', async () => {
      // لو الحساب كان بيقرا orders.technician_id بس، المساعد كان هيبان صفر شغل.
      const snap = await snapshot();
      expect(snap.active_in_period).toBe(2);
    });

    it('الدقايق المحجوزة بتجمع الطلبات المتسعّرة بالدقيقة **وبالساعة**', async () => {
      // القائد: ٢٤٠ + ١٨٠ + ٦٠ = ٤٨٠. المساعد: ٢٤٠ (الطلب اللي هو في طاقمه). الإجمالي ٧٢٠.
      const snap = await snapshot();
      expect(snap.booked_minutes).toBe(720);
    });

    it('القدرة = المعتمدون × القدرة اليومية × أيام الفترة، والاستغلال نسبتها', async () => {
      const snap = await snapshot();
      expect(snap.capacity_minutes).toBe(2 * 720 * 2);
      expect(snap.utilization_percent).toBe(25);
    });

    it('المديونية بتتقرا كرصيد محفظة سالب، والعتبة بتتقال مع الرقم', async () => {
      const snap = await snapshot();
      expect(snap.debt.technicians_in_debt).toBe(1);
      expect(snap.debt.total_debt_cents).toBe(70_000);
      expect(snap.debt.above_threshold).toBe(1);
      expect(snap.debt.threshold_cents).toBe(50_000);
    });

    it('«نشط» و«واقف» بنفس المسطرة — مجموعهم = المعتمدون بالظبط', async () => {
      // الحارس ده بيقفل بَقّة حقيقية اتلقطت بصريًا: الواقف كان بيتقاس بـ«شغل خلص» والنشط
      // بـ«شغل اتحجز»، فالفني اللي ماسك شغلانة شغّالة كان بيتعدّ في الاتنين.
      const snap = await snapshot();
      expect(snap.idle_approved).toBe(0);
      expect(snap.active_in_period + snap.idle_approved).toBe(snap.headcount.approved);
    });

    it('غير المعتمد مايدخلش في البسط ولا المقام — الاستغلال مايتضخّمش', async () => {
      // بنعلّق اعتماد المساعد: بيخرج من المعتمدين، ولازم شغله يخرج من الدقايق المحجوزة كمان،
      // وإلا القدرة (على المعتمدين) والحمل (على الكل) بيتقاسوا بمجموعتين مختلفتين.
      await q(`UPDATE technician_profiles SET verification_status = 'suspended' WHERE id = $1`, [
        ids.assistantProfile,
      ]);
      const suspended = await snapshot();
      expect(suspended.headcount.approved).toBe(1);
      expect(suspended.booked_minutes).toBe(480); // شغل القائد بس، من غير الـ٢٤٠ بتاعة المساعد
      expect(suspended.active_in_period + suspended.idle_approved).toBe(1);

      await q(`UPDATE technician_profiles SET verification_status = 'approved' WHERE id = $1`, [
        ids.assistantProfile,
      ]);
    });

    it('نافذة بلا أي شغل بتقول صفر محجوز ومابتكسرش الاستغلال', async () => {
      const empty = await service.supplySnapshot(
        new Date('2032-06-01T00:00:00Z'),
        new Date('2032-06-02T00:00:00Z'),
        ids.company,
      );
      expect(empty.booked_minutes).toBe(0);
      expect(empty.utilization_percent).toBe(0);
      expect(empty.idle_approved).toBe(2);
    });
  });

  describe('كشف الفني', () => {
    it('الشغل المكتمل بيتعد بتاريخ الاكتمال، والمساعد بياخد الطلب اللي شارك فيه', async () => {
      const lead = await cardOf(ids.leadProfile);
      const assistant = await cardOf(ids.assistantProfile);
      expect(lead.completed_orders).toBe(2);
      expect(assistant.completed_orders).toBe(1);
    });

    it('القدرة بتتناسب مع تاريخ الاعتماد — المساعد يوم واحد مش يومين', async () => {
      const lead = await cardOf(ids.leadProfile);
      const assistant = await cardOf(ids.assistantProfile);
      expect(lead.capacity_minutes).toBe(2 * 720);
      expect(assistant.capacity_minutes).toBe(720);
      // القائد ٤٨٠ من ١٤٤٠، المساعد ٢٤٠ من ٧٢٠.
      expect(lead.utilization_percent).toBeCloseTo(33.33, 1);
      expect(assistant.utilization_percent).toBeCloseTo(33.33, 1);
    });

    it('نسبة القبول ووسيط زمن الرد بيتحسبوا من عروض المطابقة الحقيقية', async () => {
      const lead = await cardOf(ids.leadProfile);
      expect(lead.assignments_sent).toBe(4);
      expect(lead.assignments_accepted).toBe(2);
      expect(lead.acceptance_rate).toBe(50);
      expect(lead.median_response_seconds).toBe(40);
    });

    it('الانضباط بيتقاس على العيّنة المعروفة بس', async () => {
      const lead = await cardOf(ids.leadProfile);
      expect(lead.on_time_sample).toBe(2);
      expect(lead.on_time_rate).toBe(50);
    });

    it('إعادة الشغل بتتنسب لصاحب الشغل الأصلي مش للّي راح يصلّح', async () => {
      const lead = await cardOf(ids.leadProfile);
      expect(lead.rework_count).toBe(1);
    });

    it('الإلغاء والتقييم والشكوى بيوصلوا الصف الصح', async () => {
      const lead = await cardOf(ids.leadProfile);
      expect(lead.cancelled_by_technician).toBe(1);
      expect(lead.average_rating).toBe(4);
      expect(lead.ratings_count).toBe(2);
      expect(lead.complaints_count).toBe(1);
    });

    it('صافي الأرباح بيتحسب من حصص المشاركة، وكل واحد بحصته هو', async () => {
      const lead = await cardOf(ids.leadProfile);
      const assistant = await cardOf(ids.assistantProfile);
      expect(lead.net_earnings_cents).toBe(60_000);
      expect(assistant.net_earnings_cents).toBe(20_000);
    });

    it('المديونية بتظهر كرقم موجب مستقل عن الرصيد، والموجب مالوش دَين', async () => {
      const lead = await cardOf(ids.leadProfile);
      const assistant = await cardOf(ids.assistantProfile);
      expect(lead.wallet_balance_cents).toBe(-70_000);
      expect(lead.debt_cents).toBe(70_000);
      expect(assistant.debt_cents).toBe(0);
    });

    it('الترتيب بيشتغل ومابيسمحش بأي نص من الكولر يوصل الـSQL', async () => {
      const byEarnings = await cards('earnings');
      expect(byEarnings.technicians[0].technician_id).toBe(ids.leadProfile);
      const byDebt = await cards('debt');
      expect(byDebt.technicians[0].technician_id).toBe(ids.leadProfile);
      const byIdle = await cards('idle');
      expect(byIdle.technicians[0].technician_id).toBe(ids.assistantProfile);
    });
  });

  describe('استرداد بيقلّل صافي أرباح الفني', () => {
    it('العكس المسجّل على الفني بيتطرح من حصته', async () => {
      const [payment] = await q<{ id: string }[]>(
        `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status,
                               idempotency_key, completed_at)
         VALUES ($1,$2,$3,100000,'cash','succeeded',$4,'2032-05-10T12:30:00Z') RETURNING id`,
        [`WFP-${runId}`.slice(0, 24), orders[0], ids.customerProfile, `wf-idem-${runId}`],
      );
      const [refund] = await q<{ id: string }[]>(
        `INSERT INTO refunds (order_id, payment_id, refund_number, amount_cents, refund_type, refund_status,
                              refund_method, requested_by_user_id, completed_at)
         VALUES ($1,$2,$3,10000,'partial','completed','wallet_credit',$4,'2032-05-11T18:00:00Z')
         RETURNING id`,
        [orders[0], payment.id, `WFR-${runId}`.slice(0, 24), ids.customerUser],
      );
      await q(
        `INSERT INTO refund_settlement_reversals (refund_id, order_id, bucket_type, technician_id,
                                                  original_bucket_cents, reversal_cents)
         VALUES ($1,$2,'participant',$3,60000,10000)`,
        [refund.id, orders[0], ids.leadProfile],
      );

      const lead = await cardOf(ids.leadProfile);
      const assistant = await cardOf(ids.assistantProfile);
      expect(lead.net_earnings_cents).toBe(50_000);
      // العكس على القائد مايمسّش المساعد — الطرح على مستوى الشخص مش الطلب.
      expect(assistant.net_earnings_cents).toBe(20_000);

      await q(`DELETE FROM refund_settlement_reversals WHERE refund_id = $1`, [refund.id]);
      await q(`DELETE FROM refunds WHERE id = $1`, [refund.id]);
      await q(`DELETE FROM payments WHERE id = $1`, [payment.id]);
    });
  });

  describe('التغطية الجغرافية والحمل اللحظي', () => {
    it('المنطقة بتقول طلب كام، اتطابق كام، وفيها كام فني', async () => {
      const report = await service.areaCoverage(from, to, 200);
      const mine = report.areas.find((a) => a.area_id === ids.area)!;
      expect(mine.orders_placed).toBe(3);
      // الطلبات التلاتة كلها ليها فني (مكتمل ×٢ + إعادة زيارة شغّالة).
      expect(mine.orders_matched).toBe(3);
      expect(mine.orders_unmatched).toBe(0);
      expect(mine.technicians_home_based).toBe(2);
      expect(mine.orders_per_technician).toBe(1.5);
    });

    it('الحمل اللحظي بيعد الطلب الشغّال بس', async () => {
      const live = await service.liveLoad(ids.company);
      // إعادة الزيارة لسه `in_progress`، والباقي خلص.
      expect(live.busiest[0]?.technician_id).toBe(ids.leadProfile);
      expect(live.busiest[0]?.active_orders).toBe(1);
      expect(live.technicians_busy).toBe(1);
    });
  });
});
