import { DataSource } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { OrderAssignment } from './entities/order-assignment.entity';
import { MatchingService } from './matching.service';
import { MatchingExplainabilityService } from './matching-explainability.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';

/**
 * **سيناريوهات الجدولة والقبول — تدقيق النظام (docs/system-audit، §134)**.
 *
 * المالك طرح خمس حالات بالاسم وطلب التأكد منها بالتشغيل الحقيقي مش بقراءة الكود، وشكّ تحديدًا
 * إن «الفني عنده شغل نشط» ممكن يكون بيتعامل كأنه «الفني ميقدرش ياخد أي طلب تاني» — وده هيمنع
 * حجز مستقبلي مشروع.
 *
 * الاختبار ده بينادي `findEligibleTechnicians()` **الحقيقية** على Postgres حقيقي، فالنتيجة
 * دليل على السلوك الفعلي مش على النية.
 *
 * القاعدة اللي بيوثّقها (من `technician-eligibility.sql.ts`):
 *   • التعارض بيتقاس على **يوم الطلب المرشّح بتوقيت مصر** — طلب نشط النهاردة مالوش أي أثر على
 *     يوم تاني.
 *   • جوّه نفس اليوم: تقاطع نافذة زمنية حقيقي (نطاق نصف مفتوح)، أو انشغال جسدي فعلي دلوقتي.
 *   • فوق كده: سقف يومي بالدقايق (`matching.daily_capacity_minutes`).
 */
describe('سيناريوهات الجدولة والقبول — تحقق حي (docs/system-audit §134)', () => {
  jest.setTimeout(45_000);

  let dataSource: DataSource;
  let matchingService: MatchingService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '', city: '', zone: '', category: '', service: '',
    techUser: '', techProfile: '', customerUser: '', customerProfile: '', address: '',
  };
  const orderIds: string[] = [];
  let seq = 0;
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  /** يوم/ساعة بتوقيت مصر → timestamptz. `dayOffset` بالأيام من النهاردة. */
  function cairoAt(dayOffset: number, hour: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + dayOffset);
    // مصر UTC+2/+3؛ الاختبار بيستعمل نفس التحويل اللي الاستعلام بيستعمله، فبنبني النص بتوقيت
    // مصر ونسيب Postgres يحوّله — كده مفيش انحراف بين الاختبار والمحرك.
    const day = d.toISOString().slice(0, 10);
    return `${day} ${String(hour).padStart(2, '0')}:00:00 Africa/Cairo`;
  }

  async function insertOrder(opts: {
    label: string;
    status: OrderStatus;
    scheduledAt: string | null;
    durationMinutes?: number | null;
    /** شغل بيشغّل اليوم كله (ADR-0059) — بيستهلك السقف اليومي بالكامل. */
    estimatedDurationDays?: number | null;
  }): Promise<string> {
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
                           order_status, total_amount_cents, technician_id, scheduled_at, duration_minutes,
                           estimated_duration_days)
       VALUES ($1,$2,$3,$4,$5,$6,10000,$7,$8::timestamptz,$9,$10) RETURNING id`,
      [
        `SCN-${runId}-${++seq}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone,
        opts.status, ids.techProfile, opts.scheduledAt, opts.durationMinutes ?? null,
        opts.estimatedDurationDays ?? null,
      ],
    );
    orderIds.push(row.id as string);
    return row.id as string;
  }

  /**
   * الطلب المرشّح (مش متعيّن لحد) اللي بنسأل عنه «الفني ده مؤهّل ليه؟».
   *
   * **بيترجّع من الـrepository مش من `RETURNING *`**: الأخير بيدّي أعمدة SQL خام (`snake_case`)
   * والمحرك بيقرا خصائص كيان TypeORM (`camelCase`) — فـ`serviceZoneId`/`scheduledAt` كانوا
   * بيوصلوا `undefined` والاستعلام يفلتر على NULL. ده خلّى **كل** السيناريوهات ترجع «مش
   * مؤهّل»، فاللي متوقع رفضه كان بينجح بالباطل. اتكشف بفحص خط أساس + خدمة التفسير.
   */
  async function candidateOrder(
    scheduledAt: string | null,
    durationMinutes: number | null,
    emergency = false,
    estimatedDurationDays: number | null = null,
  ): Promise<Order> {
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
                           order_status, total_amount_cents, scheduled_at, duration_minutes, booking_mode,
                           estimated_duration_days)
       VALUES ($1,$2,$3,$4,$5,'searching_technician',10000,$6::timestamptz,$7,$8,$9) RETURNING id`,
      [
        `CND-${runId}-${++seq}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone,
        scheduledAt, durationMinutes, emergency ? 'emergency' : 'individual', estimatedDurationDays,
      ],
    );
    orderIds.push(row.id as string);
    return dataSource.getRepository(Order).findOneOrFail({ where: { id: row.id as string } });
  }

  /** تاريخ اليوم بتوقيت مصر (`YYYY-MM-DD`) بعد `dayOffset` يوم — نفس اللي `slot_date` بيتخزن بيه. */
  async function cairoDate(dayOffset: number): Promise<string> {
    const [row] = await q(`SELECT ((now() AT TIME ZONE 'Africa/Cairo')::date + $1::int)::text AS d`, [dayOffset]);
    return row.d as string;
  }

  async function blockDay(date: string, startTime = '00:00:00', endTime = '23:59:59'): Promise<void> {
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1,$2,$3,$4,'blocked')`,
      [ids.techProfile, date, startTime, endTime],
    );
  }

  const isEligible = async (order: Order): Promise<boolean> => {
    const rows = await matchingService.findEligibleTechnicians(order, 50);
    return rows.some((r) => r.technician_id === ids.techProfile);
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    const assignmentGuard = new TechnicianAssignmentGuardService({
      getNumber: jest.fn(async (_k: string, fb: number) => fb), getString: jest.fn(async (_k: string, fb: string) => fb),
    } as never);

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      techniciansService,
      assignmentGuard,
      {
        getNumber: jest.fn(async (_k: string, fb: number) => fb),
        getBoolean: jest.fn(async (_k: string, fb: boolean) => fb),
        getString: jest.fn(async (_k: string, fb: string) => fb),
      } as never,
      { emit: () => true } as never,
      { add: async () => undefined } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      levelPremiumServiceStub(),
    );

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة سيناريو ${runId}`, `Scn City ${runId}`, `scn-city-${runId}`]);
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق سيناريو ${runId}`, `Scn Zone ${runId}`]);
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة سيناريو ${runId}`, `Scn Cat ${runId}`, `scn-cat-${runId}`]);
    ids.category = category.id;
    // مدة افتراضية ساعتين — الطلبات اللي بتتعمل تحت بتحدد `duration_minutes` صراحة عشان
    // فحص التقاطع الزمني الدقيق يشتغل.
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, estimated_duration_minutes)
       VALUES ($1,$2,$3,'formula',10000,120) RETURNING id`,
      [ids.category, `خدمة سيناريو ${runId}`, `scn-svc-${runId}`]);
    ids.service = service.id;

    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2015${runId}`.slice(0, 14), `فني سيناريو ${runId}`]);
    ids.techUser = user.id;
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, verification_status,
                                        is_available, is_on_duty, current_location)
       VALUES ($1,$2,'new','approved',true,true,ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.techUser, `SCN${runId}`.slice(0, 20)]);
    ids.techProfile = profile.id;
    // `verification_status='approved'` مطلوب صراحة: استعلام الأهلية بيعمل
    // `LEFT JOIN technician_services ... AND ts.verification_status = 'approved'`، فربط بلا
    // اعتماد = الفني مش مؤهّل للخدمة أصلاً. (اتلقطت باختبار خط أساس — من غيره كل «المفروض
    // يترفض» كان بينجح بالباطل لأن الفني مرفوض لسبب تاني خالص.)
    await q(
      `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
       VALUES ($1,$2,true,'approved')`,
      [ids.techProfile, ids.service],
    );
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [ids.techProfile, ids.zone]);

    const [cu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2016${runId}`.slice(0, 14), `عميل سيناريو ${runId}`]);
    ids.customerUser = cu.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع سيناريو ${runId}`]);
    ids.address = addr.id;
  });

  afterEach(async () => {
    // كل سيناريو بيبدأ من جدول فاضي — عشان النتيجة تخص السيناريو نفسه مش تراكم اللي قبله.
    await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM order_assignments WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
    orderIds.length = 0;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
    await q(`DELETE FROM technician_services WHERE technician_id = $1`, [ids.techProfile]);
    await q(`DELETE FROM technician_zones WHERE technician_id = $1`, [ids.techProfile]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
    await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.techUser, ids.customerUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('خط الأساس — فني فاضي تمامًا مؤهّل (لو ده فشل، المِنصّة نفسها غلط مش المحرك)', async () => {
    const plain = await candidateOrder(cairoAt(1, 16), 120);
    const rows = await matchingService.findEligibleTechnicians(plain, 50);
    // طباعة تشخيصية عند الفشل: مين رجع فعلاً؟
    if (!rows.some((r) => r.technician_id === ids.techProfile)) {
      // الخدمة دي معمولة بالظبط للسؤال ده — بتقول **أنهي بوابة** رفضت الفني.
      const why = await new MatchingExplainabilityService(
        dataSource,
        { getNumber: jest.fn(async (_k: string, fb: number) => fb) } as never,
        matchingService,
      ).explainTechnicianForOrder(plain, ids.techProfile);
      console.error('سبب الرفض:', JSON.stringify(why, null, 2).slice(0, 2500));
    }
    expect(rows.some((r) => r.technician_id === ids.techProfile)).toBe(true);
  });

  it('A — شغل نشط دلوقتي **مايمنعش** حجز مستقبلي بكرة (شكّ المالك المباشر)', async () => {
    // الفني شغّال فعلاً دلوقتي (in_progress، النهاردة).
    await insertOrder({ label: 'active-now', status: OrderStatus.IN_PROGRESS, scheduledAt: cairoAt(0, 11), durationMinutes: 180 });
    // طلب بكرة الساعة ٤ عصرًا — مفيش أي تداخل.
    const tomorrow = await candidateOrder(cairoAt(1, 16), 120);
    expect(await isEligible(tomorrow)).toBe(true);
  });

  it('A2 (ADR-0070) — الشغل الجاري دلوقتي **مايمنعش** شغلانة تانية نفس اليوم مالهاش تداخل', async () => {
    // النسخة القديمة كانت بتتوقّع `false` هنا اعتمادًا على قاعدة «منشغل جسديًا + نفس اليوم =
    // مستبعد». المالك شال القاعدة دي بالنص: «لو جاله شغلانة تانية ما بتتعارضش مع مواعيده في نفس
    // اليوم، ومجموع الشغل أقل من عدد الساعات المسموح أو يساويه — مفيش مشكلة».
    // الحسبة هنا: ١١:٠٠–١٤:٠٠ (١٨٠ د) + ٢٠:٠٠–٢٢:٠٠ (١٢٠ د) = ٣٠٠ دقيقة ≤ ٧٢٠ (السقف)، وصفر
    // تداخل زمني ⇒ مؤهّل.
    await insertOrder({ label: 'engaged', status: OrderStatus.IN_PROGRESS, scheduledAt: cairoAt(0, 11), durationMinutes: 180 });
    const sameDay = await candidateOrder(cairoAt(0, 20), 120);
    expect(await isEligible(sameDay)).toBe(true);
  });

  it('A3 (ADR-0070) — نفس الحالة بس بتداخل زمني حقيقي: بيتمنع', async () => {
    // الحارس اللي لسه قايم: تقاطع نافذة فعلية. ١١:٠٠–١٤:٠٠ مقابل ١٣:٠٠–١٥:٠٠ ⇒ تداخل ⇒ مستبعد.
    await insertOrder({ label: 'engaged', status: OrderStatus.IN_PROGRESS, scheduledAt: cairoAt(0, 11), durationMinutes: 180 });
    const overlapping = await candidateOrder(cairoAt(0, 13), 120);
    expect(await isEligible(overlapping)).toBe(false);
  });

  it('B — تعارض مستقبلي حقيقي (بكرة ١٤–١٦ ثم ١٥–١٧) بيتمنع', async () => {
    await insertOrder({ label: 'tomorrow-14', status: OrderStatus.ACCEPTED, scheduledAt: cairoAt(1, 14), durationMinutes: 120 });
    const overlapping = await candidateOrder(cairoAt(1, 15), 120);
    expect(await isEligible(overlapping)).toBe(false);
  });

  it('C — نفس اليوم بلا تداخل (بكرة ١٤–١٦ ثم ١٧–١٩) مسموح', async () => {
    await insertOrder({ label: 'tomorrow-14', status: OrderStatus.ACCEPTED, scheduledAt: cairoAt(1, 14), durationMinutes: 120 });
    const later = await candidateOrder(cairoAt(1, 17), 120);
    expect(await isEligible(later)).toBe(true);
  });

  it('C2 — موعدان متجاوران تمامًا (١٤–١٦ ثم ١٦–١٨) مسموحان — النطاق نصف مفتوح', async () => {
    await insertOrder({ label: 'tomorrow-14', status: OrderStatus.ACCEPTED, scheduledAt: cairoAt(1, 14), durationMinutes: 120 });
    const adjacent = await candidateOrder(cairoAt(1, 16), 120);
    expect(await isEligible(adjacent)).toBe(true);
  });

  it('D — طلب طوارئ: الفني اللي **قَبِل بس لسه ما بدأش** يفضل مؤهّل', async () => {
    // `accepted` مش ضمن ENGAGED — الفني اتأكّد على شغل بس مش منشغل جسديًا دلوقتي.
    await insertOrder({ label: 'accepted-not-started', status: OrderStatus.ACCEPTED, scheduledAt: cairoAt(0, 18), durationMinutes: 120 });
    const urgent = await candidateOrder(null, null, true);
    expect(await isEligible(urgent)).toBe(true);
  });

  it('D2 (ADR-0070) — طلب طوارئ: الفني اللي **شغّال فعليًا دلوقتي** بقى مؤهّل طالما يومه مش مليان', async () => {
    // ده **بالظبط** البلاغ اللي المالك رفعه (2026-09-04): «أعتقد إن حاليًا أصلاً الصنايعي ما
    // ينفعش يقبل وهو في شغلانة — طالما الشغلانة جارية هو ما ينفعش يقبل شغل تاني، فدي مشكلة».
    // ١٨٠ دقيقة مشغولة + شغلانة الطوارئ ≤ ٧٢٠ ⇒ مؤهّل.
    await insertOrder({ label: 'in-progress', status: OrderStatus.IN_PROGRESS, scheduledAt: cairoAt(0, 11), durationMinutes: 180 });
    const urgent = await candidateOrder(null, null, true);
    expect(await isEligible(urgent)).toBe(true);
  });

  it('D4 (ADR-0070) — طلب طوارئ: الفني اللي يومه **مليان** بقى يتستبعد (السقف اليومي بقى يسري على الطوارئ)', async () => {
    // الوجه التاني لنفس القاعدة: قبل ADR-0070 السقف اليومي مكانش بيسري على الطوارئ خالص، فالفني
    // اللي محجوز يوم كامل كان لسه بياخد طوارئ. دلوقتي «مجموع الشغل ≤ المسموح» بيسري على الكل.
    await insertOrder({ label: 'full-day', status: OrderStatus.ACCEPTED, scheduledAt: cairoAt(0, 9), durationMinutes: 60, estimatedDurationDays: 1 });
    const urgent = await candidateOrder(null, null, true);
    expect(await isEligible(urgent)).toBe(false);
  });

  it('D3 — الشغل النشط **النهاردة** مايمنعش طلب طوارئ لو الفني مش منشغل جسديًا', async () => {
    // نفس الحالة زي D بس بحالة تانية من ACTIVE-لكن-مش-ENGAGED.
    await insertOrder({ label: 'awaiting-approval', status: OrderStatus.ACCEPTED, scheduledAt: cairoAt(0, 9), durationMinutes: 60 });
    const urgent = await candidateOrder(null, null, true);
    expect(await isEligible(urgent)).toBe(true);
  });

  describe('E — الإجازة الصريحة (`blocked`) لازم تُحترم على كل يوم من أيام الشغل', () => {
    it('E1 — إجازة يوم كامل في **يوم بداية** الطلب بتمنعه (خط الأساس)', async () => {
      await blockDay(await cairoDate(3));
      const onBlockedDay = await candidateOrder(cairoAt(3, 10), 120);
      expect(await isEligible(onBlockedDay)).toBe(false);
    });

    it('E2 — إجازة في **نص** شغل ممتد (٥ أيام، الإجازة في اليوم التالت) لازم تمنعه برضه', async () => {
      await blockDay(await cairoDate(5));
      // شغل ٥ أيام مبتدي بعد ٣ أيام ⇒ بيغطي الأيام ٣،٤،٥،٦،٧ — الإجازة في نصه بالظبط.
      const multiDay = await candidateOrder(cairoAt(3, 10), null, false, 5);
      expect(await isEligible(multiDay)).toBe(false);
    });

    it('E3 — إجازة بساعات آخر الليل مع شغل بيعدّي نص الليل لازم تتحسب', async () => {
      // الشغل ٢٢:٠٠ + ٤ ساعات ⇒ ٢٢:٠٠–٠٢:٠٠ اليوم اللي بعده. الإجازة ٢٣:٠٠–٢٣:٥٩ متقاطعة فعليًا.
      await blockDay(await cairoDate(3), '23:00:00', '23:59:59');
      const overnight = await candidateOrder(cairoAt(3, 22), 240);
      expect(await isEligible(overnight)).toBe(false);
    });

    it('E4 — إجازة **مش** متقاطعة مع الشغل مابتمنعش (ضد الإفراط في التقييد)', async () => {
      await blockDay(await cairoDate(3), '06:00:00', '09:00:00');
      const afternoon = await candidateOrder(cairoAt(3, 14), 120);
      expect(await isEligible(afternoon)).toBe(true);
    });
  });

  it('السقف اليومي: شغل يتعدّى `daily_capacity_minutes` بيمنع طلب تاني نفس اليوم', async () => {
    // ٦٦٠ دقيقة (١١ ساعة) + مرشّح ١٢٠ دقيقة = ٧٨٠ > ٧٢٠ (السقف الافتراضي).
    await insertOrder({ label: 'long-day', status: OrderStatus.ACCEPTED, scheduledAt: cairoAt(2, 8), durationMinutes: 660 });
    const extra = await candidateOrder(cairoAt(2, 20), 120);
    expect(await isEligible(extra)).toBe(false);
  });
});
