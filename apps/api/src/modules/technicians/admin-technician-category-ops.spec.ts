import { DataSource } from 'typeorm';
import { Socket } from 'socket.io';
import { RealtimeSessionRegistry } from '../../common/websocket/realtime-session-registry.service';
import { TechnicianActivityService } from './technician-activity.service';
import { AdminTechnicianCategoryOpsService } from './admin-technician-category-ops.service';
import { TechnicianVerificationStatus } from './entities/technician-profile.entity';
import { SettingsService } from '../settings/settings.service';

// اختبار حي ضد Postgres حقيقي — مركز عمليات فئة (docs/08 §35.9، ADR-0021 §5). كل فني هنا مصمّم
// يمثّل حالة غنية واحدة على الأقل بالظبط، عشان نتأكد إن كل عمود بيتحسب صح ومستقل عن الباقي.
const settingsServiceStub = { getNumber: async (_key: string, fallback: number) => fallback } as unknown as SettingsService;

describe('AdminTechnicianCategoryOpsService — مركز عمليات فئة (docs/08 §35.9)', () => {
  let dataSource: DataSource;
  let service: AdminTechnicianCategoryOpsService;
  let sessionRegistry: RealtimeSessionRegistry;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    otherZone: '',
    category: '',
    otherCategory: '',
    service: '',
    otherService: '',
    customerProfile: '',
    address: '',
    techOnline: '',
    techOnlineUser: '',
    techNoZone: '',
    techBlocked: '',
    techPending: '',
    techWrongCategory: '',
    orderCrewShortage: '',
    orderWorking: '',
  };
  const users: string[] = [];
  let phoneCounter = 0;

  function nextPhone(): string {
    const counter = (phoneCounter++).toString().padStart(2, '0');
    return `+2042${runId.slice(-6)}${counter}`.slice(0, 15);
  }

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function insertTechnician(
    label: string,
    opts: { hasZone: boolean; verificationStatus?: TechnicianVerificationStatus },
  ) {
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      nextPhone(),
      `فني عمليات ${label} ${runId}`,
    ]);
    users.push(user.id);
    const [profile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',3,'professional',$3,true) RETURNING id`,
      [user.id, `TCOPS${label}${runId}`.slice(0, 20), opts.verificationStatus ?? TechnicianVerificationStatus.APPROVED],
    );
    const profileId = profile.id as string;
    await q(`INSERT INTO technician_categories (technician_id, category_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`, [
      profileId,
      ids.category,
    ]);
    if (opts.hasZone) {
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profileId, ids.zone]);
    }
    return { profileId, userId: user.id as string };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
    });
    await dataSource.initialize();
    sessionRegistry = new RealtimeSessionRegistry(dataSource);
    const activityService = new TechnicianActivityService(dataSource, sessionRegistry);
    service = new AdminTechnicianCategoryOpsService(dataSource, settingsServiceStub, activityService);

    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة عمليات ${runId}`,
      `Ops City ${runId}`,
      `test-ops-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق عمليات ${runId}`,
      `Ops Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    // نطاق تاني بلا فنيين خالص عليه — يثبت فلتر zone_id (docs/08 §36.3) بيرجّع مجموعة فاضية له،
    // مش بس بيقصر النطاق الأصلي.
    const [otherZone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق عمليات تاني ${runId}`,
      `Ops Other Zone ${runId}`,
    ]);
    ids.otherZone = otherZone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة عمليات ${runId}`,
      `Ops Category ${runId}`,
      `test-ops-category-${runId}`,
    ]);
    ids.category = category.id;
    const [otherCategory] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة عمليات تانية ${runId}`,
      `Ops Other Category ${runId}`,
      `test-ops-other-category-${runId}`,
    ]);
    ids.otherCategory = otherCategory.id;
    const [service_] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة عمليات ${runId}`, `test-ops-service-${runId}`],
    );
    ids.service = service_.id;
    const [otherService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.otherCategory, `خدمة عمليات تانية ${runId}`, `test-ops-other-service-${runId}`],
    );
    ids.otherService = otherService.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2041${runId}`.slice(0, 15),
      `عميل عمليات ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع عمليات ${runId}`],
    );
    ids.address = address.id;

    const online = await insertTechnician('online', { hasZone: true });
    ids.techOnline = online.profileId;
    ids.techOnlineUser = online.userId;
    ids.techNoZone = (await insertTechnician('nozone', { hasZone: false })).profileId;
    ids.techBlocked = (await insertTechnician('blocked', { hasZone: true })).profileId;
    // CURRENT_DATE بيتحسب بتوقيت جلسة Postgres (UTC عادةً)، لكن classifyTechnicianCapacity()
    // بتحسب "اليوم" بتوقيت القاهرة (technician-eligibility.sql.ts) — فرق التوقيت الصيفي بيخلق
    // نافذة ساعتين كل ليلة الاتنين مش متساويين فيها، فلازم نفس التحويل هنا.
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, (now() AT TIME ZONE 'Africa/Cairo')::date, '00:00', '23:59', 'blocked')`,
      [ids.techBlocked],
    );
    ids.techPending = (
      await insertTechnician('pending', { hasZone: true, verificationStatus: TechnicianVerificationStatus.PENDING })
    ).profileId;
    ids.techWrongCategory = (await insertTechnician('wrongcat', { hasZone: true })).profileId;
    // فني الفئة الغلط ده لازم يتستبعد من الفئة الأصلية — نمسح صف technician_categories بتاعه
    // ونضيفه للفئة التانية بدل كده (insertTechnician بتضيفه للفئة الأصلية دايمًا).
    await q(`DELETE FROM technician_categories WHERE technician_id = $1`, [ids.techWrongCategory]);
    await q(`INSERT INTO technician_categories (technician_id, category_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`, [
      ids.techWrongCategory,
      ids.otherCategory,
    ]);

    // القائد (techOnline) عنده طلب فريق طاقمه ناقص — required_technicians=2، مفيش أعضاء.
    const [crewOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode, required_technicians)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',30000,0,'team',2) RETURNING id`,
      [`TESTOPS-CREW-${runId}`.slice(0, 24), ids.customerProfile, ids.techOnline, ids.service, ids.address, ids.zone],
    );
    ids.orderCrewShortage = crewOrder.id;

    // techBlocked عنده طلب نشط دلوقتي (working_now=true).
    const [workingOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',30000,0,'individual') RETURNING id`,
      [`TESTOPS-WORK-${runId}`.slice(0, 24), ids.customerProfile, ids.techBlocked, ids.service, ids.address, ids.zone],
    );
    ids.orderWorking = workingOrder.id;

    // طلب مفتوح (order_assignments 'sent') لـtechOnline — open_requests_count.
    await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'sent', now(), now() + interval '30 seconds')`,
      [ids.orderCrewShortage, ids.techOnline],
    );

    // عرض انضمام لفريق مفتوح لـtechNoZone — crew_recruit_open_offers_count.
    await q(
      `INSERT INTO technician_work_opportunities (order_id, technician_id, context, crew_role, capacity_tier_at_offer, status, offered_at)
       VALUES ($1,$2,'crew_recruit','technician','LIGHT','offered', now())`,
      [ids.orderCrewShortage, ids.techNoZone],
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM technician_work_opportunities WHERE order_id = ANY($1::uuid[])`, [[ids.orderCrewShortage, ids.orderWorking]]);
      await q(`DELETE FROM order_assignments WHERE order_id = ANY($1::uuid[])`, [[ids.orderCrewShortage, ids.orderWorking]]);
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [[ids.orderCrewShortage, ids.orderWorking]]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      const allProfiles = [ids.techOnline, ids.techNoZone, ids.techBlocked, ids.techPending, ids.techWrongCategory];
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techBlocked]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [allProfiles]);
      await q(`DELETE FROM technician_categories WHERE technician_id = ANY($1::uuid[])`, [allProfiles]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [allProfiles]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [[ids.service, ids.otherService]]);
      await q(`DELETE FROM service_categories WHERE id = ANY($1::uuid[])`, [[ids.category, ids.otherCategory]]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1::uuid[])`, [[ids.zone, ids.otherZone]]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('list() — كل الحالات الغنية بتتحسب صح ومستقلة عن بعضها', async () => {
    sessionRegistry.register(ids.techOnlineUser, { id: 'sock-ops-1' } as unknown as Socket);

    const { items, meta } = await service.list({ categoryId: ids.category, page: 1, perPage: 50 });
    expect(meta.total).toBe(4); // online/noZone/blocked/pending — wrongCategory مُستبعد
    expect(items.some((r) => r.id === ids.techWrongCategory)).toBe(false);

    const online = items.find((r) => r.id === ids.techOnline)!;
    expect(online.online).toBe(true);
    expect(online.hasZoneIssue).toBe(false);
    expect(online.openRequestsCount).toBe(1);
    expect(online.crewLeaderShortageCount).toBe(1);

    const noZone = items.find((r) => r.id === ids.techNoZone)!;
    expect(noZone.hasZoneIssue).toBe(true);
    expect(noZone.crewRecruitOpenOffersCount).toBe(1);

    const blocked = items.find((r) => r.id === ids.techBlocked)!;
    expect(blocked.capacityTierToday).toBe('BLOCKED');
    expect(blocked.workingNow).toBe(true);

    const pending = items.find((r) => r.id === ids.techPending)!;
    expect(pending.verificationStatus).toBe(TechnicianVerificationStatus.PENDING);

    sessionRegistry.unregister(ids.techOnlineUser, { id: 'sock-ops-1' } as unknown as Socket);
  });

  it('list() — فلتر verification_status بيقصر النتيجة على الحالة المطلوبة بس', async () => {
    const { items, meta } = await service.list({
      categoryId: ids.category,
      verificationStatus: TechnicianVerificationStatus.PENDING,
      page: 1,
      perPage: 50,
    });
    expect(meta.total).toBe(1);
    expect(items[0].id).toBe(ids.techPending);
  });

  it('list() — فلتر zone_id (docs/08 §36.3، مصفوفة القوى العاملة) بيقصر النتيجة على الفنيين المعتمدين على النطاق ده بس', async () => {
    const { items, meta } = await service.list({ categoryId: ids.category, zoneId: ids.zone, page: 1, perPage: 50 });
    // online/blocked/pending عندهم نطاق ids.zone؛ noZone معندوش أي نطاق خالص → لازم يُستبعد.
    expect(meta.total).toBe(3);
    expect(items.some((r) => r.id === ids.techNoZone)).toBe(false);
    expect(items.some((r) => r.id === ids.techOnline)).toBe(true);

    const emptyZone = await service.list({ categoryId: ids.category, zoneId: ids.otherZone, page: 1, perPage: 50 });
    expect(emptyZone.meta.total).toBe(0);
  });

  it('list() — فلتر q (docs/08 §36.12، بحث/فلترة شاملة) بيدوّر بالاسم أو كود الفني، case-insensitive', async () => {
    const byName = await service.list({ categoryId: ids.category, q: 'online', page: 1, perPage: 50 });
    expect(byName.items.some((r) => r.id === ids.techOnline)).toBe(true);
    expect(byName.items.some((r) => r.id === ids.techBlocked)).toBe(false);

    const byNameUpperCase = await service.list({ categoryId: ids.category, q: 'ONLINE', page: 1, perPage: 50 });
    expect(byNameUpperCase.meta.total).toBe(byName.meta.total);

    const byCode = await service.list({ categoryId: ids.category, q: `TCOPSonline`, page: 1, perPage: 50 });
    expect(byCode.items.some((r) => r.id === ids.techOnline)).toBe(true);

    const noMatch = await service.list({ categoryId: ids.category, q: 'مفيش-فني-بالاسم-ده', page: 1, perPage: 50 });
    expect(noMatch.meta.total).toBe(0);
  });

  it('list() — ترقيم صفحات حقيقي (page/perPage) بيحترم LIMIT/OFFSET والعدد الكلي', async () => {
    const page1 = await service.list({ categoryId: ids.category, page: 1, perPage: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.meta.total).toBe(4);
    const page2 = await service.list({ categoryId: ids.category, page: 2, perPage: 2 });
    expect(page2.items.length).toBe(2);
    const ids1 = page1.items.map((r) => r.id);
    const ids2 = page2.items.map((r) => r.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });
});
