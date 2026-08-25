import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { OtpCode, OtpPurpose } from '../auth/entities/otp-code.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User, UserType } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { TechnicianCategory } from '../catalog/entities/technician-category.entity';
import { TechnicianProfile, TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianZone } from '../technicians/entities/technician-zone.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianCategoriesService } from '../technicians/technician-categories.service';
import { AdminTechniciansService } from '../technicians/admin-technicians.service';
import { TechnicianDocument } from '../technicians/entities/technician-document.entity';
import { TechnicianLevelHistory } from '../technicians/entities/technician-level-history.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { Service } from '../catalog/entities/service.entity';
import { SettingsService } from '../settings/settings.service';
import { Order, OrderStatus, BookingMode } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from './entities/order-assignment.entity';
import { MatchingService } from './matching.service';

// اختبار حي — إعادة إنتاج مسار التسجيل الحقيقي بالكامل (تسجيل → OTP → تصريح فئة → موافقة أدمن
// → منطقة → موقع → اعتماد) بجنب فني "fixture" (INSERT خام، بالظبط زي كل specs المشروع التانية)،
// ومقارنة سلوك المطابقة لثلاث طلبات "تسليك مواسير" نفس اليوم بينهم بالحرف. هدف الاختبار: يثبت/ينفي
// إن مسار إنشاء الحساب نفسه بيأثر على المطابقة، مش يخمّن من قراءة الكود بس (طلب صريح من المالك).
const settingsServiceStub = {
  getNumber: async (_key: string, fallback: number) => fallback,
  getBoolean: async (_key: string, fallback: boolean) => fallback,
  // ADR-0035 — كادينس موجات الشغل القريب بتتقري كنص، فالـstub لازم يغطّي getString كمان.
  getString: async (_key: string, fallback: string) => fallback,
} as unknown as SettingsService;

const config = {
  get: (key: string) => {
    const values: Record<string, unknown> = {
      nodeEnv: 'test',
      'otp.expiryMinutes': 5,
      'otp.maxAttempts': 5,
      'jwt.accessSecret': 'test-access-secret-0123456789',
      'jwt.accessExpiresIn': '15m',
      'jwt.refreshSecret': 'test-refresh-secret-0123456789',
      'jwt.refreshExpiresIn': '30d',
    };
    return values[key];
  },
} as ConfigService;

describe('مسار التسجيل الحقيقي مقابل fixture — تكافؤ المطابقة (docs/08 §36.1 تعميق)', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let authService: AuthService;
  let techniciansService: TechniciansService;
  let categoriesService: TechnicianCategoriesService;
  let adminTechniciansService: AdminTechniciansService;
  let matchingService: MatchingService;

  const runId = randomUUID().replaceAll('-', '').slice(0, 8);
  const ids = {
    country: '',
    city: '',
    zoneFixture: '',
    zoneReal: '',
    zoneNew: '',
    customerProfile: '',
    address: '',
    adminUser: '',
    realCategoryId: '',
    realServiceId: '',
    fixtureProfileId: '',
    newLevelProfileId: '',
  };
  const users: string[] = [];
  const technicianProfiles: string[] = [];
  let realTechnicianUserId = '';
  let realTechnicianProfileId = '';

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function requestAndReadOtp(phone: string, purpose: OtpPurpose): Promise<string> {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await authService.requestOtp({ phone_number: phone, purpose }, null);
    const call = log.mock.calls.find((c) => String(c[0]).includes(phone));
    log.mockRestore();
    if (!call) throw new Error(`OTP code not captured for ${phone}`);
    return String(call[0]).split('→ ').at(-1)!.trim();
  }

  // ADR-0035 (2026-08-25): الطلبات هنا اتنقلت من 2/4/6 ساعة لـ50/52/54 ساعة (نفس اليوم برضه،
  // بعد يومين) **عن قصد**. غرض الملف ده هو **تكافؤ** الفني المسجَّل من الموبايل مع الـfixture،
  // والوسيلة هي تسلسل AUTO ثم فرص شغل إضافي — وده تسلسل الشغل **البعيد**. بعد ADR-0035 أي شغل
  // خلال 48 ساعة بياخد مسار طلب/قبول بدل AUTO، فلو سبنا 2/4/6 ساعة كان الاختبار هيقيس حاجة
  // تانية خالص مش التكافؤ. حالة الشغل القريب نفسها مغطّاة في matching.service.spec.ts.
  async function insertOrder(label: string, zoneId: string, hoursFromNow: number, totalAmountCents = 30000) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, payment_status, booking_mode, total_amount_cents, technician_earning_cents, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,0,$9) RETURNING id`,
      [
        `TESTSIGNUP-${label}`.slice(0, 24),
        ids.customerProfile,
        ids.realServiceId,
        ids.address,
        zoneId,
        OrderStatus.SEARCHING_TECHNICIAN,
        BookingMode.INDIVIDUAL,
        totalAmountCents,
        new Date(Date.now() + hoursFromNow * 60 * 60 * 1000),
      ],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        User,
        OtpCode,
        RefreshToken,
        CustomerProfile,
        TechnicianProfile,
        TechnicianCompany,
        TechnicianDocument,
        TechnicianLevelHistory,
        TechnicianZone,
        TechnicianCategory,
        ServiceCategory,
        Service,
        Wallet,
        Order,
        OrderAssignment,
        OrderStatusHistory,
      ],
    });
    await dataSource.initialize();

    // الاختبار يملك كتالوجه؛ الاعتماد على seed اختياري كان يكسر CI على قاعدة migrated نظيفة.
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`سباكة تسجيل ${runId}`, `Signup Plumbing ${runId}`, `signup-plumbing-${runId}`],
    );
    ids.realCategoryId = category.id;
    const [realService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage)
       VALUES ($1,'تسليك مواسير',$2,'fixed',30000,20) RETURNING id`,
      [ids.realCategoryId, `signup-drain-${runId}`],
    );
    ids.realServiceId = realService.id;

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The fixture requires the seeded EG country');
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة تسجيل ${runId}`,
      `Signup City ${runId}`,
      `test-signup-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zoneFixture] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق fixture ${runId}`,
      `Signup Zone Fixture ${runId}`,
    ]);
    ids.zoneFixture = zoneFixture.id;
    const [zoneReal] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تسجيل حقيقي ${runId}`,
      `Signup Zone Real ${runId}`,
    ]);
    ids.zoneReal = zoneReal.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2070${runId}`.slice(0, 15),
      `عميل تسجيل ${runId}`,
    ]);
    users.push(customerUser.id);
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع تسجيل ${runId}`],
    );
    ids.address = address.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2071${runId}`.slice(0, 15),
      `أدمن تسجيل ${runId}`,
    ]);
    users.push(adminUser.id);
    ids.adminUser = adminUser.id;

    // ── فني fixture — INSERT خام مباشر، بالظبط زي كل specs المشروع التانية ──
    // المستوى VERIFIED مش NEW عمدًا لعزل مقارنة مساري التسجيل عن سياسة حد القرار المتغيرة.
    // فني NEW حقيقي مايقدرش أصلاً ياخد الخدمة دي، مش مسألة "مسار تسجيل" خالص.
    const [fixtureUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2072${runId}`.slice(0, 15),
      `فني fixture ${runId}`,
    ]);
    users.push(fixtureUser.id);
    const [fixtureProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available, current_location)
       VALUES ($1,$2,'x',3,$3,'approved',true, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [fixtureUser.id, `SGNFX${runId}`.slice(0, 20), TechnicianLevel.VERIFIED],
    );
    ids.fixtureProfileId = fixtureProfile.id;
    technicianProfiles.push(fixtureProfile.id);
    await q(
      `INSERT INTO technician_categories (technician_id, category_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`,
      [fixtureProfile.id, ids.realCategoryId],
    );
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      fixtureProfile.id,
      ids.zoneFixture,
    ]);

    // ── خدمات حقيقية مطلوبة للمسار الحقيقي ──
    const geoServiceStub = { findServiceZoneOrThrow: async (id: string) => ({ id }) } as never;
    authService = new AuthService(
      dataSource.getRepository(User),
      dataSource.getRepository(OtpCode),
      dataSource.getRepository(RefreshToken),
      dataSource.getRepository(Wallet),
      dataSource,
      new JwtService(),
      config,
      { emit: jest.fn() } as never,
      { send: jest.fn().mockResolvedValue({ delivered: false, failureReason: 'test' }) } as never,
      { userRequiresMfa: jest.fn().mockResolvedValue(false) } as never,
      { hasAnyCredential: jest.fn().mockResolvedValue(false) } as never,
      { routeToRole: jest.fn() } as never,
    );
    techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never,
      {} as never,
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    categoriesService = new TechnicianCategoriesService(
      dataSource.getRepository(TechnicianCategory),
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(ServiceCategory),
      { emit: jest.fn() } as never,
      { record: jest.fn(async () => undefined) } as never,
    );
    adminTechniciansService = new AdminTechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianDocument),
      dataSource.getRepository(TechnicianLevelHistory),
      dataSource.getRepository(TechnicianZone),
      {} as never,
      {} as never,
      dataSource.getRepository(User),
      { emit: jest.fn() } as never,
      { record: jest.fn(async () => undefined) } as never,
      geoServiceStub,
    );
    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      techniciansService,
      new TechnicianAssignmentGuardService(settingsServiceStub),
      settingsServiceStub,
      { emit: jest.fn() } as never,
      { add: jest.fn() } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
    );

    // ── فني حقيقي — نفس المسار بالحرف: تسجيل → OTP → تصريح فئة → موافقة أدمن على الفئة →
    // تعيين منطقة (مفيش self-service endpoint للمنطقة — الأدمن بس، مؤكَّد بالتدقيق) → موقع
    // ذاتي → اعتماد الأدمن للحساب نفسه. بالترتيب الطبيعي اللي تطبيق الموبايل هيعمله فعليًا.
    const realPhone = `+2073${runId}`.slice(0, 15);
    const registerCode = await requestAndReadOtp(realPhone, OtpPurpose.REGISTER);
    await authService.register(
      { phone_number: realPhone, otp_code: registerCode, full_name: `فني تسجيل حقيقي ${runId}`, user_type: UserType.TECHNICIAN },
      null,
    );
    const realUser = await dataSource.getRepository(User).findOneByOrFail({ phoneNumber: realPhone });
    users.push(realUser.id);
    realTechnicianUserId = realUser.id;
    const realProfile = await dataSource.getRepository(TechnicianProfile).findOneByOrFail({ userId: realUser.id });
    realTechnicianProfileId = realProfile.id;
    technicianProfiles.push(realProfile.id);

    const declaration = await categoriesService.declareCategory(realUser.id, { category_id: ids.realCategoryId });
    await categoriesService.approveCategoryDeclaration(ids.adminUser, declaration.id);
    await adminTechniciansService.assignZone(ids.adminUser, realProfile.id, { service_zone_id: ids.zoneReal, is_primary: false });
    await techniciansService.updateLocation(realUser.id, { latitude: 30.06, longitude: 31.26 });
    await adminTechniciansService.approve(ids.adminUser, realProfile.id);
    // نفس مستوى فني fixture بالحرف (VERIFIED) — طلب المالك الصريح: "identical: category, zone,
    // level, verification, location, availability". ترقية حقيقية عبر AdminTechniciansService.
    // changeLevel() — نفس الطريقة اللي فني حقيقي بيترقّى بيها فعليًا (KPI/يدوي)، مش SQL خام.
    await adminTechniciansService.changeLevel(ids.adminUser, realProfile.id, { level: TechnicianLevel.VERIFIED });

    // ── فني NEW ثالث معزول (نطاق تالت) — يثبت أن حد القرار الحالي يطبق أثناء الاكتشاف نفسه،
    // بغض النظر عن مسار إنشاء الحساب.
    const [zoneNew] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق NEW ${runId}`,
      `Signup Zone NEW ${runId}`,
    ]);
    ids.zoneNew = zoneNew.id;
    const [newUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2074${runId}`.slice(0, 15),
      `فني NEW ${runId}`,
    ]);
    users.push(newUser.id);
    const [newProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available, current_location)
       VALUES ($1,$2,'x',0,$3,'approved',true, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [newUser.id, `SGNNEW${runId}`.slice(0, 20), TechnicianLevel.NEW],
    );
    ids.newLevelProfileId = newProfile.id;
    technicianProfiles.push(newProfile.id);
    await q(
      `INSERT INTO technician_categories (technician_id, category_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`,
      [newProfile.id, ids.realCategoryId],
    );
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      newProfile.id,
      ids.zoneNew,
    ]);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_work_opportunities WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [
        `TESTSIGNUP-%`,
      ]);
      await q(`DELETE FROM order_assignments WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTSIGNUP-%`]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [
        `TESTSIGNUP-%`,
      ]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTSIGNUP-%`]);
      await q(`DELETE FROM technician_categories WHERE technician_id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM wallets WHERE owner_user_id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM technician_level_history WHERE technician_id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianProfiles]);
      await q(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [users]);
      await q(`DELETE FROM otp_codes WHERE phone_number LIKE $1`, [`+207%${runId}%`]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1)`, [[ids.zoneFixture, ids.zoneReal, ids.zoneNew]]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.realServiceId]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.realCategoryId]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  }, 20000);

  it('الفني fixture: 3 طلبات نفس اليوم — أول واحد AUTO، والباقي OPT REQ متسقين', async () => {
    const order1 = await insertOrder('fixture-1', ids.zoneFixture, 50);
    await matchingService.dispatchOrAutoConfirm(order1);
    const [row1] = await q(`SELECT order_status, technician_id FROM orders WHERE id = $1`, [order1]);
    expect(row1.order_status).toBe(OrderStatus.ACCEPTED);
    expect(row1.technician_id).toBe(ids.fixtureProfileId);

    const order2 = await insertOrder('fixture-2', ids.zoneFixture, 52);
    await matchingService.dispatchOrAutoConfirm(order2);
    const [row2] = await q(`SELECT order_status FROM orders WHERE id = $1`, [order2]);
    expect(row2.order_status).toBe(OrderStatus.SEARCHING_TECHNICIAN);
    const [opp2] = await q(
      `SELECT status, context FROM technician_work_opportunities WHERE order_id = $1 AND technician_id = $2`,
      [order2, ids.fixtureProfileId],
    );
    expect(opp2).toMatchObject({ status: 'offered', context: 'assignment' });

    const order3 = await insertOrder('fixture-3', ids.zoneFixture, 54);
    await matchingService.dispatchOrAutoConfirm(order3);
    const [opp3] = await q(
      `SELECT status FROM technician_work_opportunities WHERE order_id = $1 AND technician_id = $2`,
      [order3, ids.fixtureProfileId],
    );
    expect(opp3).toMatchObject({ status: 'offered' });

    const listed = await matchingService.listWorkOpportunitiesForUser(
      (await dataSource.getRepository(TechnicianProfile).findOneByOrFail({ id: ids.fixtureProfileId })).userId,
    );
    const listedOrderIds = listed.map((o) => o.order_id);
    expect(listedOrderIds).toEqual(expect.arrayContaining([order2, order3]));
  });

  it('الفني الحقيقي (تسجيل موبايل → تحقق → اعتماد): نفس السلوك بالحرف — أول واحد AUTO، والباقي OPT REQ', async () => {
    const order1 = await insertOrder('real-1', ids.zoneReal, 50);
    await matchingService.dispatchOrAutoConfirm(order1);
    const [row1] = await q(`SELECT order_status, technician_id FROM orders WHERE id = $1`, [order1]);
    expect(row1.order_status).toBe(OrderStatus.ACCEPTED);
    expect(row1.technician_id).toBe(realTechnicianProfileId);

    const order2 = await insertOrder('real-2', ids.zoneReal, 52);
    await matchingService.dispatchOrAutoConfirm(order2);
    const [row2] = await q(`SELECT order_status FROM orders WHERE id = $1`, [order2]);
    expect(row2.order_status).toBe(OrderStatus.SEARCHING_TECHNICIAN);
    const [opp2] = await q(
      `SELECT status, context FROM technician_work_opportunities WHERE order_id = $1 AND technician_id = $2`,
      [order2, realTechnicianProfileId],
    );
    expect(opp2).toMatchObject({ status: 'offered', context: 'assignment' });

    const order3 = await insertOrder('real-3', ids.zoneReal, 54);
    await matchingService.dispatchOrAutoConfirm(order3);
    const [opp3] = await q(
      `SELECT status FROM technician_work_opportunities WHERE order_id = $1 AND technician_id = $2`,
      [order3, realTechnicianProfileId],
    );
    expect(opp3).toMatchObject({ status: 'offered' });

    // نفس الـAPI اللي تطبيق الفني بينادّيه فعليًا (GET /technician/orders/work-opportunities)
    const listed = await matchingService.listWorkOpportunitiesForUser(realTechnicianUserId);
    const listedOrderIds = listed.map((o) => o.order_id);
    expect(listedOrderIds).toEqual(expect.arrayContaining([order2, order3]));
  });

  it('فني NEW لا يترشح فوق حد قراره الحالي، ويترشح تحته', async () => {
    const [levelConfig] = await q(`SELECT decision_limit_cents FROM technician_level_config WHERE level = 'new'`);
    const decisionLimit = Number(levelConfig?.decision_limit_cents);
    expect(decisionLimit).toBeGreaterThan(1);

    const order1 = await insertOrder('newlevel-1', ids.zoneNew, 50, decisionLimit + 1);
    const dispatchResult = await matchingService.dispatchOrAutoConfirm(order1);
    expect(dispatchResult.dispatched).toBe(0);

    const [row1] = await q(`SELECT order_status, technician_id FROM orders WHERE id = $1`, [order1]);
    // قبل الإصلاح: الفني كان بيترشّح كـlightPick (الوحيد المؤهّل خدمة/منطقة/توفر)، يوصل لآخر خطوة
    // (assertEligible)، يترفض هناك بسبب decision_limit_cents، والطلب كله يترجع "بلا فني" فورًا من
    // غير أي محاولة تانية — findEligibleTechnicians() نفسها ماكانتش عارفة بحد القرار من الأساس.
    // بعد الإصلاح: الاستعلام بيستبعده من الاكتشاف الأول، فمفيش أي فني يترشّح ويفشل بصمت.
    expect(row1.order_status).toBe(OrderStatus.SEARCHING_TECHNICIAN);
    expect(row1.technician_id).toBeNull();

    const [opp] = await q(`SELECT id FROM technician_work_opportunities WHERE order_id = $1 AND technician_id = $2`, [
      order1,
      ids.newLevelProfileId,
    ]);
    expect(opp).toBeUndefined();

    // نفس الفني NEW نفسه بيترشّح عادي لطلب أرخص من حد قراره الحالي — يثبت إن
    // الاستبعاد سعري بحت مربوط بقيمة الطلب الفعلية (order.total_amount_cents)، مش استبعاد عام
    // لمستوى NEW من المطابقة كلها. طلب على نفس الخدمة الحقيقية بس بسعر إجمالي مختلف (formula/
    // خصم واقعي)، مش خدمة تانية مصطنعة.
    const cheapOrderId = await insertOrder('newlevel-cheap', ids.zoneNew, 50, decisionLimit - 1);
    await matchingService.dispatchOrAutoConfirm(cheapOrderId);
    const [cheapRow] = await q(`SELECT order_status, technician_id FROM orders WHERE id = $1`, [cheapOrderId]);
    expect(cheapRow.order_status).toBe(OrderStatus.ACCEPTED);
    expect(cheapRow.technician_id).toBe(ids.newLevelProfileId);
  });
});
