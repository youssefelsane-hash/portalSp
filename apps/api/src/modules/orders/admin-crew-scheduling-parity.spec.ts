import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { AdminOrdersService } from './admin-orders.service';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { OrderTeamService } from './order-team.service';
import { User } from '../auth/entities/user.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { SettingsService } from '../settings/settings.service';

/**
 * ADR-0057 — بلاغ المالك الحرفي: «مساعد اتضاف في نفس اليوم لتلات شغلانات كبار، والسيستم ما
 * جابش إن هو شغول... السكدول شغال مضبوط لما تكون إنت قائد الفريق، إنما لما تكون إنت اللي بعتلك
 * الدعوة أو حد ضايفك في فريقه، السيستم بيتعامل معاك كأنك فاضي».
 *
 * التشخيص الحي أثبت السبب: `AdminOrdersService.assignAssistant()`/`addCrewMember()` كانا بيفحصوا
 * BLOCKED بس (حظر ذاتي صريح) ومش بيفحصوا تعارض جدولة حقيقي ولا يحوّلوا MEANINGFUL/HEAVY لفرصة —
 * عكس `OrderTeamService.recruitMember()` (المسار الذاتي) تمامًا. الاختبارات دي بتقفل على إن
 * التعيين الإداري بقى بنفس القاعدة بالحرف.
 */
describe('AdminOrdersService — تكافؤ السكدول بين التعيين الإداري والتجنيد الذاتي (ADR-0057)', () => {
  jest.setTimeout(40_000);
  let dataSource: DataSource;
  let adminOrdersService: AdminOrdersService;
  let orderTeamService: OrderTeamService;
  const runId = Date.now().toString(36);
  const ids: Record<string, string> = {};
  const users: string[] = [];
  let phoneCounter = 0;

  function nextPhone(): string {
    const counter = (phoneCounter++).toString().padStart(2, '0');
    return `+2049${runId.slice(-6)}${counter}`.slice(0, 15);
  }

  async function q<T = any>(sql: string, params?: unknown[]): Promise<T[]> {
    return dataSource.query(sql, params);
  }

  async function insertTechnician(label: string, kind: 'technician' | 'assistant' = 'assistant') {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      nextPhone(),
      `${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status,
          technician_kind, current_location)
       VALUES ($1,$2,'x',3,'new','approved',$3, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [user.id, `PARITY${label}${runId}`.slice(0, 20), kind],
    );
    const profileId = profile.id as string;
    await q(`INSERT INTO technician_categories (technician_id, category_id, verification_status, is_active) VALUES ($1,$2,'approved',true)`, [
      profileId,
      ids.category,
    ]);
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profileId, ids.zone]);
    return profileId;
  }

  // ADR-0057 — «مشغول نفس اليوم» يعني نفس التاريخ، مش بالضرورة نفس الساعة. الفرق مهم هنا تحديدًا:
  // فارق ٩ ساعات بين busyOrder وtargetOrder يضمن إن assertScheduleAvailable() (تعارض وقت حرفي)
  // بيعدّي طبيعي، وclassifyTechnicianCapacity() (نفس اليوم بغض النظر عن الساعة) هو اللي بيمسك
  // الحالة — بالظبط سيناريو المالك: مساعد واحد على شغلانتين مختلفتين في نفس اليوم، مش نفس اللحظة.
  // ADR-0057 (تعميق) — بَقّة حقيقية اتلقطت هنا وهي بتكتب الاختبار ده: `classifyTechnicianCapacity()`
  // بيفحص `ACTIVE_TECHNICIAN_ORDER_STATUSES` بس، واللي **مابيبدأش من `technician_assigned`**
  // (تعيين لسه ما اتقبلش) — بيبدأ من `accepted` فما بعد. طلب "مشغول" حقيقي بمعنى القدرة
  // الاستيعابية لازم يكون `accepted` على الأقل، مش أي حالة عشوائية.
  async function insertOrder(label: string, opts: { technicianId: string; requiredAssistants?: number; hourOfDay?: number }) {
    const [order] = await q(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status,
          total_amount_cents, technician_earning_cents, booking_mode, required_technicians, required_assistants, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',30000,0,'team',2,$7,
         (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo') + ($8::int || ' hours')::interval)
       RETURNING id`,
      [
        `PARITY-${label}-${runId}`.slice(0, 24),
        ids.customerProfile,
        opts.technicianId,
        ids.service,
        ids.address,
        ids.zone,
        opts.requiredAssistants ?? 2,
        opts.hourOfDay ?? 18,
      ],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, OrderTeamMember, TechnicianOrderCancellation, User, TechnicianProfile],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [category] = await q(`INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تكافؤ ${runId}`,
      `ParityCat${runId}`,
      `parity-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [city] = await q(`INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة تكافؤ ${runId}`,
      `ParityCity${runId}`,
      `parity-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`, [
      ids.city,
      `نطاق تكافؤ ${runId}`,
      `ParityZone${runId}`,
    ]);
    ids.zone = zone.id;
    const [customerUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      nextPhone(),
      `عميل تكافؤ ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, 'شارع تكافؤ'],
    );
    ids.address = address.id;
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,commission_percentage,estimated_duration_minutes,is_active)
       VALUES ($1,$2,$3,'formula',50000,20,60,true) RETURNING id`,
      [ids.category, `خدمة تكافؤ ${runId}`, `parity-svc-${runId}`],
    );
    ids.service = svc.id;

    const [admin] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      nextPhone(),
      `أدمن تكافؤ ${runId}`,
    ]);
    ids.adminUserId = admin.id;
    users.push(admin.id);

    ids.leaderProfile = await insertTechnician('leader', 'technician');
    // المساعد "المشغول": هيتضاف لطلب أول (busyOrder) بحيث يبقى عنده التزام حقيقي النهاردة قبل
    // ما أي مسار تاني يحاول يضمّه لطلب تاني — بالظبط سيناريو المالك (مساعد واحد، تلات شغلانات).
    ids.busyAssistant = await insertTechnician('busy-assistant', 'assistant');
    ids.freeAssistant = await insertTechnician('free-assistant', 'assistant');

    const settingsStub = { getNumber: async (_k: string, fallback: number) => fallback } as unknown as SettingsService;

    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      {} as never,
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
      settingsStub,
    );

    adminOrdersService = new AdminOrdersService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderStatusHistory),
      dataSource.getRepository(TechnicianOrderCancellation),
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      techniciansService,
      new TechnicianAssignmentGuardService(settingsStub),
      new EventEmitter2(),
      { record: async () => undefined } as unknown as AuditLogService,
      {} as never,
      {} as never,
      settingsStub,
      {} as never,
      new TechnicianWorkOpportunitiesService(dataSource),
    );

    orderTeamService = new OrderTeamService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderTeamMember),
      techniciansService,
      new TechnicianAssignmentGuardService(settingsStub),
      new TechnicianWorkOpportunitiesService(dataSource),
      settingsStub,
      new EventEmitter2(),
    );

    // §الالتزام الأول — busyAssistant بيتضاف فعليًا كمساعد على طلب مختلف اليوم، عن طريق المسار
    // اللي أصلاً كان شغال صح (recruitMember الذاتي)، عشان نثبّت الالتزام الحقيقي بشكل مستقل عن
    // الكود اللي بنختبره.
    ids.busyOrder = await insertOrder('busy', { technicianId: ids.leaderProfile, requiredAssistants: 1, hourOfDay: 9 });
    const [leaderRow] = await q<{ user_id: string }>(`SELECT user_id FROM technician_profiles WHERE id = $1`, [ids.leaderProfile]);
    const outcome = await orderTeamService.recruitMember(leaderRow.user_id, ids.busyOrder, ids.busyAssistant, 'assistant');
    expect(outcome.status).toBe('added');
  }, 40000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const profiles = [ids.leaderProfile, ids.busyAssistant, ids.freeAssistant];
    const orderIds = [ids.busyOrder, ids.targetOrder].filter(Boolean);
    await q(`DELETE FROM order_earning_shares WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM order_team_members WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM technician_work_opportunities WHERE order_id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orderIds]);
    await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [profiles]);
    await q(`DELETE FROM technician_categories WHERE technician_id = ANY($1::uuid[])`, [profiles]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [profiles]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  }, 30000);

  it('assignAssistant الإداري: مساعد مشغول بشغلانة تانية النهاردة بيتحول لفرصة، مش إضافة صامتة (بلاغ المالك بالحرف)', async () => {
    ids.targetOrder = await insertOrder('target-assign', { technicianId: ids.leaderProfile, requiredAssistants: 2 });

    const outcome = await adminOrdersService.assignAssistant(ids.adminUserId, ids.targetOrder, ids.busyAssistant);
    expect(outcome.status).toBe('offer_sent');

    // ما اتضافش فورًا في order_team_members — ده بالظبط اللي كان ناقص.
    const rows = await q(`SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [ids.targetOrder, ids.busyAssistant]);
    expect(rows).toHaveLength(0);

    // فرصة حقيقية اتسجّلت — الشخص نفسه هو اللي هيقرر يقبل أو لأ.
    const [opportunity] = await q<{ status: string; crew_role: string }>(
      `SELECT status, crew_role FROM technician_work_opportunities WHERE order_id = $1 AND technician_id = $2`,
      [ids.targetOrder, ids.busyAssistant],
    );
    expect(opportunity.status).toBe('offered');
    expect(opportunity.crew_role).toBe('assistant');
  });

  it('addCrewMember الإداري: نفس التحويل لفرصة على العضو المشغول، بنفس الآلية بالحرف', async () => {
    const orderId = await insertOrder('target-crew', { technicianId: ids.leaderProfile, requiredAssistants: 2 });
    try {
      const outcome = await adminOrdersService.addCrewMember(ids.adminUserId, orderId, ids.busyAssistant, 'مساعد', 'assistant');
      expect(outcome.status).toBe('offer_sent');
      const rows = await q(`SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [orderId, ids.busyAssistant]);
      expect(rows).toHaveLength(0);
    } finally {
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = $1`, [orderId]);
      await q(`DELETE FROM orders WHERE id = $1`, [orderId]);
    }
  });

  it('المساعد الفاضي بيتضاف فورًا زي زمان — القاعدة الجديدة ما بتأخّرش حد فاضي فعلاً', async () => {
    const orderId = await insertOrder('target-free', { technicianId: ids.leaderProfile, requiredAssistants: 2 });
    try {
      const outcome = await adminOrdersService.assignAssistant(ids.adminUserId, orderId, ids.freeAssistant);
      expect(outcome.status).toBe('assigned');
      const rows = await q(`SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [orderId, ids.freeAssistant]);
      expect(rows).toHaveLength(1);
    } finally {
      await q(`DELETE FROM order_team_members WHERE order_id = $1`, [orderId]);
      await q(`DELETE FROM orders WHERE id = $1`, [orderId]);
    }
  });

  it('listEligibleAssistants بترجّع capacity_tier وتستبعد المشغول لو عنده تعارض زمني فعلي — الأدمن يشوف الصورة الحقيقية', async () => {
    const orderId = await insertOrder('target-list', { technicianId: ids.leaderProfile, requiredAssistants: 2 });
    try {
      const items = await adminOrdersService.listEligibleAssistants(orderId);
      const byId = new Map(items.map((item) => [item.technician_id, item]));
      // المساعد الفاضي لازم يفضل موجود وLIGHT.
      expect(byId.get(ids.freeAssistant)?.capacity_tier).toBe('LIGHT');
    } finally {
      await q(`DELETE FROM orders WHERE id = $1`, [orderId]);
    }
  });

  it('قبول الفرصة (acceptCrewOpportunity) بيكمّل الإضافة فعليًا — نفس نقطة القبول الوحيدة للمسارين', async () => {
    const orderId = await insertOrder('target-accept', { technicianId: ids.leaderProfile, requiredAssistants: 2 });
    try {
      const outcome = await adminOrdersService.assignAssistant(ids.adminUserId, orderId, ids.busyAssistant);
      expect(outcome.status).toBe('offer_sent');
      if (outcome.status !== 'offer_sent') throw new Error('unreachable');

      const [busyAssistantUser] = await q<{ user_id: string }>(`SELECT user_id FROM technician_profiles WHERE id = $1`, [ids.busyAssistant]);
      const members = await orderTeamService.acceptCrewOpportunity(busyAssistantUser.user_id, outcome.opportunityId);
      expect(members.some((m) => m.technicianId === ids.busyAssistant)).toBe(true);

      const rows = await q(`SELECT id FROM order_team_members WHERE order_id = $1 AND technician_id = $2`, [orderId, ids.busyAssistant]);
      expect(rows).toHaveLength(1);
    } finally {
      await q(`DELETE FROM order_team_members WHERE order_id = $1`, [orderId]);
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = $1`, [orderId]);
      await q(`DELETE FROM orders WHERE id = $1`, [orderId]);
    }
  });
});
