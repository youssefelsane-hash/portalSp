import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MatchingService } from './matching.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from './entities/order-assignment.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';

// اختبار حي ضد Postgres حقيقي (نفس فلسفة المشروع: مفيش mocks لاستعلامات SQL خام) — بيثبت
// إصلاح البَقّة الموثّقة: استعلام استبعاد "الفني عنده طلب نشط بالفعل" في findEligibleTechnicians()
// كان بيفحص order_status بس، من غير فلترة deleted_at IS NULL. طلب اتعمله soft-delete لكن
// order_status فضل على قيمة نشطة (accepted) كان بيخلي الفني "محبوس" كمشغول للأبد رغم إن الطلب
// نفسه مش ظاهر لحد. الإصلاح: AND deleted_at IS NULL على نفس الاستعلام (matching.service.ts
// وassistant-matching.service.ts الاتنين).
describe('MatchingService — استبعاد طلب soft-deleted من فحص "الفني مشغول" (regression)', () => {
  let dataSource: DataSource;
  let matchingService: MatchingService;
  let queueAdd: jest.Mock;

  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    technicianUser: '',
    technicianProfile: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    blockingOrder: '',
    recoveredOrder: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    // matching.service.ts's findEligibleTechnicians() بتستخدم this.dataSource بس (التبعيات
    // التانية في الـconstructor مش مُستخدمة في الدالة دي) — نفس نمط FakeRepository في
        // auth.service.spec.ts، تركيب يدوي خفيف بدل تشغيل موديول NestJS كامل.
    queueAdd = jest.fn().mockResolvedValue(undefined);
    // autoConfirmScheduledOrder (ADR-0017 بند 5، اتسمّت كده ADR-0018) بتستخدم assignmentGuard
    // الحقيقية (lockTechnician + assertEligible) كدفاع عمق ضد سباق الحجز المتزامن — لازم instance
    // حقيقي هنا مش stub. TechnicianAssignmentGuardService بقى محتاج SettingsService (ADR-0018 §9،
    // full_day_job_minutes) — stub بسيط بيرجّع الـfallback زي باقي الـmocks هنا.
    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      new TechnicianAssignmentGuardService({ getNumber: jest.fn(async (_key: string, fallback: number) => fallback) } as never),
      {
        getNumber: jest.fn(async (_key: string, fallback: number) => fallback),
        // ADR-0035 — nearTermRoundTimeoutSeconds() بتقرا قايمة الكادينس كنص، فالـstub لازم
        // يغطّي getString كمان مش getNumber بس (وإلا بترمي TypeError جوّه الترانزاكشن).
        getString: jest.fn(async (_key: string, fallback: string) => fallback),
      } as never,
      { emit: jest.fn() } as never,
      { add: queueAdd } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      levelPremiumServiceStub(),
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The matching integration fixture requires the seeded EG country');
    ids.country = country.id;

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-${runId}`],
    );
    ids.city = city.id;

    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق اختبار ${runId}`, `Test Zone ${runId}`],
    );
    ids.zone = zone.id;

    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-${runId}`],
    );
    ids.category = category.id;

    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-${runId}`],
    );
    ids.service = service.id;

    const [technicianUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2010${runId}1`.slice(0, 14), `فني اختبار ${runId}`],
    );
    ids.technicianUser = technicianUser.id;

    const [technicianProfile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
       VALUES ($1,$2,'new','approved',true,true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography)
       RETURNING id`,
      [ids.technicianUser, `TST${runId}`.slice(0, 20)],
    );
    ids.technicianProfile = technicianProfile.id;

    await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [
      ids.technicianProfile,
      ids.service,
    ]);
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      ids.technicianProfile,
      ids.zone,
    ]);

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2011${runId}1`.slice(0, 14), `عميل اختبار ${runId}`],
    );
    ids.customerUser = customerUser.id;

    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.customerUser,
    ]);
    ids.customerProfile = customerProfile.id;

    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    // الطلب "المشغول" — accepted فعليًا (الحالة النشطة اللي بتستبعد الفني)، وهيتعمله soft-delete
    // في كل test لوحده (مش هنا) عشان الاختبارين يفضلوا مستقلين عن بعض.
    // **تحديث (docs/08 §32، 2026-08-20)**: estimated_duration_days=1 ("شاغل يوم كامل") مُضافة
    // عمدًا — بعد توحيد قاعدة ASAP مع المجدول (يوم بدل "أي طلب نشط")، طلب accepted قصير لسه ما
    // بدأش مبقاش يستبعد خالص (نفس فلسفة المجدول تمامًا)، فالفحوصات هنا محتاجة تعارض يوم-كامل
    // حقيقي عشان تفضل ذات معنى — راجع اختبار "accepted تاني قصير مابيستبعدش" تحت لتغطية العكس بالظبط.
    const [blockingOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, estimated_duration_days)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted',1) RETURNING id`,
      [`TEST-${runId}`.slice(0, 24), ids.customerProfile, ids.technicianProfile, ids.service, ids.address, ids.zone],
    );
    ids.blockingOrder = blockingOrder.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      if (ids.recoveredOrder) await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.recoveredOrder]);
      if (ids.recoveredOrder) await q(`DELETE FROM orders WHERE id = $1`, [ids.recoveredOrder]);
      if (ids.blockingOrder) await q(`DELETE FROM orders WHERE id = $1`, [ids.blockingOrder]);
      if (ids.technicianProfile) {
        await q(`DELETE FROM technician_zones WHERE technician_id = $1`, [ids.technicianProfile]);
        await q(`DELETE FROM technician_services WHERE technician_id = $1`, [ids.technicianProfile]);
      }
      if (ids.address) await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      if (ids.customerProfile) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (ids.customerUser) await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      if (ids.technicianProfile) await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.technicianProfile]);
      if (ids.technicianUser) await q(`DELETE FROM users WHERE id = $1`, [ids.technicianUser]);
      if (ids.service) await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      if (ids.category) await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      if (ids.zone) await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      if (ids.city) await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  const findCandidates = (scheduledAt: Date | null = null) => {
    // ADR-0017 بند 5 — findEligibleTechnicians دلوقتي بتستبعد صراحة "نفس الطلب" (self-exclude)
    // من فحص التعارض عبر order.id — لازم يبقى id مختلف عن ids.blockingOrder هنا (زي أي طلب مرشّح
    // حقيقي فعليًا، مش نفس صف الطلب "المشغول" اللي بنفحص التعارض معاه)، وإلا الاستبعاد الذاتي
    // بيلغي فحص التعارض بالغلط.
    const order = {
      id: randomUUID(),
      serviceId: ids.service,
      serviceZoneId: ids.zone,
      addressId: ids.address,
      scheduledAt,
      // قيمة رمزية صغيرة تحت حد قرار مستوى 'new' (200 جنيه) — findEligibleTechnicians بقت
      // بتفحص decision_limit_cents (docs/08 §36.1 تعميق)، والاختبارات هنا بتفحص فحص التعارض
      // على الوقت مش حدود القرار السعرية.
      totalAmountCents: 10000,
    } as Order;
    // findEligibleTechnicians خاصة (private) — بنستدعيها زي ما هي فعليًا (مش نسخة معاد كتابتها)
    // عشان أي تراجع مستقبلي عن الإصلاح يكسر الاختبار ده فورًا.
    return (matchingService as unknown as { findEligibleTechnicians: (...args: unknown[]) => Promise<{ technician_id: string }[]> })
      .findEligibleTechnicians(order, 50, null, false, null);
  };

  it('طلب accepted شاغل يوم كامل غير محذوف: الفني بيتستبعد صح (السلوك الأصلي محفوظ)', async () => {
    const candidates = await findCandidates();
    expect(candidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(false);
  });

  // قرار عمل صريح من المالك (2026-08-19، سيناريو "تسليك مواصير نص يوم") — نفس بَقّة
  // TechnicianAssignmentGuardService.assertEligible() المصلّحة بس هنا في مسار التوزيع الفعلي:
  // فني عنده طلب accepted شاغل يوم كامل النهاردة مايترفضش من طلب تاني **مجدول** ليوم بعيد —
  // الاستبعاد القديم كان unconditional بغض النظر عن scheduledAt الطلب المرشّح.
  it('طلب مجدول بعد أسبوع: الفني مبيتستبعدش رغم إن عنده طلب accepted شاغل يوم كامل النهاردة', async () => {
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const candidates = await findCandidates(weekFromNow);
    expect(candidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(true);
  });

  it('طلب ASAP (بلا scheduledAt) لسه بيرفض صح لو الفني عنده طلب تاني شاغل يوم كامل النهاردة — الحماية الحقيقية اتحافظ عليها', async () => {
    const candidates = await findCandidates(null);
    expect(candidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(false);
  });

  // إصلاح بَقّة حقيقية (docs/08 §32، بلاغ مالك 2026-08-20): قبل الإصلاح، طلب accepted قصير
  // (لسه ما بدأش، مش شاغل يوم كامل) كان بيستبعد الفني من *أي* طلب ASAP جديد بالكامل — رغم إن
  // نفس الفني ده كان بيفضل مؤهّل تمامًا لطلب مجدول لنفس اليوم بالظبط. الإصلاح: ASAP بقى يتبع
  // بالحرف نفس قاعدة الطلب المجدول (يوم = النهاردة).
  it('طلب ASAP بقى يتقبل رغم إن الفني عنده طلب accepted تاني النهاردة (قصير، لسه ما بدأش) — إصلاح البَقّة (docs/08 §32)', async () => {
    // بنعزل الفحص ده عن blockingOrder المشترك (شاغل يوم كامل — سبب استبعاد تاني مختلف تمامًا
    // اتغطى فوق) بـsoft-delete مؤقت، عشان الاختبار ده يثبت تحديدًا إن طلب accepted قصير (مش
    // شاغل يوم كامل) بمفرده مابيستبعدش.
    await dataSource.query(`UPDATE orders SET deleted_at = now() WHERE id = $1`, [ids.blockingOrder]);
    const [order] = await dataSource.query(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted') RETURNING id`,
      [`ACC-${runId}`.slice(0, 24), ids.customerProfile, ids.technicianProfile, ids.service, ids.address, ids.zone],
    );
    try {
      const candidates = await findCandidates(null);
      expect(candidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(true);
    } finally {
      await dataSource.query(`DELETE FROM orders WHERE id = $1`, [order.id]);
      await dataSource.query(`UPDATE orders SET deleted_at = NULL WHERE id = $1`, [ids.blockingOrder]);
    }
  });

  it('نفس الطلب بعد soft-delete: الفني مبيتستبعدش — مبقاش "محبوس" كمشغول للأبد', async () => {
    await dataSource.query(`UPDATE orders SET deleted_at = now() WHERE id = $1`, [ids.blockingOrder]);

    const candidates = await findCandidates();
    expect(candidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(true);

    // نرجّع الحالة الأصلية عشان اختبار تاني (لو اتعاد تشغيله) يلاقي نفس السطر الأول.
    await dataSource.query(`UPDATE orders SET deleted_at = NULL WHERE id = $1`, [ids.blockingOrder]);
  });

  it('نداءا recovery متتاليان لنفس الطلب لا ينشئان جولتين بينما العرض الأول ما زال حيًا', async () => {
    await dataSource.query(`UPDATE orders SET deleted_at = now() WHERE id = $1`, [ids.blockingOrder]);
    const [order] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, placed_at)
       VALUES ($1, $2, $3, $4, $5, 'searching_technician', now())
       RETURNING id`,
      [`REC-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    ids.recoveredOrder = order.id;

    await matchingService.dispatchNextRound(ids.recoveredOrder);
    await matchingService.dispatchNextRound(ids.recoveredOrder);

    const [state] = await dataSource.query(
      `SELECT count(*)::integer AS assignment_count,
              max(assignment_round)::integer AS max_round
       FROM order_assignments
       WHERE order_id = $1`,
      [ids.recoveredOrder],
    );
    expect(state).toEqual({ assignment_count: 1, max_round: 1 });
    expect(queueAdd).toHaveBeenCalledTimes(1);

    await dataSource.query(`UPDATE orders SET deleted_at = NULL WHERE id = $1`, [ids.blockingOrder]);
  });

  // ADR-0018 §3-4-6 — أي طلب غير طوارئ (مجدول عادي أو "Quick Job"، بغض النظر عن قرب/بُعد اليوم
  // المطلوب) لازم يتأكد تلقائيًا فورًا بلا انتظار قبول فني — بلا أي order_assignments SENT/VIEWED،
  // الطلب يوصل مباشرة لـACCEPTED بفني محدد.
  it('autoConfirmScheduledOrder: طلب بعد أسبوعين بيتأكد تلقائيًا لأفضل فني مؤهّل بلا انتظار قبول', async () => {
    const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const [order] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, scheduled_at, placed_at)
       VALUES ($1, $2, $3, $4, $5, 'searching_technician', 10000, $6, now())
       RETURNING id`,
      [`FAR-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, twoWeeksFromNow],
    );
    const orderId = order.id as string;

    const result = await matchingService.autoConfirmScheduledOrder(orderId);
    expect(result).toEqual({ dispatched: 1 });

    const [updated] = await dataSource.query(
      `SELECT order_status, technician_id FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(updated.order_status).toBe('accepted');
    expect(updated.technician_id).toBe(ids.technicianProfile);

    const assignments = await dataSource.query(
      `SELECT assignment_status FROM order_assignments WHERE order_id = $1`,
      [orderId],
    );
    expect(assignments).toEqual([{ assignment_status: 'accepted' }]);

    await dataSource.query(`DELETE FROM order_assignments WHERE order_id = $1`, [orderId]);
    await dataSource.query(`DELETE FROM order_status_history WHERE order_id = $1`, [orderId]);
    await dataSource.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
  });

  // ADR-0018 §3-4-6 — isEmergencyOrder (dispatchOrAutoConfirm الداخلية) هي الفاصل الوحيد دلوقتي،
  // مش قرب/بُعد اليوم المطلوب: طوارئ (booking_mode='emergency', بلا scheduled_at) بتاخد دورة
  // طلب/قبول-رفض حقيقية (dispatchNextRound، assignment بحالة 'sent' يستنى رد الفني)، أي طلب تاني
  // — حتى لو مجدول بعد 3 أيام بس مش طوارئ — بيتأكد تلقائيًا فورًا (autoConfirmScheduledOrder)
  // **بصف order_assignments واحد بحالة 'accepted' مباشرة** (سجل تدقيق مين اتأكّد له الطلب، مش
  // دورة طلب/رد فعلية — مطابق تمامًا لسلوك autoConfirmScheduledOrder الموثّق والمُختبر في الاختبار
  // اللي فوق ده بالحرف)، مش صفر assignments زي ما كان متوقّع هنا غلط في نسخة سابقة من الاختبار ده.
  it('dispatchOrAutoConfirm: طوارئ = دورة قبول/رفض (order_assignments بحالة sent)، مجدول بعد 3 أيام = تأكيد مباشر (order_assignments بحالة accepted فورًا)', async () => {
    const [emergencyOrder] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, booking_mode, order_type, placed_at)
       VALUES ($1, $2, $3, $4, $5, 'searching_technician', 10000, 'emergency', 'emergency', now())
       RETURNING id`,
      [`EMG-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    await matchingService.dispatchOrAutoConfirm(emergencyOrder.id);
    const emergencyAssignments = await dataSource.query(`SELECT id FROM order_assignments WHERE order_id = $1`, [emergencyOrder.id]);
    expect(emergencyAssignments.length).toBeGreaterThan(0);
    await dataSource.query(`DELETE FROM order_assignments WHERE order_id = $1`, [emergencyOrder.id]);
    await dataSource.query(`DELETE FROM orders WHERE id = $1`, [emergencyOrder.id]);

    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const [scheduledOrder] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, scheduled_at, placed_at)
       VALUES ($1, $2, $3, $4, $5, 'searching_technician', 10000, $6, now())
       RETURNING id`,
      [`SCHED-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, threeDaysFromNow],
    );
    await matchingService.dispatchOrAutoConfirm(scheduledOrder.id);
    const [scheduledUpdated] = await dataSource.query(`SELECT order_status FROM orders WHERE id = $1`, [scheduledOrder.id]);
    expect(scheduledUpdated.order_status).toBe('accepted');
    // صف واحد بحالة 'accepted' مباشرة — سجل تدقيق "مين اتأكّد له الطلب"، مش دورة طلب/رد
    // (بعكس الطوارئ فوق اللي عندها assignment بحالة 'sent' يستنى رد الفني).
    const scheduledAssignments = await dataSource.query(`SELECT assignment_status FROM order_assignments WHERE order_id = $1`, [
      scheduledOrder.id,
    ]);
    expect(scheduledAssignments).toEqual([{ assignment_status: 'accepted' }]);
    await dataSource.query(`DELETE FROM order_assignments WHERE order_id = $1`, [scheduledOrder.id]);
    await dataSource.query(`DELETE FROM order_status_history WHERE order_id = $1`, [scheduledOrder.id]);
    await dataSource.query(`DELETE FROM orders WHERE id = $1`, [scheduledOrder.id]);
  });

  // ADR-0035 (طلب مالك صريح 2026-08-25، docs/08 §56 بند 5) — انقسام 48 ساعة. بيراجع الاختبار
  // اللي فوق جزئيًا: "مجدول بعد 3 أيام = تأكيد مباشر" **لسه صح** (3 أيام > 48 ساعة)، لكن
  // "أي طلب مش طوارئ بيتأكّد تلقائيًا مهما كان قرب الموعد" مابقاش صح — شغل خلال 48 ساعة بقى
  // بياخد دورة طلب/قبول زي الطوارئ، عشان الفني ما يتفاجأش بشغل بكرة اتعيّنله وهو مش عارف.
  it('dispatchOrAutoConfirm: مجدول خلال 48 ساعة = دورة طلب/قبول (sent)، وبعد 5 أيام = تأكيد تلقائي (ADR-0035)', async () => {
    const inOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [nearOrder] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, scheduled_at, placed_at)
       VALUES ($1, $2, $3, $4, $5, 'searching_technician', 10000, $6, now())
       RETURNING id`,
      [`NEAR-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, inOneDay],
    );
    await matchingService.dispatchOrAutoConfirm(nearOrder.id);
    const [nearUpdated] = await dataSource.query(`SELECT order_status FROM orders WHERE id = $1`, [nearOrder.id]);
    // لسه بيدوّر — مستني رد الفني، مش اتأكّد تلقائيًا.
    expect(nearUpdated.order_status).toBe('searching_technician');
    const nearAssignments = await dataSource.query(
      `SELECT assignment_status, assignment_round, expires_at, sent_at FROM order_assignments WHERE order_id = $1`,
      [nearOrder.id],
    );
    expect(nearAssignments.length).toBeGreaterThan(0);
    expect(nearAssignments.every((a: { assignment_status: string }) => a.assignment_status === 'sent')).toBe(true);
    // كادينس الموجة الأولى = 5 دقايق (matching.near_term_round_timeouts_minutes = "5,15,30")،
    // مش مهلة الطوارئ القصيرة (20 ثانية) ولا الافتراضي القديم (30 ثانية).
    const firstRound = nearAssignments[0] as { expires_at: string; sent_at: string };
    const windowMinutes = (new Date(firstRound.expires_at).getTime() - new Date(firstRound.sent_at).getTime()) / 60000;
    expect(Math.round(windowMinutes)).toBe(5);
    await dataSource.query(`DELETE FROM order_assignments WHERE order_id = $1`, [nearOrder.id]);
    await dataSource.query(`DELETE FROM order_status_history WHERE order_id = $1`, [nearOrder.id]);
    await dataSource.query(`DELETE FROM orders WHERE id = $1`, [nearOrder.id]);

    const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const [farOrder] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, scheduled_at, placed_at)
       VALUES ($1, $2, $3, $4, $5, 'searching_technician', 10000, $6, now())
       RETURNING id`,
      [`FAR-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, inFiveDays],
    );
    await matchingService.dispatchOrAutoConfirm(farOrder.id);
    const [farUpdated] = await dataSource.query(`SELECT order_status FROM orders WHERE id = $1`, [farOrder.id]);
    expect(farUpdated.order_status).toBe('accepted');
    await dataSource.query(`DELETE FROM order_assignments WHERE order_id = $1`, [farOrder.id]);
    await dataSource.query(`DELETE FROM order_status_history WHERE order_id = $1`, [farOrder.id]);
    await dataSource.query(`DELETE FROM orders WHERE id = $1`, [farOrder.id]);
  });

  // ADR-0018 §9 (طلب صريح من المالك 2026-08-19) — طلب طوارئ "إضافي" مش شاغل يوم كامل: فني عنده
  // طلب accepted (مقبول بس لسه ما بداش يتحرّك ليه) لازم يفضل مؤهّل لطوارئ جديدة، بس فني منشغل
  // جسديًا فعليًا (technician_on_way/arrived/in_progress) لازم يتستبعد. الاختبار بيثبت الاتنين
  // معًا (A/B على نفس الفني، بس بحالة الطلب المختلفة) — ده الفرق الجوهري بين
  // ACTIVE_TECHNICIAN_ORDER_STATUSES وENGAGED_TECHNICIAN_ORDER_STATUSES.
  it('طوارئ إضافي مش شاغل يوم كامل: accepted بيفضل مؤهّل، technician_on_way بيتستبعد (§9)', async () => {
    // في اللحظة دي ids.blockingOrder فعلاً 'accepted' بلا scheduled_at (نفس حالة الاختبار
    // اللي فات) — طلب طوارئ جديد لازم يلاقي الفني ده مؤهّل.
    const [acceptedStateOrder] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, booking_mode, order_type, placed_at)
       VALUES ($1, $2, $3, $4, $5, 'searching_technician', 10000, 'emergency', 'emergency', now())
       RETURNING id`,
      [`EMG9A-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    await matchingService.dispatchOrAutoConfirm(acceptedStateOrder.id);
    const acceptedStateAssignments = await dataSource.query(
      `SELECT technician_id FROM order_assignments WHERE order_id = $1`,
      [acceptedStateOrder.id],
    );
    expect(acceptedStateAssignments.some((a: { technician_id: string }) => a.technician_id === ids.technicianProfile)).toBe(
      true,
    );
    await dataSource.query(`DELETE FROM order_assignments WHERE order_id = $1`, [acceptedStateOrder.id]);
    await dataSource.query(`DELETE FROM orders WHERE id = $1`, [acceptedStateOrder.id]);

    // نفس الفني، بس دلوقتي منشغل جسديًا فعليًا (technician_on_way) — طلب طوارئ جديد لازم يستبعده.
    await dataSource.query(`UPDATE orders SET order_status = 'technician_on_way' WHERE id = $1`, [ids.blockingOrder]);
    const [engagedStateOrder] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, booking_mode, order_type, placed_at)
       VALUES ($1, $2, $3, $4, $5, 'searching_technician', 10000, 'emergency', 'emergency', now())
       RETURNING id`,
      [`EMG9B-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    await matchingService.dispatchOrAutoConfirm(engagedStateOrder.id);
    const engagedStateAssignments = await dataSource.query(
      `SELECT technician_id FROM order_assignments WHERE order_id = $1`,
      [engagedStateOrder.id],
    );
    expect(engagedStateAssignments.some((a: { technician_id: string }) => a.technician_id === ids.technicianProfile)).toBe(
      false,
    );
    await dataSource.query(`DELETE FROM order_assignments WHERE order_id = $1`, [engagedStateOrder.id]);
    await dataSource.query(`DELETE FROM orders WHERE id = $1`, [engagedStateOrder.id]);

    // نرجّع الحالة الأصلية (accepted) عشان باقي الاختبارات في الملف ده تفضل تلاقي نفس الافتراض.
    await dataSource.query(`UPDATE orders SET order_status = 'accepted' WHERE id = $1`, [ids.blockingOrder]);
  });

  // ADR-0018 §14 (طلب المالك — "فني حاظر يوم بعينه بيتستبعد صح") — استثناء `blocked` صريح حدده
  // الفني بنفسه (technician_schedule_slots) لازم يستبعده بس لليوم المحدد ده تحديدًا (بتوقيت مصر
  // الصحيح بعد إصلاح ADR-0018 §2)، مش أي يوم تاني. `blockedDay` بتاعت الاختبار محسوبة بـنص
  // النهار UTC عمدًا — دايمًا نفس اليوم التقويمي بتوقيت مصر (+2/+3) بغض النظر عن توقيت جهاز
  // التشغيل نفسه، وslot_date بتتحسب داخل Postgres (`AT TIME ZONE 'Africa/Cairo'`) مش في JS —
  // نفس مصدر الحقيقة اللي الكود الحقيقي بيستخدمه بالظبط.
  it('فني حاظر يوم بعينه بيتستبعد بس لليوم ده — يوم تاني يفضل مؤهّل (ADR-0018 §2/§14)', async () => {
    const blockedDay = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    blockedDay.setUTCHours(12, 0, 0, 0);
    const otherDay = new Date(blockedDay.getTime() + 24 * 60 * 60 * 1000);

    const [slot] = await dataSource.query(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, ($2::timestamptz AT TIME ZONE 'Africa/Cairo')::date, '00:00', '23:59', 'blocked')
       RETURNING id`,
      [ids.technicianProfile, blockedDay],
    );

    try {
      const blockedDayCandidates = await findCandidates(blockedDay);
      expect(blockedDayCandidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(false);

      const otherDayCandidates = await findCandidates(otherDay);
      expect(otherDayCandidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(true);
    } finally {
      await dataSource.query(`DELETE FROM technician_schedule_slots WHERE id = $1`, [slot.id]);
    }
  });

  // ADR-0017 بند 10 — Fallback توسيع النطاق: طلب ASAP وصل لعتبة matching.broaden_to_busy_after_round
  // بلا أي فني مؤهّل ومتاح، لازم يوسّع البحث ليشمل الفني المشغول ده (مؤهّل لنفس الخدمة/المنطقة،
  // بس عنده طلب accepted نشط دلوقتي — ids.blockingOrder) بدل ما يفضل عالق بلا أي محاولة.
  it('Fallback: طلب ASAP بيوصل لفني مشغول (ids.blockingOrder نشط) بعد ما يعدّي عتبة التوسيع', async () => {
    const broadenSettingsService = {
      getNumber: jest.fn(async (key: string, fallback: number) => (key === 'matching.broaden_to_busy_after_round' ? 1 : fallback)),
      getString: jest.fn(async (_key: string, fallback: string) => fallback),
    };
    const broadenQueueAdd = jest.fn().mockResolvedValue(undefined);
    const broadenMatchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      new TechnicianAssignmentGuardService(broadenSettingsService as never),
      broadenSettingsService as never,
      { emit: jest.fn() } as never,
      { add: broadenQueueAdd } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      levelPremiumServiceStub(),
    );

    const [order] = await dataSource.query(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents, placed_at)
       VALUES ($1, $2, $3, $4, $5, 'searching_technician', 10000, now())
       RETURNING id`,
      [`BROAD-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );

    await broadenMatchingService.dispatchNextRound(order.id);

    const assignments = await dataSource.query(
      `SELECT technician_id FROM order_assignments WHERE order_id = $1`,
      [order.id],
    );
    expect(assignments.some((a: { technician_id: string }) => a.technician_id === ids.technicianProfile)).toBe(true);

    await dataSource.query(`DELETE FROM order_assignments WHERE order_id = $1`, [order.id]);
    await dataSource.query(`DELETE FROM orders WHERE id = $1`, [order.id]);
  });
});
