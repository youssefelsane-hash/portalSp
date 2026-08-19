import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MatchingService } from './matching.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from './entities/order-assignment.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';

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
      { getNumber: jest.fn(async (_key: string, fallback: number) => fallback) } as never,
      { emit: jest.fn() } as never,
      { add: queueAdd } as never,
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
    const [blockingOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted') RETURNING id`,
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
    } as Order;
    // findEligibleTechnicians خاصة (private) — بنستدعيها زي ما هي فعليًا (مش نسخة معاد كتابتها)
    // عشان أي تراجع مستقبلي عن الإصلاح يكسر الاختبار ده فورًا.
    return (matchingService as unknown as { findEligibleTechnicians: (...args: unknown[]) => Promise<{ technician_id: string }[]> })
      .findEligibleTechnicians(order, 50, null, false, null);
  };

  it('طلب accepted غير محذوف: الفني بيتستبعد صح (السلوك الأصلي محفوظ)', async () => {
    const candidates = await findCandidates();
    expect(candidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(false);
  });

  // قرار عمل صريح من المالك (2026-08-19، سيناريو "تسليك مواصير نص يوم") — نفس بَقّة
  // TechnicianAssignmentGuardService.assertEligible() المصلّحة بس هنا في مسار التوزيع الفعلي:
  // فني عنده طلب نشط دلوقتي (accepted) مايترفضش من طلب تاني **مجدول** ليوم بعيد — الاستبعاد
  // القديم كان unconditional بغض النظر عن scheduledAt الطلب المرشّح.
  it('طلب مجدول بعد أسبوع: الفني مبيتستبعدش رغم إن عنده طلب accepted نشط دلوقتي', async () => {
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const candidates = await findCandidates(weekFromNow);
    expect(candidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(true);
  });

  it('طلب ASAP (بلا scheduledAt) لسه بيرفض صح — مفيش تراجع في السلوك القديم', async () => {
    const candidates = await findCandidates(null);
    expect(candidates.some((c) => c.technician_id === ids.technicianProfile)).toBe(false);
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
  // طلب/قبول-رفض حقيقية (dispatchNextRound)، أي طلب تاني — حتى لو مجدول بعد 3 أيام بس مش طوارئ —
  // بيتأكد تلقائيًا فورًا (autoConfirmScheduledOrder) بلا أي order_assignments. بنفحص عبر السلوك
  // الظاهر (هل اتعمل order_assignments أو لأ) بدل الوصول لدالة private مباشرة.
  it('dispatchOrAutoConfirm: طوارئ = دورة قبول/رفض (order_assignments بتتعمل)، مجدول بعد 3 أيام = تأكيد مباشر بلا assignments', async () => {
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
    const scheduledAssignments = await dataSource.query(`SELECT id FROM order_assignments WHERE order_id = $1`, [scheduledOrder.id]);
    expect(scheduledAssignments.length).toBe(0);
    await dataSource.query(`DELETE FROM order_assignments WHERE order_id = $1`, [scheduledOrder.id]);
    await dataSource.query(`DELETE FROM order_status_history WHERE order_id = $1`, [scheduledOrder.id]);
    await dataSource.query(`DELETE FROM orders WHERE id = $1`, [scheduledOrder.id]);
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

  // ADR-0017 بند 10 — Fallback توسيع النطاق: طلب ASAP وصل لعتبة matching.broaden_to_busy_after_round
  // بلا أي فني مؤهّل ومتاح، لازم يوسّع البحث ليشمل الفني المشغول ده (مؤهّل لنفس الخدمة/المنطقة،
  // بس عنده طلب accepted نشط دلوقتي — ids.blockingOrder) بدل ما يفضل عالق بلا أي محاولة.
  it('Fallback: طلب ASAP بيوصل لفني مشغول (ids.blockingOrder نشط) بعد ما يعدّي عتبة التوسيع', async () => {
    const broadenSettingsService = {
      getNumber: jest.fn(async (key: string, fallback: number) => (key === 'matching.broaden_to_busy_after_round' ? 1 : fallback)),
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
