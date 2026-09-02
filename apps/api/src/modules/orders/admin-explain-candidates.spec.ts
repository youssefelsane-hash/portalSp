import { DataSource } from 'typeorm';
import { AdminOrdersService } from './admin-orders.service';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { User } from '../auth/entities/user.entity';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { GeoService } from '../geo/geo.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { Service } from '../catalog/entities/service.entity';
import { TechniciansService } from '../technicians/technicians.service';

/**
 * docs/08 §107 — بلاغ المالك «المساعدين مش ظاهرين في خانة ليه/ليه لأ».
 *
 * الاختبار بيقفل على الفرق الجوهري بين القايمتين: التعيين الإجباري = المؤهّلون بس (عشان الأدمن
 * ما يختارش حد `assertCoreEligibility()` هيرفضه بـ409)، ومفتّش المطابقة = **الكل**، لأن سؤال
 * «ليه ده مش مختار؟» مستحيل يتسأل لو اللي إجابته «لأ» متشال من القايمة أصلاً.
 *
 * الأربعة في الفكسشر متطابقين تمامًا ماعدا `technician_kind` و`current_level` — أي فرق في
 * النتيجة يبقى سببه الاتنين دول بالظبط، مش أي حاجة تانية.
 */
describe('AdminOrdersService — مرشّحو مفتّش المطابقة مقابل قايمة التعيين الإجباري (§107)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  let service: AdminOrdersService;
  const runId = Date.now().toString(36);
  const ids: Record<string, string> = {};
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  // بَقّة نظافة اختبارات (نفس عيلة اللي اتصلحت في matching-work-opportunity وadmin-crew-management):
  // `+2093${tag}${runId}` بيتقص على 15 حرف، والقص بيقع **جوّه `runId`** فبيسيب منه 3 حروف بس
  // (`+2093asstNewmtk`). أي تشغيلتين الـrunId بتاعهم بيبدأ بنفس التلات حروف بيتصادموا، والصفوف
  // اللي بتفضل ورا التشغيلة الفاشلة بتفضل تكسّر كل تشغيلة بعدها للأبد.
  // الحل: رقم تسلسلي قصير بدل الـtag الطويل، فالـrunId بيدخل كامل جوّه الـ15 حرف.
  let providerSeq = 0;
  async function makeProvider(tag: string, kind: 'technician' | 'assistant', level: string) {
    const phoneSuffix = `${providerSeq++}${runId}`;
    const [u] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2093${phoneSuffix}`.slice(0, 15),
      `${tag} ${runId}`,
    ]);
    const [p] = await q(
      `INSERT INTO technician_profiles
         (user_id,technician_code,national_id_encrypted,verification_status,current_level,technician_kind,current_location)
       VALUES ($1,$2,'x','approved',$3,$4, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [u.id, `EXC${tag}${runId}`.slice(0, 20), level, kind],
    );
    await q(
      `INSERT INTO technician_categories (technician_id,category_id,verification_status,is_active) VALUES ($1,$2,'approved',true)`,
      [p.id, ids.category],
    );
    await q(`INSERT INTO technician_zones (technician_id,service_zone_id,is_active) VALUES ($1,$2,true)`, [p.id, ids.zone]);
    ids[tag] = p.id;
    ids[`${tag}User`] = u.id;
  }

  async function makeOrder(bookingMode: 'individual' | 'team'): Promise<string> {
    const [order] = await q(
      `INSERT INTO orders
         (order_number, customer_id, service_id, address_id, service_zone_id, order_status, booking_mode,
          required_technicians, required_assistants, scheduled_at, subtotal_cents, total_amount_cents)
       VALUES ($1,$2,$3,$4,$5,'searching_technician',$6,$7,$8, now() + interval '2 days', 50000, 50000)
       RETURNING id`,
      [
        `EXC-${bookingMode}-${runId}`.slice(0, 30),
        ids.customerProfile,
        ids.service,
        ids.address,
        ids.zone,
        bookingMode,
        bookingMode === 'team' ? 2 : 1,
        bookingMode === 'team' ? 2 : 0,
      ],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, OrderTeamMember, TechnicianOrderCancellation, User, TechnicianProfile, Service, City, Area, ServiceZone],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries LIMIT 1`);
    const [category] = await q(`INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة مفتّش ${runId}`,
      `ExcCat${runId}`,
      `exc-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [city] = await q(`INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة مفتّش ${runId}`,
      `ExcCity${runId}`,
      `exc-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`, [
      ids.city,
      `نطاق مفتّش ${runId}`,
      `ExcZone${runId}`,
    ]);
    ids.zone = zone.id;
    const [customerUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2092${runId}`.slice(0, 15),
      `عميل مفتّش ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, 'شارع المفتّش'],
    );
    ids.address = address.id;
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,commission_percentage,estimated_duration_minutes,is_active)
       VALUES ($1,$2,$3,'formula',50000,20,60,true) RETURNING id`,
      [ids.category, `خدمة مفتّش ${runId}`, `exc-svc-${runId}`],
    );
    ids.service = svc.id;

    await makeProvider('techNew', 'technician', 'new');
    await makeProvider('techPro', 'technician', 'professional');
    await makeProvider('asstNew', 'assistant', 'new');
    await makeProvider('asstPro', 'assistant', 'professional');

    ids.individualOrder = await makeOrder('individual');
    ids.teamOrder = await makeOrder('team');

    const geoService = new GeoService(
      dataSource.getRepository(City),
      dataSource.getRepository(Area),
      dataSource.getRepository(ServiceZone),
      dataSource,
    );
    const settingsStub = { getNumber: async (_key: string, fallback: number) => fallback };
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      dataSource.getRepository(Service),
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as never,
      geoService,
      settingsStub as never,
    );
    service = new AdminOrdersService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderStatusHistory),
      dataSource.getRepository(TechnicianOrderCancellation),
      dataSource.getRepository(OrderTeamMember),
      dataSource,
      techniciansService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settingsStub as never,
      {} as never,
      {} as never, // workOpportunities (ADR-0057) — مش متنادى هنا
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const profiles = [ids.techNew, ids.techPro, ids.asstNew, ids.asstPro];
    const users = [ids.customerUser, ids.techNewUser, ids.techProUser, ids.asstNewUser, ids.asstProUser];
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [[ids.individualOrder, ids.teamOrder]]);
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
  });

  // ده بالظبط اللي المالك شافه: طلب طاقم، ومساعدينه مستواهم `new`، فاختفوا من الخانة خالص.
  it('طلب الطاقم كان بيخفي المساعد الجديد من قايمة التعيين — والفني الجديد كمان، نفس القاعدة', async () => {
    const eligible = await service.listEligibleTechniciansForReassign(ids.teamOrder);
    const eligibleIds = eligible.items.map((item) => item.technicianId);

    expect(eligibleIds).toContain(ids.techPro);
    expect(eligibleIds).toContain(ids.asstPro);
    // الاستبعاد على المستوى مش على الدور — الفني الجديد بيتشال بنفس الشرط بالظبط.
    expect(eligibleIds).not.toContain(ids.asstNew);
    expect(eligibleIds).not.toContain(ids.techNew);
  });

  it('مفتّش المطابقة بيرجّع الأربعة — فنيين ومساعدين، مؤهّلين وغير مؤهّلين', async () => {
    const { items } = await service.listExplainCandidates(ids.teamOrder);
    const byId = new Map(items.map((item) => [item.technicianId, item]));

    for (const id of [ids.techNew, ids.techPro, ids.asstNew, ids.asstPro]) {
      expect(byId.has(id)).toBe(true);
    }
    expect(byId.get(ids.asstNew)!.technicianKind).toBe('assistant');
    expect(byId.get(ids.techNew)!.technicianKind).toBe('technician');
    // العلامة لازم تطابق قايمة التعيين بالحرف — الواجهة بتفرّق بيها بصريًا.
    expect(byId.get(ids.asstPro)!.isEligibleNow).toBe(true);
    expect(byId.get(ids.asstNew)!.isEligibleNow).toBe(false);
    expect(byId.get(ids.techNew)!.isEligibleNow).toBe(false);
  });

  it('المساعد الجديد مؤهّل عادي في الطلب الفردي — الحاجز حاجز مستوى قيادة مش حاجز دور', async () => {
    const eligible = await service.listEligibleTechniciansForReassign(ids.individualOrder);
    const eligibleIds = eligible.items.map((item) => item.technicianId);

    expect(eligibleIds).toContain(ids.asstNew);
    expect(eligibleIds).toContain(ids.asstPro);
    expect(eligibleIds).toContain(ids.techNew);
  });

  it('قايمة التعيين الإجباري بترجّع دور كل مرشّح — مصدر رمز FN/HF في الأدمن', async () => {
    const eligible = await service.listEligibleTechniciansForReassign(ids.individualOrder);
    const byId = new Map(eligible.items.map((item) => [item.technicianId, item]));

    expect(byId.get(ids.asstNew)!.technicianKind).toBe('assistant');
    expect(byId.get(ids.techNew)!.technicianKind).toBe('technician');
    expect(byId.get(ids.asstNew)!.currentLevel).toBe('new');
  });

  // المساعد اللي الأدمن حجب عنه الخدمة لازم يفضل ظاهر في المفتّش — ده بالظبط السؤال اللي
  // الأدمن بيسأله: «ليه ده مش مختار؟» والإجابة لازم تكون متاحة، مش يختفي بصمت.
  it('حتى المحجوب عن الخدمة بيفضل في قايمة المفتّش عشان يتفسّر', async () => {
    const [admin] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2094${runId}`.slice(0, 15),
      `أدمن مفتّش ${runId}`,
    ]);
    try {
      await q(
        `INSERT INTO technician_excluded_services (technician_id, service_id, excluded_by_user_id) VALUES ($1,$2,$3)`,
        [ids.asstPro, ids.service, admin.id],
      );
      const eligibleIds = (await service.listEligibleTechniciansForReassign(ids.individualOrder)).items.map((i) => i.technicianId);
      expect(eligibleIds).not.toContain(ids.asstPro);

      const { items } = await service.listExplainCandidates(ids.individualOrder);
      const candidate = items.find((item) => item.technicianId === ids.asstPro);
      expect(candidate).toBeDefined();
      expect(candidate!.isEligibleNow).toBe(false);
    } finally {
      await q(`DELETE FROM technician_excluded_services WHERE technician_id = $1`, [ids.asstPro]);
      await q(`DELETE FROM users WHERE id = $1`, [admin.id]);
    }
  });
});
