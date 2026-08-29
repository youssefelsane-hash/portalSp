import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AdminExceptionCenterService } from './admin-exception-center.service';
import { SettingsService } from '../settings/settings.service';

const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback } as unknown as SettingsService;

// اختبار حي — مركز الاستثناءات/التنبيهات (docs/08 §36.9). نقص طاقم مصعّد ومفتوح + توزيع متأخر،
// الاتنين ضد Postgres حقيقي، بلا أي بيانات استثناء مصطنعة.
describe('AdminExceptionCenterService.getExceptions() (docs/08 §36.9)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = {
    country: '',
    city: '',
    zoneA: '',
    zoneB: '',
    categoryA: '',
    categoryB: '',
    serviceA: '',
    serviceB: '',
    customerProfile: '',
    address: '',
  };
  const users: string[] = [];
  const technicianProfiles: string[] = [];
  const orderIds: string[] = [];
  const teamMemberIds: string[] = [];
  const assignmentIds: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  function service() {
    return new AdminExceptionCenterService(dataSource, settingsServiceStub);
  }

  async function insertTechnician(label: string) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+21${String(users.length).padStart(2, '0')}${runId}`.slice(0, 15),
      `فني استثناء ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,'new','approved',true) RETURNING id`,
      [user.id, `OPSEX${label}${runId}`.slice(0, 20)],
    );
    technicianProfiles.push(profile.id);
    return profile.id as string;
  }

  async function insertTeamOrder(opts: {
    leaderId: string;
    categoryId: string;
    serviceId: string;
    zoneId: string;
    requiredTechnicians: number;
    requiredAssistants: number;
    escalated: boolean;
    scheduledAgoHours: number;
    orderStatus?: string;
  }) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status,
         booking_mode, required_technicians, required_assistants, total_amount_cents, technician_earning_cents, scheduled_at, crew_shortage_escalated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','team',$8,$9,50000,0,
         now() - ($10::text || ' hours')::interval,
         CASE WHEN $11::boolean THEN now() - interval '1 hour' ELSE NULL END)
       RETURNING id`,
      [
        `TESTEX-${randomUUID().slice(0, 8)}`,
        ids.customerProfile,
        opts.leaderId,
        opts.serviceId,
        ids.address,
        opts.zoneId,
        opts.orderStatus ?? 'technician_assigned',
        opts.requiredTechnicians,
        opts.requiredAssistants,
        opts.scheduledAgoHours,
        opts.escalated,
      ],
    );
    orderIds.push(order.id);
    return order.id as string;
  }

  async function addTeamMember(orderId: string, technicianId: string, memberType: 'team_member' | 'assistant', addedBy: string) {
    const [row] = await q(
      `INSERT INTO order_team_members (order_id, technician_id, role_label, member_type, added_by_technician_id) VALUES ($1,$2,'x',$3,$4) RETURNING id`,
      [orderId, technicianId, memberType, addedBy],
    );
    teamMemberIds.push(row.id);
  }

  async function insertStaleAssignment(orderId: string, technicianId: string, expiredMinutesAgo: number) {
    const [row] = await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'sent', now() - interval '30 minutes', now() - ($3::text || ' minutes')::interval)
       RETURNING id`,
      [orderId, technicianId, expiredMinutesAgo],
    );
    assignmentIds.push(row.id);
    return row.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak' });
    await dataSource.initialize();

    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة استثناء ${runId}`,
      `Exception City ${runId}`,
      `test-ex-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zoneA] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق استثناء أ ${runId}`,
      `Exception Zone A ${runId}`,
    ]);
    ids.zoneA = zoneA.id;
    const [zoneB] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق استثناء ب ${runId}`,
      `Exception Zone B ${runId}`,
    ]);
    ids.zoneB = zoneB.id;
    const [categoryA] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة استثناء أ ${runId}`,
      `Exception Category A ${runId}`,
      `test-ex-cat-a-${runId}`,
    ]);
    ids.categoryA = categoryA.id;
    const [categoryB] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة استثناء ب ${runId}`,
      `Exception Category B ${runId}`,
      `test-ex-cat-b-${runId}`,
    ]);
    ids.categoryB = categoryB.id;
    const [serviceA] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',50000,20,0,60) RETURNING id`,
      [ids.categoryA, `خدمة استثناء أ ${runId}`, `test-ex-svc-a-${runId}`],
    );
    ids.serviceA = serviceA.id;
    const [serviceB] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',50000,20,0,60) RETURNING id`,
      [ids.categoryB, `خدمة استثناء ب ${runId}`, `test-ex-svc-b-${runId}`],
    );
    ids.serviceB = serviceB.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2064${runId}`.slice(0, 15),
      `عميل استثناء ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع استثناء ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      if (assignmentIds.length) await q(`DELETE FROM order_assignments WHERE id = ANY($1::uuid[])`, [assignmentIds]);
      if (teamMemberIds.length) await q(`DELETE FROM order_team_members WHERE id = ANY($1::uuid[])`, [teamMemberIds]);
      if (orderIds.length) await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.serviceA, ids.serviceB]]);
      await q(`DELETE FROM service_categories WHERE id = ANY($1)`, [[ids.categoryA, ids.categoryB]]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1)`, [[ids.zoneA, ids.zoneB]]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  }, 15000);

  it('طلب مصعّد ولسه ناقص فني/مساعد — يظهر بالعدد الصحيح للنقص', async () => {
    const leader = await insertTechnician('leader1');
    const orderId = await insertTeamOrder({
      leaderId: leader,
      categoryId: ids.categoryA,
      serviceId: ids.serviceA,
      zoneId: ids.zoneA,
      requiredTechnicians: 3,
      requiredAssistants: 1,
      escalated: true,
      scheduledAgoHours: -1,
    });

    const result = await service().getExceptions({ categoryId: ids.categoryA });
    const item = result.crewShortage.items.find((i) => i.orderId === orderId)!;
    expect(item).toBeDefined();
    // requiredTechnicians=3، assigned=0+1(قائد)=1 → missing=2. requiredAssistants=1، assigned=0 → missing=1.
    expect(item.missingTechnicians).toBe(2);
    expect(item.missingAssistants).toBe(1);
  });

  it('طلب مصعّد لكن الطاقم اكتمل فعليًا بعد التصعيد — مايظهرش في القايمة', async () => {
    const leader = await insertTechnician('leader2');
    const member = await insertTechnician('member2');
    const orderId = await insertTeamOrder({
      leaderId: leader,
      categoryId: ids.categoryA,
      serviceId: ids.serviceA,
      zoneId: ids.zoneA,
      requiredTechnicians: 2,
      requiredAssistants: 0,
      escalated: true,
      scheduledAgoHours: -1,
    });
    await addTeamMember(orderId, member, 'team_member', leader);

    const result = await service().getExceptions({ categoryId: ids.categoryA });
    expect(result.crewShortage.items.find((i) => i.orderId === orderId)).toBeUndefined();
  });

  it('طلب فريق مش مصعّد خالص — مايظهرش في القايمة', async () => {
    const leader = await insertTechnician('leader3');
    const orderId = await insertTeamOrder({
      leaderId: leader,
      categoryId: ids.categoryA,
      serviceId: ids.serviceA,
      zoneId: ids.zoneA,
      requiredTechnicians: 3,
      requiredAssistants: 0,
      escalated: false,
      scheduledAgoHours: -1,
    });

    const result = await service().getExceptions({ categoryId: ids.categoryA });
    expect(result.crewShortage.items.find((i) => i.orderId === orderId)).toBeUndefined();
  });

  it('is_overdue=true لطلب مصعّد معاده فات، false لطلب معاده لسه جاي', async () => {
    const leaderPast = await insertTechnician('leader-past');
    const orderPast = await insertTeamOrder({
      leaderId: leaderPast,
      categoryId: ids.categoryA,
      serviceId: ids.serviceA,
      zoneId: ids.zoneA,
      requiredTechnicians: 2,
      requiredAssistants: 0,
      escalated: true,
      scheduledAgoHours: 2,
    });
    const leaderFuture = await insertTechnician('leader-future');
    const orderFuture = await insertTeamOrder({
      leaderId: leaderFuture,
      categoryId: ids.categoryA,
      serviceId: ids.serviceA,
      zoneId: ids.zoneA,
      requiredTechnicians: 2,
      requiredAssistants: 0,
      escalated: true,
      scheduledAgoHours: -3,
    });

    const result = await service().getExceptions({ categoryId: ids.categoryA });
    expect(result.crewShortage.items.find((i) => i.orderId === orderPast)!.isOverdue).toBe(true);
    expect(result.crewShortage.items.find((i) => i.orderId === orderFuture)!.isOverdue).toBe(false);
  });

  it('توزيع متأخر (stale dispatch) — يظهر بغض النظر عن وقت الإرسال طالما expires_at فات', async () => {
    const tech = await insertTechnician('stale');
    const orderId = await insertTeamOrder({
      leaderId: tech,
      categoryId: ids.categoryA,
      serviceId: ids.serviceA,
      zoneId: ids.zoneA,
      requiredTechnicians: 1,
      requiredAssistants: 0,
      escalated: false,
      scheduledAgoHours: -1,
    });
    const assignmentId = await insertStaleAssignment(orderId, tech, 15);

    const result = await service().getExceptions({ categoryId: ids.categoryA });
    const item = result.staleDispatch.items.find((i) => i.assignmentId === assignmentId)!;
    expect(item).toBeDefined();
    expect(item.technicianId).toBe(tech);
  });

  it('assignment لسه مش فات معاده — مايظهرش في stale_dispatch', async () => {
    const tech = await insertTechnician('fresh');
    const orderId = await insertTeamOrder({
      leaderId: tech,
      categoryId: ids.categoryA,
      serviceId: ids.serviceA,
      zoneId: ids.zoneA,
      requiredTechnicians: 1,
      requiredAssistants: 0,
      escalated: false,
      scheduledAgoHours: -1,
    });
    const [row] = await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'sent', now(), now() + interval '10 minutes')
       RETURNING id`,
      [orderId, tech],
    );
    assignmentIds.push(row.id);

    const result = await service().getExceptions({ categoryId: ids.categoryA });
    expect(result.staleDispatch.items.find((i) => i.assignmentId === row.id)).toBeUndefined();
  });

  it('فلتر category_id بيقصر الاتنين (crew_shortage/stale_dispatch) على فئة الطلب المرتبط بس', async () => {
    const leaderA = await insertTechnician('cat-a');
    const orderA = await insertTeamOrder({
      leaderId: leaderA,
      categoryId: ids.categoryA,
      serviceId: ids.serviceA,
      zoneId: ids.zoneA,
      requiredTechnicians: 2,
      requiredAssistants: 0,
      escalated: true,
      scheduledAgoHours: -1,
    });
    const leaderB = await insertTechnician('cat-b');
    const orderB = await insertTeamOrder({
      leaderId: leaderB,
      categoryId: ids.categoryB,
      serviceId: ids.serviceB,
      zoneId: ids.zoneA,
      requiredTechnicians: 2,
      requiredAssistants: 0,
      escalated: true,
      scheduledAgoHours: -1,
    });

    const result = await service().getExceptions({ categoryId: ids.categoryA });
    const orderIdsInResult = result.crewShortage.items.map((i) => i.orderId);
    expect(orderIdsInResult).toContain(orderA);
    expect(orderIdsInResult).not.toContain(orderB);
  });
});
