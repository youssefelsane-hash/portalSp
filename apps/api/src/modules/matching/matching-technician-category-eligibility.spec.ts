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

// اختبار حي ضد Postgres حقيقي (ADR-0018 §8، طلب صريح من المالك 2026-08-19) — بيثبت إن فني
// معتمد بمستوى الفئة كلها (technician_categories، مثلاً "سباكة") بيبقى مؤهّل تلقائيًا لأي خدمة
// جوّه الفئة دي في findEligibleTechnicians()، **حتى لو معندوش صف technician_services مباشر
// لنفس الخدمة دي بالذات خالص**. عكسها بالظبط برضه: فني معتمد بخدمة مباشرة بس (زي الوضع القديم
// قبل ADR-0018 §8) لسه بيشتغل عادي — الإضافة دي "OR" مش استبدال.
describe('MatchingService.findEligibleTechnicians() — أهلية بمستوى الفئة/التخصص (ADR-0018 §8)', () => {
  let dataSource: DataSource;
  let matchingService: MatchingService;

  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    serviceA: '',
    serviceB: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    technicianByCategoryProfile: '',
    technicianByServiceProfile: '',
    technicianNeitherProfile: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      new TechnicianAssignmentGuardService({ getNumber: jest.fn(async (_key: string, fallback: number) => fallback), getString: jest.fn(async (_k: string, fb: string) => fb) } as never),
      { getNumber: jest.fn(async (_key: string, fallback: number) => fallback), getString: jest.fn(async (_k: string, fb: string) => fb) } as never,
      { emit: jest.fn() } as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      levelPremiumServiceStub(),
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The category-eligibility fixture requires the seeded EG country');
    ids.country = country.id;

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-cat-${runId}`],
    );
    ids.city = city.id;

    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق اختبار ${runId}`,
      `Test Zone ${runId}`,
    ]);
    ids.zone = zone.id;

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اختبار ${runId}`,
      `Test Category ${runId}`,
      `test-category-cat-${runId}`,
    ]);
    ids.category = category.id;

    // خدمتين في نفس الفئة — عشان نتأكد إن اعتماد الفئة بيغطي أكتر من خدمة واحدة فعليًا.
    const [serviceA] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة أ اختبار ${runId}`, `test-service-a-cat-${runId}`],
    );
    ids.serviceA = serviceA.id;
    const [serviceB] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة ب اختبار ${runId}`, `test-service-b-cat-${runId}`],
    );
    ids.serviceB = serviceB.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2014${runId}`.slice(0, 14),
      `عميل اختبار ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    const makeTechnician = async (label: string) => {
      const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        // العمود بيسمح بـ15 حرف. الصيغة القديمة (`+2015${label}${runId}`.slice(0,14)) كان
        // الليبل الطويل فيها (`BYCAT`/`BYSVC`/`NEITHER`) بياكل المساحة فما يفضلش من runId غير
        // 3-4 حروف hex — ومع صفوف متسربة من تشغيلات فشلت في النص، تصادم users_phone_number_key
        // بقى بيحصل فعلاً (اتلقط حي 2026-08-25: 118 صف متسرب اتنضّفوا). دلوقتي: حرف واحد بس
        // للتمييز جوّه التشغيلة + كل الـ12 حرف بتوع runId (الاسم الكامل لسه فيه الليبل للتشخيص).
        `+201${label[2] ?? label[0]}${runId}`.slice(0, 15),
        `فني اختبار ${label} ${runId}`,
      ]);
      const [profile] = await q(
        `INSERT INTO technician_profiles
           (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
         VALUES ($1,$2,'new','approved',true,true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography)
         RETURNING id`,
        [user.id, `CAT${label}${runId}`.slice(0, 20)],
      );
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.zone]);
      return profile.id as string;
    };

    // فني معتمد بمستوى الفئة كلها بس — بلا أي صف technician_services مباشر خالص.
    ids.technicianByCategoryProfile = await makeTechnician('BYCAT');
    await q(
      `INSERT INTO technician_categories (technician_id, category_id, is_active, verification_status)
       VALUES ($1,$2,true,'approved')`,
      [ids.technicianByCategoryProfile, ids.category],
    );

    // فني معتمد بخدمة مباشرة بس (السلوك القديم قبل ADR-0018 §8) — لازم يفضل شغال زي ما هو.
    ids.technicianByServiceProfile = await makeTechnician('BYSVC');
    await q(
      `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
       VALUES ($1,$2,true,'approved')`,
      [ids.technicianByServiceProfile, ids.serviceA],
    );

    // فني بلا أي اعتماد خالص (لا فئة ولا خدمة) — لازم يفضل مستبعد تمامًا (ضبط سلبي/negative control).
    ids.technicianNeitherProfile = await makeTechnician('NEITHER');
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const technicianIds = [ids.technicianByCategoryProfile, ids.technicianByServiceProfile, ids.technicianNeitherProfile];
    try {
      // بَقّة حقيقية اتلقطت وقت §35.20 (تحقق مركّز عبّر عنها تراكم 153 صف تجريبي فعلي في القاعدة
      // عبر تشغيلات كتير سابقة): الترتيب القديم كان بيمسح technician_profiles **قبل** ما يجيب
      // user_id بتاعهم (subquery على صفوف اتمسحت بالفعل بيرجع فاضي دايمًا)، فالمستخدمين (وبالتبعية
      // أرقام هواتفهم) كانوا يفضلوا للأبد — تصادم `users_phone_number_key` مع تشغيلات لاحقة كان
      // مسألة وقت بس. الإصلاح: نجيب user_id **قبل** أي حذف.
      const technicianUsers = await q(`SELECT user_id FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianIds]);
      const technicianUserIds = technicianUsers.map((r: { user_id: string }) => r.user_id);
      await q(`DELETE FROM technician_categories WHERE technician_id = ANY($1::uuid[])`, [technicianIds]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [technicianIds]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [technicianIds]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianIds]);
      if (technicianUserIds.length) {
        await q(`DELETE FROM notifications WHERE user_id = ANY($1::uuid[])`, [technicianUserIds]);
      }
      if (technicianUserIds.length) await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [technicianUserIds]);
      await q(`DELETE FROM notifications WHERE user_id = $1`, [ids.customerUser]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [[ids.serviceA, ids.serviceB]]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  const findCandidates = (serviceId: string) => {
    // totalAmountCents رمزي تحت حد قرار 'new' (200 جنيه) — findEligibleTechnicians بقت بتفحص
    // decision_limit_cents (docs/08 §36.1 تعميق)، والاختبار هنا بيفحص أهلية الفئة/الخدمة بس.
    const order = {
      id: randomUUID(),
      serviceId,
      serviceZoneId: ids.zone,
      addressId: ids.address,
      scheduledAt: null,
      totalAmountCents: 10000,
    } as Order;
    return (
      matchingService as unknown as { findEligibleTechnicians: (...args: unknown[]) => Promise<{ technician_id: string }[]> }
    ).findEligibleTechnicians(order, 50, null, false, null);
  };

  it('فني معتمد بالفئة بس (بلا technician_services) بيبقى مؤهّل لأي خدمة جوّه الفئة', async () => {
    const candidatesA = await findCandidates(ids.serviceA);
    expect(candidatesA.some((c) => c.technician_id === ids.technicianByCategoryProfile)).toBe(true);

    // نفس الفني برضه لازم يبقى مؤهّل لخدمة تانية جوّه نفس الفئة (serviceB) — ده بالظبط الفرق
    // الجوهري عن technician_services القديمة (خدمة بخدمة).
    const candidatesB = await findCandidates(ids.serviceB);
    expect(candidatesB.some((c) => c.technician_id === ids.technicianByCategoryProfile)).toBe(true);
  });

  it('فني معتمد بخدمة مباشرة بس لسه شغال زي ما هو (إضافة مش استبدال)', async () => {
    const candidatesA = await findCandidates(ids.serviceA);
    expect(candidatesA.some((c) => c.technician_id === ids.technicianByServiceProfile)).toBe(true);

    // بس ملوش اعتماد فئة، فمش مفروض يظهر لخدمة تانية جوّه نفس الفئة معندوش صف مباشر ليها.
    const candidatesB = await findCandidates(ids.serviceB);
    expect(candidatesB.some((c) => c.technician_id === ids.technicianByServiceProfile)).toBe(false);
  });

  it('فني بلا أي اعتماد (لا فئة ولا خدمة) بيتستبعد تمامًا — ضبط سلبي', async () => {
    const candidatesA = await findCandidates(ids.serviceA);
    expect(candidatesA.some((c) => c.technician_id === ids.technicianNeitherProfile)).toBe(false);
  });
});
