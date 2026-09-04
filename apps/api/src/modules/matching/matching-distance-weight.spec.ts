import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { BookingMode, Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from './entities/order-assignment.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { MatchingService } from './matching.service';
import { levelPremiumServiceStub } from '../pricing/level-premium.testing';
import { resolveDistanceWeight } from './matching-weights';

/**
 * ADR-0062 — **المسافة وزن حقيقي في الترتيب، وشدّته من إعدادات الأدمن حسب سياق الطلب**.
 *
 * السيناريو مصمّم عشان يفرّق فعلاً: الفني البعيد **أعلى مستوى** (professional، وزن جودة 20)
 * والقريب أقل (verified، وزن 10). يعني تحت السلوك القديم (المسافة كاسر تعادل بس) البعيد بيكسب
 * دايمًا مهما كانت المسافة — وده بالظبط اللي المالك اعترض عليه في الطوارئ والشغل الرخيص.
 */
describe('وزن المسافة الديناميكي في المطابقة (ADR-0062)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  const settingValues = new Map<string, number>();
  let matchingService: MatchingService;

  const runId = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const ids = {
    city: '', zone: '', category: '', service: '',
    nearUser: '', nearProfile: '', farUser: '', farProfile: '',
    customerUser: '', customerProfile: '', address: '', order: '',
  };

  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  /** الطلب المرشّح كما بيتقرا من قاعدة البيانات — نفس الكائن اللي المطابقة الحقيقية بتاخده. */
  const loadOrder = async (): Promise<Order> =>
    (await dataSource.getRepository(Order).findOneOrFail({ where: { id: ids.order } }));

  const rankedIds = async (order: Order): Promise<string[]> =>
    (await matchingService.findEligibleTechnicians(order, 10)).map((c) => c.technician_id);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    // إعدادات قابلة للتغيير جوّه الاختبار — بتحاكي الأدمن وهو بيعدّل القيمة من الشاشة بالظبط.
    const settingsStub = {
      getNumber: async (key: string, fallback: number) => settingValues.get(key) ?? fallback,
      getString: async (_key: string, fallback: string) => fallback,
      getBoolean: async (_key: string, fallback: boolean) => fallback,
    } as never;

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      new TechnicianAssignmentGuardService(settingsStub),
      settingsStub,
      { emit: jest.fn() } as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
      new TechnicianWorkOpportunitiesService(dataSource),
      levelPremiumServiceStub(),
    );

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `city ${runId}`, `dist-city-${runId.toLowerCase()}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `منطقة ${runId}`, `zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [cat] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة ${runId}`, `cat ${runId}`, `dist-cat-${runId.toLowerCase()}`,
    ]);
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, pricing_model, base_price_cents, estimated_duration_minutes)
       VALUES ($1,$2,$3,$4,'formula',10000,120) RETURNING id`,
      [ids.category, `خدمة ${runId}`, `svc ${runId}`, `dist-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;

    // العنوان في (31.2500, 30.0500). القريب على بُعد ~0.2 كم، البعيد على بُعد ~13 كم.
    const makeTechnician = async (label: string, level: string, lng: number, lat: number) => {
      const [u] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+2093${runId.slice(0, 8)}${label}`, `فني ${label} ${runId}`,
      ]);
      const [p] = await q(
        `INSERT INTO technician_profiles (user_id, technician_code, verification_status, current_level, technician_kind, current_location)
         VALUES ($1,$2,'approved',$3,'technician', ST_SetSRID(ST_MakePoint($4,$5),4326)::geography) RETURNING id`,
        [u.id, `DST-${runId}-${label}`, level, lng, lat],
      );
      await q(
        `INSERT INTO technician_services (technician_id, service_id, verification_status, is_active) VALUES ($1,$2,'approved',true)`,
        [p.id, ids.service],
      );
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [p.id, ids.zone]);
      return { userId: u.id as string, profileId: p.id as string };
    };

    const near = await makeTechnician('N', 'verified', 31.2518, 30.0500);
    ids.nearUser = near.userId;
    ids.nearProfile = near.profileId;
    const far = await makeTechnician('F', 'professional', 31.3850, 30.0500);
    ids.farUser = far.userId;
    ids.farProfile = far.profileId;

    const [cu] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2092${runId.slice(0, 8)}9`, `عميل ${runId}`,
    ]);
    ids.customerUser = cu.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = cp.id;
    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.2500,30.0500),4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع ${runId}`],
    );
    ids.address = addr.id;

    // طلب رخيص (10000 قرش = 100 جنيه) مجدول بعد شهر — بره نافذة الشغل العاجل عمدًا، عشان كل
    // سياق يتفحص لوحده بلا تداخل.
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
                           order_status, scheduled_at, total_amount_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,'searching_technician', now() + interval '30 days', 10000, 'individual') RETURNING id`,
      [`DST-${runId}`, ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;
  });

  beforeEach(() => settingValues.clear());

  afterAll(async () => {
    try {
      await q(`DELETE FROM order_assignments WHERE order_id = $1`, [ids.order]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      const profiles = [ids.nearProfile, ids.farProfile];
      await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1)`, [profiles]);
      await q(`DELETE FROM technician_services WHERE technician_id = ANY($1)`, [profiles]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [profiles]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.customerUser, ids.nearUser, ids.farUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('الافتراضي (كل الأوزان صفر): الأعلى مستوى بيكسب مهما كان بعيد — السلوك القديم بالحرف', async () => {
    const order = await loadOrder();
    expect((await rankedIds(order))[0]).toBe(ids.farProfile);
  });

  it('وزن أساسي للمسافة بيقلب النتيجة لصالح الأقرب', async () => {
    settingValues.set('matching.distance_weight', 2);
    const order = await loadOrder();
    // فرق الجودة 10 نقاط، والمسافة ~13 كم × 2 = ~26 نقطة خصم ⇒ القريب بيكسب.
    expect((await rankedIds(order))[0]).toBe(ids.nearProfile);
  });

  it('الطوارئ ليها وزنها الخاص — نفس الطلب بيقلب لما يبقى طوارئ وبس', async () => {
    settingValues.set('matching.distance_weight_emergency', 5);
    const scheduled = await loadOrder();
    // مجدول عادي: وزن الطوارئ مالوش أي أثر ⇒ الأعلى مستوى لسه بيكسب.
    expect((await rankedIds(scheduled))[0]).toBe(ids.farProfile);

    const emergency = { ...scheduled, bookingMode: BookingMode.EMERGENCY, scheduledAt: null } as Order;
    expect((await rankedIds(emergency))[0]).toBe(ids.nearProfile);
  });

  it('الطوارئ: **ترتيب الموجات كله** بيتقلب للأقرب مش أول واحد بس (سؤال المالك المباشر)', async () => {
    // المالك سأل: «الأدمن لو عايز أقرب واحد هو اللي يجيه الطوارئ… بيروح لأول ٣-٤ أشخاص بيكونوا
    // دول أقرب أشخاص، بعد كده بيبتدي يبعد شوية شوية». الموجات بتاخد أعلى `matching.batch_size`
    // من **نفس الترتيب** ده، فإثبات إن الترتيب الكامل بالقرب = إثبات إن الموجة الأولى هي الأقرب.
    settingValues.set('matching.distance_weight_emergency', 5);
    const emergency = { ...(await loadOrder()), bookingMode: BookingMode.EMERGENCY, scheduledAt: null } as Order;
    expect(await rankedIds(emergency)).toEqual([ids.nearProfile, ids.farProfile]);

    // وبصفر (الافتراضي الحالي في قاعدة البيانات) الترتيب بيرجع للمستوى/الجودة — يعني الإعداد
    // فعلاً هو اللي بيتحكم، مش مجرد قيمة متخزّنة مالهاش أثر.
    settingValues.set('matching.distance_weight_emergency', 0);
    expect(await rankedIds(emergency)).toEqual([ids.farProfile, ids.nearProfile]);
  });

  it('الشغلانة الرخيصة ليها وزنها الخاص', async () => {
    settingValues.set('matching.distance_weight_low_value', 4);
    // حد «الرخيص» الافتراضي 15000 قرش، والطلب 10000 ⇒ ينطبق.
    expect((await rankedIds(await loadOrder()))[0]).toBe(ids.nearProfile);

    // نفس الطلب بسعر فوق الحد ⇒ السياق مابينطبقش، والأعلى مستوى بيكسب تاني.
    const expensive = { ...(await loadOrder()), totalAmountCents: 90_000 } as Order;
    expect((await rankedIds(expensive))[0]).toBe(ids.farProfile);
  });

  it('الموعد القريب (خلال 48 ساعة) ليه وزنه الخاص', async () => {
    settingValues.set('matching.distance_weight_near_term', 4);
    // الطلب الأصلي بعد 30 يوم ⇒ بره النافذة.
    expect((await rankedIds(await loadOrder()))[0]).toBe(ids.farProfile);

    const soon = { ...(await loadOrder()), scheduledAt: new Date(Date.now() + 5 * 3_600_000) } as Order;
    expect((await rankedIds(soon))[0]).toBe(ids.nearProfile);
  });

  // اختيار الوزن نفسه منطق مستقل عن قاعدة البيانات — بيتفحص لوحده عشان قاعدة «الأعلى بياخد»
  // تفضل موثّقة بسلوك، مش بتعليق بس.
  describe('resolveDistanceWeight — الأعلى بياخد، مش المجموع', () => {
    const reader = (values: Record<string, number>) => ({
      getNumber: async (key: string, fallback: number) => values[key] ?? fallback,
    });

    it('طوارئ + رخيص + قريب: الوزن الأعلى بس هو اللي بيسري', async () => {
      const resolved = await resolveDistanceWeight(
        reader({
          'matching.distance_weight': 1,
          'matching.distance_weight_emergency': 7,
          'matching.distance_weight_near_term': 3,
          'matching.distance_weight_low_value': 5,
        }),
        { bookingMode: BookingMode.EMERGENCY, scheduledAt: null, totalAmountCents: 5000 } as Order,
      );
      expect(resolved).toEqual({ weight: 7, context: 'emergency' });
    });

    it('سياق وزنه أقل من الأساسي مابيقللش الوزن', async () => {
      const resolved = await resolveDistanceWeight(
        reader({ 'matching.distance_weight': 6, 'matching.distance_weight_emergency': 2 }),
        { bookingMode: BookingMode.EMERGENCY, scheduledAt: null, totalAmountCents: 99_000 } as Order,
      );
      expect(resolved).toEqual({ weight: 6, context: 'base' });
    });

    it('الافتراضي صفر — المسافة كاسر تعادل بس', async () => {
      const resolved = await resolveDistanceWeight(reader({}), {
        bookingMode: BookingMode.INDIVIDUAL,
        scheduledAt: new Date(Date.now() + 30 * 86_400_000),
        totalAmountCents: 99_000,
      } as Order);
      expect(resolved).toEqual({ weight: 0, context: 'base' });
    });
  });
});
