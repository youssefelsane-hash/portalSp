import { DataSource } from 'typeorm';
import { classifyTechnicianCapacity } from './technician-eligibility.sql';
import { DAILY_CAPACITY_MINUTES_FALLBACK } from './technician-day-capacity.sql';

/**
 * ADR-0059 — القدرة اليومية بالساعات، والالتزام اللي بيمتد على أيامه كلها.
 *
 * **الاختبار ده بينفّذ الحسبة على قاعدة بيانات حقيقية**، مش بيقرا الكود. كل حالة هنا كانت
 * بتدّي نتيجة غلط تحت القاعدة القديمة، وواحدة منهم هي بلاغ المالك بالحرف.
 */
describe('السقف اليومي وتماثل الجدولة (ADR-0059)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    category: '', shortService: '', longService: '',
    techA: '', techB: '', techAUser: '', techBUser: '',
    customer: '', customerProfile: '', address: '', zone: '', city: '',
    orders: [] as string[],
  };
  const CAP = DAILY_CAPACITY_MINUTES_FALLBACK;
  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  /** اليوم المصري بعد N يوم — نفس تعريف التقويم اللي الحسبة بتستخدمه. */
  const dayAfter = (offset: number): string => {
    const d = new Date(Date.now() + offset * 86_400_000);
    return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  };

  const makeTechnician = async (label: string): Promise<{ profileId: string; userId: string }> => {
    const [u] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2098${runId}${label}`.slice(0, 15), `فني ${label} ${runId}`],
    );
    const [p] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status, current_location)
       VALUES ($1,$2,'approved', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)::geography) RETURNING id`,
      [u.id, `CAP-${runId}-${label}`],
    );
    return { profileId: p.id, userId: u.id };
  };

  /** طلب ملتزم بيه الفني — `days` بتحدد امتداده، و`minutes` حمله اليومي لو يوم واحد. */
  const makeOrder = async (
    technicianId: string,
    day: string,
    opts: { days?: number | null; minutes?: number | null; serviceId?: string },
  ): Promise<string> => {
    const [o] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, technician_id,
                           order_status, scheduled_at, estimated_duration_days, duration_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted', ($7 || ' 09:00')::timestamp AT TIME ZONE 'Africa/Cairo', $8, $9)
       RETURNING id`,
      [
        `CAP-${runId}-${ids.orders.length}`,
        ids.customerProfile,
        opts.serviceId ?? ids.shortService,
        ids.address,
        ids.zone,
        technicianId,
        day,
        opts.days ?? null,
        opts.minutes ?? null,
      ],
    );
    ids.orders.push(o.id);
    return o.id;
  };

  /** «الفني ده يقدر ياخد شغل بالمواصفات دي في اليوم ده؟» — نفس الدالة اللي التوزيع بيستخدمها. */
  const tierFor = (technicianId: string, day: string, minutes: number, spanDays = 1) =>
    classifyTechnicianCapacity(dataSource, {
      technicianId,
      scheduledAt: `${day}T09:00:00+02:00`,
      excludeOrderId: null,
      serviceDurationMinutes: minutes,
      dailyCapacityMinutes: CAP,
      candidateSpanDays: spanDays,
    });

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
    });
    await dataSource.initialize();

    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`قدرة ${runId}`, `cap ${runId}`, `cap-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    const [svcShort] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, estimated_duration_minutes, pricing_model)
       VALUES ($1,$2,$3,$4,10000,120,'formula') RETURNING id`,
      [ids.category, `قصيرة ${runId}`, `short ${runId}`, `short-${runId.toLowerCase()}`],
    );
    ids.shortService = svcShort.id;
    const [svcLong] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, estimated_duration_minutes, pricing_model)
       VALUES ($1,$2,$3,$4,50000,480,'formula') RETURNING id`,
      [ids.category, `طويلة ${runId}`, `long ${runId}`, `long-${runId.toLowerCase()}`],
    );
    ids.longService = svcLong.id;

    // بنستعمل دولة موجودة بدل ما ننشئ واحدة — نفس نمط باقي السويتات (تصادم iso_code موثّق).
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `city ${runId}`, `cap-city-${runId.toLowerCase()}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `منطقة ${runId}`, `zone ${runId}`],
    );
    ids.zone = zone.id;

    const [cu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2097${runId}`.slice(0, 15), `عميل ${runId}`],
    );
    ids.customer = cu.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customer]);
    ids.customerProfile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, label, street_name, city_id, location)
       VALUES ($1,'بيت','شارع',$2,ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)::geography) RETURNING id`,
      [ids.customer, ids.city],
    );
    ids.address = addr.id;

    const a = await makeTechnician('A');
    const b = await makeTechnician('B');
    ids.techA = a.profileId;
    ids.techAUser = a.userId;
    ids.techB = b.profileId;
    ids.techBUser = b.userId;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM order_team_members WHERE order_id = ANY($1)`, [ids.orders]);
      await q(`DELETE FROM orders WHERE id = ANY($1)`, [ids.orders]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [[ids.techA, ids.techB]]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.customer, ids.techAUser, ids.techBUser]]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.shortService, ids.longService]]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  // ===================== بلاغ المالك بالحرف =====================
  describe('التماثل — «أ ظاهر لـب، وب مش ظاهر لـأ»', () => {
    it('فني شغل يوم واحد وفني شغل 5 أيام: القرار واحد في الاتجاهين', async () => {
      const day = dayAfter(10);
      // «أ» عنده شغلانة قصيرة (ساعتين) نفس اليوم. «ب» عنده شغل 5 أيام بيبدأ نفس اليوم.
      await makeOrder(ids.techA, day, { minutes: 120 });
      await makeOrder(ids.techB, day, { days: 5, serviceId: ids.longService });

      // السؤال المتماثل: كل واحد فيهم يقدر ياخد شغلانة الساعتين بتاعت التاني؟
      const aCanTakeShort = await tierFor(ids.techA, day, 120);
      const bCanTakeShort = await tierFor(ids.techB, day, 120);

      // «أ» عنده ساعتين من 12 → لسه فاضي (بس مش أول شغل في يومه ⇒ MEANINGFUL).
      expect(aCanTakeShort).toBe('MEANINGFUL');
      // «ب» يومه كله متاخد بالشغل الممتد → مرفوض.
      expect(bCanTakeShort).toBe('HEAVY');
      // **النقطة**: الفرق دلوقتي ليه سبب مفهوم (2 ساعة مقابل يوم كامل)، مش عشوائي حسب مين بيسأل.
      expect(aCanTakeShort).not.toBe(bCanTakeShort);
    });

    // يوم بعيد عن أي مدى في الاختبارات التانية — أول نسخة من الاختبار ده استعملت يوم جوّه مدى
    // الشغل الخماسي بتاع «ب» فطلع HEAVY بحق، وده كان **دليل إن امتداد الأيام شغال** مش بَقّة.
    it('نفس الحمل بالظبط ⇒ نفس التصنيف بالظبط للاتنين', async () => {
      const day = dayAfter(120);
      await makeOrder(ids.techA, day, { minutes: 300 });
      await makeOrder(ids.techB, day, { minutes: 300 });
      expect(await tierFor(ids.techA, day, 120)).toBe(await tierFor(ids.techB, day, 120));
      expect(await tierFor(ids.techA, day, 600)).toBe(await tierFor(ids.techB, day, 600));
    });
  });

  // ===================== الشغل الممتد =====================
  describe('الالتزام بيمتد على أيامه كلها', () => {
    it('شغل 5 أيام بيقفل الخمس أيام، مش يوم البداية بس', async () => {
      const start = dayAfter(20);
      await makeOrder(ids.techA, start, { days: 5, serviceId: ids.longService });
      for (let offset = 0; offset < 5; offset += 1) {
        expect(await tierFor(ids.techA, dayAfter(20 + offset), 120)).toBe('HEAVY');
      }
      // اليوم اللي بعد آخر يوم في المدى لازم يرجع فاضي تمامًا.
      expect(await tierFor(ids.techA, dayAfter(25), 120)).toBe('LIGHT');
    });

    it('حجز شهر كامل بيبان محجوز الشهر كله (طلب مالك صريح)', async () => {
      const start = dayAfter(60);
      await makeOrder(ids.techB, start, { days: 30, serviceId: ids.longService });
      for (const offset of [0, 7, 15, 29]) {
        expect(await tierFor(ids.techB, dayAfter(60 + offset), 120)).toBe('HEAVY');
      }
      expect(await tierFor(ids.techB, dayAfter(90), 120)).toBe('LIGHT');
    });
  });

  // ===================== السقف اليومي =====================
  describe('12 ساعة سقف اليوم', () => {
    it('9 ساعات مشغولة: 3 ساعات كمان مقبولة، و4 ساعات مرفوضة', async () => {
      const day = dayAfter(40);
      await makeOrder(ids.techA, day, { minutes: 9 * 60 });
      expect(await tierFor(ids.techA, day, 3 * 60)).toBe('MEANINGFUL');
      expect(await tierFor(ids.techA, day, 4 * 60)).toBe('HEAVY');
    });

    it('الحمل بيتجمّع من أكتر من طلب في نفس اليوم', async () => {
      const day = dayAfter(41);
      await makeOrder(ids.techB, day, { minutes: 5 * 60 });
      expect(await tierFor(ids.techB, day, 6 * 60)).toBe('MEANINGFUL');
      await makeOrder(ids.techB, day, { minutes: 5 * 60 });
      // بقى 10 ساعات مشغولة — ساعتين بس اللي فاضلين.
      expect(await tierFor(ids.techB, day, 2 * 60)).toBe('MEANINGFUL');
      expect(await tierFor(ids.techB, day, 3 * 60)).toBe('HEAVY');
    });
  });

  // ===================== أول طلب في اليوم =====================
  // طلب مالك: «الطلب الأول بس في اليوم هو اللي بيتقبل أوتوماتيك، بعد كده بيروح كـrequests».
  // `LIGHT` هي البوابة الوحيدة للتأكيد التلقائي في `MatchingService.classifyCandidate()`.
  it('أول شغل في اليوم LIGHT (تأكيد تلقائي)، واللي بعده MEANINGFUL (طلب محتاج قبول)', async () => {
    const day = dayAfter(50);
    expect(await tierFor(ids.techA, day, 120)).toBe('LIGHT');
    await makeOrder(ids.techA, day, { minutes: 60 });
    expect(await tierFor(ids.techA, day, 120)).toBe('MEANINGFUL');
  });

  // ===================== المساعد = الصنايعي =====================
  it('عضو الطاقم محسوب مشغول زي القائد بالظبط (ADR-0057/0059)', async () => {
    const day = dayAfter(70);
    const leaderOrder = await makeOrder(ids.techA, day, { days: 3, serviceId: ids.longService });
    // «ب» مش قائد الطلب ده خالص — هو عضو طاقم فيه.
    await q(
      `INSERT INTO order_team_members (order_id, technician_id, member_type, role_label, added_by_technician_id)
       VALUES ($1,$2,'assistant','مساعد',$3)`,
      [leaderOrder, ids.techB, ids.techA],
    );
    // لازم يبقى مشغول نفس الأيام التلاتة زي القائد بالظبط.
    for (let offset = 0; offset < 3; offset += 1) {
      expect(await tierFor(ids.techB, dayAfter(70 + offset), 120)).toBe('HEAVY');
    }
  });
});
