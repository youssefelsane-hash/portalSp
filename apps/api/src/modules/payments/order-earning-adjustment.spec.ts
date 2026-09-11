import { DataSource } from 'typeorm';
import { AdminEarningsPolicyService } from './admin-earnings-policy.service';
import { EarningsPolicyService } from './earnings-policy.service';
import { ApiException } from '../../common/exceptions/api.exception';
import { insertV2EarningShare } from './order-earning-share.testing';

/**
 * **استثناء المستحقات على طلب واحد بعينه — مسار الكتابة الكامل** (docs/08 §136).
 *
 * `order_earning_adjustments` كان بيتقرا في محرك التسوية من migration 0227 وبيتضرب في وزن
 * المشارك صح، بس **مفيش أي endpoint ولا خدمة بتكتب فيه** — يعني الاستثناء ده كان مستحيل
 * الأدمن يعمله رغم إن النظام جاهز يحسبه. السبيك ده بيغطّي المسار الجديد كله.
 *
 * التركيز على **الحارسين** اللي مش موجودين في استثناء الشخص، لأن غيابهم بينتج «نجاح كاذب»:
 * الأدمن يشوف اتحفظ ✅ والفلوس ماتتغيرش.
 */
describe('استثناء مستحقات الطلب الواحد — حي', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let admin: AdminEarningsPolicyService;
  let earnings: EarningsPolicyService;
  const runId = Date.now().toString(36);
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  const ids = {
    adminUserId: '', customerUserId: '', customerId: '', addressId: '', cityId: '', zoneId: '',
    categoryId: '', serviceId: '',
    leaderUserId: '', leaderId: '', assistantUserId: '', assistantId: '',
    outsiderUserId: '', outsiderId: '',
    orderId: '', settledOrderId: '', v1OrderId: '',
  };

  async function makeUser(tag: string, userType: string): Promise<string> {
    const [row] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,$3::user_type) RETURNING id`,
      [`+2096${runId}${tag}`.slice(0, 15), `${tag} ${runId}`, userType],
    );
    return (row as { id: string }).id;
  }

  async function makeTechnician(userId: string, code: string, kind: string): Promise<string> {
    const [row] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, current_level, technician_kind, verification_status)
       VALUES ($1,$2,'professional'::technician_level,$3::technician_kind,'approved') RETURNING id`,
      [userId, `OEA${code}${runId}`.slice(0, 20), kind],
    );
    return (row as { id: string }).id;
  }

  async function makeOrder(suffix: string, policyVersion = 2): Promise<string> {
    const [row] = await q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
         service_zone_id, order_status, payment_status, total_amount_cents, commissionable_base_cents,
         technician_id, technician_earning_cents, booking_mode, settlement_policy_version)
       VALUES (20,$1,$2,$3,$4,$5,'work_completed','unpaid',100000,100000,$6,0,'team',$7)
       RETURNING id`,
      [`OEA${suffix}-${runId}`.slice(0, 24), ids.customerId, ids.serviceId, ids.addressId,
       ids.zoneId, ids.leaderId, policyVersion],
    );
    const orderId = (row as { id: string }).id;
    await q(
      `INSERT INTO order_team_members (order_id, technician_id, role_label, member_type, added_by_technician_id)
       VALUES ($1,$2,'مساعد','assistant',$3)`,
      [orderId, ids.assistantId, ids.leaderId],
    );
    return orderId;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
    admin = new AdminEarningsPolicyService(dataSource, { record: async () => undefined } as never);
    earnings = new EarningsPolicyService(dataSource);

    ids.adminUserId = await makeUser('adm', 'admin');
    ids.customerUserId = await makeUser('cus', 'customer');
    ids.leaderUserId = await makeUser('ldr', 'technician');
    ids.assistantUserId = await makeUser('ast', 'technician');
    ids.outsiderUserId = await makeUser('out', 'technician');

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [(country as { id: string }).id, `مدينة ${runId}`, `City ${runId}`, `oea-city-${runId}`],
    );
    ids.cityId = (city as { id: string }).id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.cityId, `نطاق ${runId}`, `Zone ${runId}`],
    );
    ids.zoneId = (zone as { id: string }).id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة ${runId}`, `Cat ${runId}`, `oea-cat-${runId}`],
    );
    ids.categoryId = (category as { id: string }).id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage)
       VALUES ($1,$2,$3,'formula',100000,20) RETURNING id`,
      [ids.categoryId, `خدمة ${runId}`, `oea-svc-${runId}`],
    );
    ids.serviceId = (service as { id: string }).id;

    const [customer] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUserId]);
    ids.customerId = (customer as { id: string }).id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,'شارع الاختبار','1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
      [ids.customerUserId, ids.cityId],
    );
    ids.addressId = (address as { id: string }).id;

    ids.leaderId = await makeTechnician(ids.leaderUserId, 'L', 'technician');
    ids.assistantId = await makeTechnician(ids.assistantUserId, 'A', 'assistant');
    ids.outsiderId = await makeTechnician(ids.outsiderUserId, 'O', 'technician');

    ids.orderId = await makeOrder('A');
    ids.settledOrderId = await makeOrder('S');
    ids.v1OrderId = await makeOrder('V', 1);

    // الطلب المتسوّى: حصص مسجّلة فعلاً — ده اللي بيخلّي أي استثناء بعدها بلا أثر.
    await insertV2EarningShare(q, {
      orderId: ids.settledOrderId, technicianId: ids.leaderId, participantRole: 'leader',
      poolCents: 80_000, shareCents: 80_000,
    });
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const orderIds = [ids.orderId, ids.settledOrderId, ids.v1OrderId].filter(Boolean);
    await q(`DELETE FROM order_earning_adjustments WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM order_earning_shares WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM order_team_members WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.addressId]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerId]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`,
      [[ids.leaderId, ids.assistantId, ids.outsiderId]]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.serviceId]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.categoryId]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zoneId]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.cityId]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[
      ids.adminUserId, ids.customerUserId, ids.leaderUserId, ids.assistantUserId, ids.outsiderUserId,
    ]]);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await q(`DELETE FROM order_earning_adjustments WHERE order_id = ANY($1::uuid[])`,
      [[ids.orderId, ids.settledOrderId, ids.v1OrderId]]);
  });

  /** أسهل من `expect().rejects` لما عايزين نقرا الحالة والرسالة مع بعض. */
  async function failure(work: () => Promise<unknown>): Promise<ApiException> {
    try {
      await work();
    } catch (err) {
      return err as ApiException;
    }
    throw new Error('كان المفروض يترفض، لكنه عدّى');
  }

  it('بيتكتب ووصل لمحرك التسوية فعلاً — مش مجرد صف في جدول', async () => {
    await admin.createOrderAdjustment(ids.adminUserId, ids.orderId, {
      technician_id: ids.leaderId, adjustment_bps: 2_000, reason: 'شغلانة أصعب من المعتاد',
    });

    // الادعاء الحقيقي: الرقم بيوصل للحسبة. صف في الجدول بلا أثر هو بالظبط الحالة اللي
    // الميزة دي اتعملت عشانها.
    const before = 80_000;
    const result = await earnings.calculateOrder(ids.orderId, 100_000);
    const leader = result.participantShares.find((row) => row.technicianId === ids.leaderId)!;
    const assistant = result.participantShares.find((row) => row.technicianId === ids.assistantId)!;

    expect(leader.orderAdjustmentBps).toBe(2_000);
    expect(assistant.orderAdjustmentBps).toBe(0);
    expect(result.workerPoolCents).toBe(before);
    // وعاء العمّال ثابت: الاستثناء بيعيد التوزيع جوّه الطاقم، مش بيزوّد الفلوس من المنصة.
    expect(leader.shareCents + assistant.shareCents).toBe(before);
  });

  it('استثناء سالب بيقلّل نصيبه ويزوّد نصيب باقي الطاقم — والعمولة ماتتحركش', async () => {
    const before = await earnings.calculateOrder(ids.orderId, 100_000);
    const leaderBefore = before.participantShares.find((r) => r.technicianId === ids.leaderId)!.shareCents;
    const assistantBefore = before.participantShares.find((r) => r.technicianId === ids.assistantId)!.shareCents;

    await admin.createOrderAdjustment(ids.adminUserId, ids.orderId, {
      technician_id: ids.leaderId, adjustment_bps: -3_000, reason: 'العميل اشتكى من جودة التنفيذ',
    });

    const after = await earnings.calculateOrder(ids.orderId, 100_000);
    expect(after.participantShares.find((r) => r.technicianId === ids.leaderId)!.shareCents)
      .toBeLessThan(leaderBefore);
    expect(after.participantShares.find((r) => r.technicianId === ids.assistantId)!.shareCents)
      .toBeGreaterThan(assistantBefore);
    expect(after.platformCommissionCents).toBe(before.platformCommissionCents);
  });

  it('حفظ تاني على نفس (الطلب، الشخص) بيستبدل النشط ويسيب القديم في السجل معطّل', async () => {
    await admin.createOrderAdjustment(ids.adminUserId, ids.orderId, {
      technician_id: ids.leaderId, adjustment_bps: 1_000, reason: 'تقدير أولي',
    });
    await admin.createOrderAdjustment(ids.adminUserId, ids.orderId, {
      technician_id: ids.leaderId, adjustment_bps: 2_500, reason: 'مراجعة بعد كلام العميل',
    });

    const rows = (await q(
      `SELECT adjustment_bps, disabled_at FROM order_earning_adjustments
        WHERE order_id = $1 AND technician_id = $2 ORDER BY created_at`,
      [ids.orderId, ids.leaderId],
    )) as { adjustment_bps: number; disabled_at: string | null }[];

    expect(rows).toHaveLength(2);
    // القرار القديم مابيتمسحش — السجل لازم يفضل شايل إن فيه قرار اتغيّر.
    expect(rows[0].disabled_at).not.toBeNull();
    expect(rows[1].disabled_at).toBeNull();

    const participants = await earnings.resolveParticipants(ids.orderId);
    expect(participants.find((p) => p.technicianId === ids.leaderId)!.orderAdjustmentBps).toBe(2_500);
  });

  it('الإلغاء بيرجّع الوزن لطبيعته والصف بيفضل موجود معطّل', async () => {
    await admin.createOrderAdjustment(ids.adminUserId, ids.orderId, {
      technician_id: ids.assistantId, adjustment_bps: 1_500, reason: 'مجهود إضافي',
    });
    await admin.disableOrderAdjustment(ids.adminUserId, ids.orderId, ids.assistantId, 'اتضح إنه مستحقش');

    const participants = await earnings.resolveParticipants(ids.orderId);
    expect(participants.find((p) => p.technicianId === ids.assistantId)!.orderAdjustmentBps).toBe(0);

    const [row] = (await q(
      `SELECT disabled_at FROM order_earning_adjustments WHERE order_id = $1 AND technician_id = $2`,
      [ids.orderId, ids.assistantId],
    )) as { disabled_at: string | null }[];
    expect(row.disabled_at).not.toBeNull();
  });

  it('إلغاء استثناء مش موجود بيترفض بوضوح بدل ما يعدّي في صمت', async () => {
    const err = await failure(() =>
      admin.disableOrderAdjustment(ids.adminUserId, ids.orderId, ids.leaderId, 'مفيش حاجة'));
    expect(err.getStatus()).toBe(404);
  });

  // ═══ الحارسان اللي بيمنعوا «النجاح الكاذب» ═══

  it('⛔ بعد ما التسوية تتقفل: الحفظ بيترفض بـ409 بدل ما يقول اتحفظ ✅ ومايأثرش', async () => {
    // `recordV2Shares()` idempotent: أول ما الحصص تتسجّل مابيعيدش الحساب أبدًا. فاستثناء
    // بيتكتب بعد كده صف ميت — والأدمن هيفتكر إنه عدّل مستحق الفني.
    const err = await failure(() =>
      admin.createOrderAdjustment(ids.adminUserId, ids.settledOrderId, {
        technician_id: ids.leaderId, adjustment_bps: 2_000, reason: 'متأخر',
      }));
    expect(err.getStatus()).toBe(409);
    expect(err.message).toContain('التسوية اتقفلت');

    const [count] = (await q(
      `SELECT COUNT(*)::int AS n FROM order_earning_adjustments WHERE order_id = $1`,
      [ids.settledOrderId],
    )) as { n: number }[];
    expect(count.n).toBe(0);
  });

  it('⛔ الإلغاء بعد التسوية بيترفض كمان — مايوهمش الأدمن إنه رجّع مبلغ', async () => {
    const err = await failure(() =>
      admin.disableOrderAdjustment(ids.adminUserId, ids.settledOrderId, ids.leaderId, 'رجوع'));
    expect(err.getStatus()).toBe(409);
  });

  it('⛔ شخص مش مشارك في الطلب بيترفض — الاستعلام أصلاً مش هيقرا صفه', async () => {
    const err = await failure(() =>
      admin.createOrderAdjustment(ids.adminUserId, ids.orderId, {
        technician_id: ids.outsiderId, adjustment_bps: 1_000, reason: 'اختيار غلط من القايمة',
      }));
    expect(err.getStatus()).toBe(400);
    expect(err.message).toContain('مش مشارك');
  });

  it('⛔ طلب على تسوية V1 بيترفض — المحرك القديم مابيقراش الجدول ده خالص', async () => {
    const err = await failure(() =>
      admin.createOrderAdjustment(ids.adminUserId, ids.v1OrderId, {
        technician_id: ids.leaderId, adjustment_bps: 1_000, reason: 'طلب قديم',
      }));
    expect(err.getStatus()).toBe(409);
  });

  it('طلب مش موجود بيرجّع ٤٠٤ مش ٥٠٠', async () => {
    const err = await failure(() =>
      admin.createOrderAdjustment(ids.adminUserId, '00000000-0000-7000-8000-0000000000ff', {
        technician_id: ids.leaderId, adjustment_bps: 1_000, reason: 'طلب وهمي',
      }));
    expect(err.getStatus()).toBe(404);
  });

  // ═══ القراءة اللي الواجهة بتعتمد عليها ═══

  it('القايمة بتقول للواجهة إن التسوية اتقفلت — عشان تقفل الفورم قبل ما الأدمن يكتب', async () => {
    const open = await admin.listOrderAdjustments(ids.orderId);
    expect(open.is_settled).toBe(false);
    expect(open.supports_order_adjustments).toBe(true);

    const settled = await admin.listOrderAdjustments(ids.settledOrderId);
    expect(settled.is_settled).toBe(true);

    const v1 = await admin.listOrderAdjustments(ids.v1OrderId);
    expect(v1.supports_order_adjustments).toBe(false);
  });

  it('القايمة بترجّع النشط بس ومعاه اسم صاحبه ودوره', async () => {
    await admin.createOrderAdjustment(ids.adminUserId, ids.orderId, {
      technician_id: ids.leaderId, adjustment_bps: 1_200, reason: 'شغل إضافي',
    });
    await admin.createOrderAdjustment(ids.adminUserId, ids.orderId, {
      technician_id: ids.assistantId, adjustment_bps: 800, reason: 'مجهود مساعد',
    });
    await admin.disableOrderAdjustment(ids.adminUserId, ids.orderId, ids.assistantId, 'اتلغى');

    const result = await admin.listOrderAdjustments(ids.orderId);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      technician_id: ids.leaderId, adjustment_bps: 1_200, participant_role: 'leader',
    });
    // الاسم بييجي من `users` — الواجهة مش هتقدر تعرض معرّف UUID للأدمن.
    expect(String(result.items[0].technician_name)).toContain(runId);
  });
});
