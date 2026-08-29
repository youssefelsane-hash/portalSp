import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { SettingsService } from '../settings/settings.service';
import { CrewEarningsService } from '../payments/crew-earnings.service';
import { OrderEarningShare } from '../payments/entities/order-earning-share.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { User } from '../auth/entities/user.entity';
import { Order, OrderType } from './entities/order.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { OrderTeamService, computeOptionalAssistantSlots, isSoloJob } from './order-team.service';

/**
 * ADR-0052 (docs/08 §97، طلب مالك مباشر).
 *
 * «لو الشغلانة عدد أفرادها واحد… أحيانًا الصنايعي بيحب ياخد معاه مساعد… لو هو مش عايز يضيف مساعد
 * خلاص مش مهم». الاختبار الحي ده بيقفل على التلات حاجات اللي المالك شدّد عليهم:
 * (1) اختياري — مساعد واحد بس، (2) عمره ما يتحسب "نقص طاقم"، (3) **الفلوس بتتقسم بالنسبة**.
 */
describe('ADR-0052 — مساعد اختياري واحد للشغلانة الفردية', () => {
  let dataSource: DataSource;
  let orderTeamService: OrderTeamService;
  const runId = Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);

  const ids = {
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    leaderUser: '',
    leaderProfile: '',
    assistantUser: '',
    assistantProfile: '',
    assistant2User: '',
    assistant2Profile: '',
    technicianUser: '',
    technicianProfile: '',
    soloOrder: '',
  };

  // إعدادات حقيقية القيم الافتراضية بتاعتها، ماعدا ما الاختبار يقلبها صراحة.
  let optionalAssistantEnabled = true;
  const settingsStub = {
    getNumber: async (_key: string, fallback: number) => fallback,
    getBoolean: async (key: string, fallback: boolean) =>
      key === 'crew.optional_assistant_enabled' ? optionalAssistantEnabled : fallback,
  } as unknown as SettingsService;

  const q = <T = any>(sql: string, params?: unknown[]): Promise<T[]> => dataSource.query(sql, params);

  async function mkTechnician(label: string, kind: 'technician' | 'assistant') {
    const [u] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at)
       VALUES ($1,$2,'technician',now()) RETURNING id`,
      [`+205${label}${runId}`.slice(0, 15), `${label} ${runId}`],
    );
    const [p] = await q(
      `INSERT INTO technician_profiles
         (user_id, technician_code, national_id_encrypted, years_of_experience, current_level,
          verification_status, is_available, technician_kind, current_location)
       VALUES ($1,$2,'x',2,'new','approved',true,$3, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography)
       RETURNING id`,
      [u.id, `OA-${label}-${runId}`.slice(0, 20), kind],
    );
    // التأهيل بالفئة — نفس شرط المساعد الإجباري بالحرف (موثّق كفجوة في ADR-0052).
    await q(
      `INSERT INTO technician_categories (technician_id, category_id, verification_status, is_active)
       VALUES ($1,$2,'approved',true)`,
      [p.id, ids.category],
    );
    return { userId: u.id as string, profileId: p.id as string };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderTeamMember, TechnicianProfile, TechnicianCompany, User, OrderEarningShare],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة اختياري ${runId}`, `Opt City ${runId}`, `test-oa-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق اختياري ${runId}`,
      `Opt Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اختياري ${runId}`,
      `Opt Category ${runId}`,
      `test-oa-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',50000,20,60) RETURNING id`,
      [ids.category, `تسليك حوض ${runId}`, `test-oa-svc-${runId}`],
    );
    ids.service = service.id;

    const leader = await mkTechnician('leader', 'technician');
    ids.leaderUser = leader.userId;
    ids.leaderProfile = leader.profileId;
    const assistant = await mkTechnician('asst1', 'assistant');
    ids.assistantUser = assistant.userId;
    ids.assistantProfile = assistant.profileId;
    const assistant2 = await mkTechnician('asst2', 'assistant');
    ids.assistant2User = assistant2.userId;
    ids.assistant2Profile = assistant2.profileId;
    const technician = await mkTechnician('tech2', 'technician');
    ids.technicianUser = technician.userId;
    ids.technicianProfile = technician.profileId;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+206${runId}`.slice(0, 15),
      `عميل اختياري ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختياري ${runId}`],
    );
    ids.address = address.id;

    // شغلانة فردية بالمعنى الحرفي: فرد واحد، صفر مساعدين مطلوبين، حجز individual.
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, technician_id,
                           order_status, payment_status, total_amount_cents, booking_mode, order_type,
                           required_technicians, required_assistants)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','unpaid',50000,'individual','standard',1,0) RETURNING id`,
      [`OASOLO-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, ids.leaderProfile],
    );
    ids.soloOrder = order.id;

    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never,
      {} as never,
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
      {} as never,
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
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const profiles = [ids.leaderProfile, ids.assistantProfile, ids.assistant2Profile, ids.technicianProfile];
    const users = [ids.leaderUser, ids.assistantUser, ids.assistant2User, ids.technicianUser, ids.customerUser];
    try {
      await q(`DELETE FROM order_earning_shares WHERE order_id = $1`, [ids.soloOrder]);
      await q(`DELETE FROM order_team_members WHERE order_id = $1`, [ids.soloOrder]);
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = $1`, [ids.soloOrder]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.soloOrder]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_categories WHERE technician_id = ANY($1)`, [profiles]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [profiles]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  }, 20000);

  it('الشغلانة الفردية بتتعرّف صح، والخانة الاختيارية بتتقفل بعد أول مساعد', () => {
    const solo = { requiredTechnicians: 1, requiredAssistants: 0 };
    const team = { requiredTechnicians: 3, requiredAssistants: 1 };
    expect(isSoloJob(solo)).toBe(true);
    expect(isSoloJob(team)).toBe(false);
    expect(computeOptionalAssistantSlots(solo, 0, { enabled: true, maxPerOrder: 1 })).toBe(1);
    expect(computeOptionalAssistantSlots(solo, 1, { enabled: true, maxPerOrder: 1 })).toBe(0);
    // طلب فريق عمره ما ياخد خانة اختيارية — نقصه الإجباري هو اللي بيحكمه.
    expect(computeOptionalAssistantSlots(team, 0, { enabled: true, maxPerOrder: 1 })).toBe(0);
    // القفل العام بيلغي الخانة تمامًا.
    expect(computeOptionalAssistantSlots(solo, 0, { enabled: false, maxPerOrder: 1 })).toBe(0);
    // طلب الضمان مجاني؛ لا يجوز تحويل الخانة الاختيارية إلى شغل بلا أجر لمساعد آخر.
    expect(
      computeOptionalAssistantSlots(
        { ...solo, orderType: OrderType.REVISIT },
        0,
        { enabled: true, maxPerOrder: 1 },
      ),
    ).toBe(0);
  });

  it('الطاقم "مكتمل" والنقص صفر — الاختياري عمره ما يتحسب نقص (مفيش تصعيد ولا كارت أحمر)', async () => {
    const before = await orderTeamService.getCrewComposition(ids.soloOrder, {
      requiredTechnicians: 1,
      requiredAssistants: 0,
    });
    expect(before.missingTechnicians).toBe(0);
    expect(before.missingAssistants).toBe(0);
    expect(before.crewComplete).toBe(true);
    expect(before.optionalAssistantSlots).toBe(1);
    expect(before.optionalAssistantsAdded).toBe(0);
  }, 20000);

  it('ضم فني (مش مساعد) لشغلانة فردية لسه ممنوع', async () => {
    await expect(
      orderTeamService.recruitMember(ids.leaderUser, ids.soloOrder, ids.technicianProfile, 'technician'),
    ).rejects.toThrow(/اعتماد/);
  }, 20000);

  it('المساعد بيتضاف فعليًا بـmember_type=assistant، والخانة بتتقفل بعده', async () => {
    const outcome = await orderTeamService.recruitMember(ids.leaderUser, ids.soloOrder, ids.assistantProfile, 'assistant');
    expect(outcome.status).toBe('added');

    const [member] = await q<{ member_type: string }>(
      `SELECT member_type FROM order_team_members WHERE order_id = $1 AND technician_id = $2`,
      [ids.soloOrder, ids.assistantProfile],
    );
    expect(member.member_type).toBe('assistant');

    const after = await orderTeamService.getCrewComposition(ids.soloOrder, { requiredTechnicians: 1, requiredAssistants: 0 });
    expect(after.optionalAssistantsAdded).toBe(1);
    expect(after.optionalAssistantSlots).toBe(0);
    // ولسه مش نقص.
    expect(after.missingAssistants).toBe(0);
    expect(after.crewComplete).toBe(true);

    // مساعد تاني مرفوض — «مساعد واحد فقط» بنص المالك.
    await expect(
      orderTeamService.recruitMember(ids.leaderUser, ids.soloOrder, ids.assistant2Profile, 'assistant'),
    ).rejects.toThrow(/مساعد اختياري واحد بس/);
  }, 20000);

  it('الفلوس بتتقسم فعليًا بنسبة المساعد على الطلب الفردي — نفس محرك الطاقم بلا أي استثناء', async () => {
    const assistantRatio = 0.5;
    const crewEarnings = new CrewEarningsService({ getNumber: async () => assistantRatio } as unknown as SettingsService);
    const order = await dataSource.getRepository(Order).findOneOrFail({ where: { id: ids.soloOrder } });

    const participants = await crewEarnings.resolveParticipants(dataSource.manager, order);
    expect(participants).toHaveLength(2);
    const leader = participants.find((p) => p.technicianId === ids.leaderProfile)!;
    const assistant = participants.find((p) => p.technicianId === ids.assistantProfile)!;
    expect(leader.participantRole).toBe('leader');
    expect(assistant.participantRole).toBe('assistant');
    // نفس المستوى ('new') للاتنين عمدًا — فالفرق الوحيد اللي ممكن يفسّر اختلاف الحصص هو الدور.
    expect(assistant.shareWeight).toBeCloseTo(leader.shareWeight * assistantRatio, 5);

    const poolCents = 40000;
    const shares = await crewEarnings.recordShares(dataSource.manager, order, poolCents);
    const leaderShare = shares.find((s) => s.technicianId === ids.leaderProfile)!;
    const assistantShare = shares.find((s) => s.technicianId === ids.assistantProfile)!;
    // 1 : 0.5 → الوعاء بالكامل موزّع بلا قرش ضايع (مصدر الحقيقة الوحيد للمستحقات والمحفظة).
    expect(leaderShare.shareCents + assistantShare.shareCents).toBe(poolCents);
    expect(assistantShare.shareCents).toBe(Math.round(poolCents / 3));

    // اتسجّلت فعلاً في order_earning_shares — مش محسوبة في الذاكرة بس.
    const rows = await q<{ technician_id: string; share_cents: number; participant_role: string }>(
      `SELECT technician_id, share_cents, participant_role FROM order_earning_shares WHERE order_id = $1`,
      [ids.soloOrder],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.technician_id === ids.assistantProfile)!.participant_role).toBe('assistant');
  }, 20000);

  it('قفل الإعداد العام بيمنع الضم تمامًا', async () => {
    await q(`DELETE FROM order_team_members WHERE order_id = $1`, [ids.soloOrder]);
    optionalAssistantEnabled = false;
    try {
      const composition = await orderTeamService.getCrewComposition(ids.soloOrder, {
        requiredTechnicians: 1,
        requiredAssistants: 0,
      });
      expect(composition.optionalAssistantSlots).toBe(0);
      await expect(
        orderTeamService.recruitMember(ids.leaderUser, ids.soloOrder, ids.assistantProfile, 'assistant'),
      ).rejects.toThrow();
    } finally {
      optionalAssistantEnabled = true;
    }
  }, 20000);
});
