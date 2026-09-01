import { DataSource } from 'typeorm';
import { TechnicianAssignmentGuardService } from './technician-assignment-guard.service';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { Order } from '../orders/entities/order.entity';

/**
 * ADR-0055 (docs/08 §104، تصحيح مالك) — «طالما أنا ما منعتش عنهم الشغل، يبقى زيهم زي الفنيين
 * بالضبط… يظهروا في التعيين الإجباري من عند الأدمن».
 *
 * الاختبار ده بيغطّي **حارس التعيين** تحديدًا: هو آخر خط دفاع وبيتنادى من التعيين الإداري القسري
 * وقبول الفرص. كان بيرفض أي مساعد صراحةً بغض النظر عن أي حاجة تانية — يعني حتى لو الأدمن قرر
 * صراحةً يعيّن مساعد على طلب، الرفض كان بييجي من هنا.
 */
describe('ADR-0055 — المساعد مشارك كامل (حارس التعيين)', () => {
  let dataSource: DataSource;
  let guard: TechnicianAssignmentGuardService;
  const runId = Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);

  const ids = {
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    assistantUser: '',
    assistantProfile: '',
    adminUser: '',
    order: '',
  };

  const q = <T = any>(sql: string, params?: unknown[]): Promise<T[]> => dataSource.query(sql, params);

  // قيمة الطلب متحطّة تحت `decision_limit_cents` لمستوى `new` (20000) عن قصد — الحد ده قاعدة
  // مستوى مالهاش أي علاقة بالدور، ولو الطلب عدّاها الحارس بيرفض لسبب تاني خالص وكان هيخفي
  // اللي الاختبار ده موجود عشانه. (اتلقطت بالتشغيل الحي: الرفض كان "قيمة الطلب أعلى من حد
  // قرار مستوى الفني" مش أي حاجة ليها علاقة بالمساعد.)

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianProfile, Order],
    });
    await dataSource.initialize();
    guard = new TechnicianAssignmentGuardService({
      getNumber: async (_k: string, fallback: number) => fallback,
      getString: async (_k: string, fallback: string) => fallback,
    } as never);

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة مشاركة ${runId}`, `Part City ${runId}`, `test-part-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id,name_ar,name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق مشاركة ${runId}`,
      `Part Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar,name_en,slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة مشاركة ${runId}`,
      `Part Cat ${runId}`,
      `test-part-cat-${runId}`,
    ]);
    ids.category = category.id;
    // خدمة "نقل عفش" — بالظبط نوع الشغل اللي المالك قال إنه شغل المساعدين.
    const [service] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active,estimated_duration_minutes)
       VALUES ($1,$2,$3,'fixed',15000,true,60) RETURNING id`,
      [ids.category, `نقل عفش ${runId}`, `test-part-svc-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2091${runId}`.slice(0, 15),
      `عميل مشاركة ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع مشاركة ${runId}`],
    );
    ids.address = address.id;
    const [adminUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2092${runId}`.slice(0, 15),
      `أدمن مشاركة ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

    const [assistantUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2093${runId}`.slice(0, 15),
      `مساعد مشاركة ${runId}`,
    ]);
    ids.assistantUser = assistantUser.id;
    const [assistantProfile] = await q(
      `INSERT INTO technician_profiles
         (user_id,technician_code,national_id_encrypted,years_of_experience,current_level,verification_status,
          technician_kind,current_location)
       VALUES ($1,$2,'x',2,'new','approved','assistant', ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.assistantUser, `PART-A-${runId}`.slice(0, 20)],
    );
    ids.assistantProfile = assistantProfile.id;
    await q(`INSERT INTO technician_services (technician_id,service_id,is_active,verification_status) VALUES ($1,$2,true,'approved')`, [
      ids.assistantProfile,
      ids.service,
    ]);
    await q(`INSERT INTO technician_zones (technician_id,service_zone_id,is_active) VALUES ($1,$2,true)`, [
      ids.assistantProfile,
      ids.zone,
    ]);

    const [order] = await q(
      `INSERT INTO orders (order_number,customer_id,service_id,address_id,service_zone_id,order_status,payment_status,
                           total_amount_cents,booking_mode,order_type)
       VALUES ($1,$2,$3,$4,$5,'searching_technician','unpaid',15000,'individual','standard') RETURNING id`,
      [`PART-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM technician_excluded_services WHERE technician_id = $1`, [ids.assistantProfile]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM technician_zones WHERE technician_id = $1`, [ids.assistantProfile]);
      await q(`DELETE FROM technician_services WHERE technician_id = $1`, [ids.assistantProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.assistantProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.customerUser, ids.assistantUser, ids.adminUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  }, 20000);

  async function loadEntities() {
    const technician = await dataSource.getRepository(TechnicianProfile).findOneOrFail({ where: { id: ids.assistantProfile } });
    const order = await dataSource.getRepository(Order).findOneOrFail({ where: { id: ids.order } });
    return { technician, order };
  }

  it('الأدمن يقدر يعيّن مساعد على طلب — الرفض على أساس الدور اتشال', async () => {
    const { technician, order } = await loadEntities();
    await expect(guard.assertEligible(dataSource.manager, technician, order)).resolves.toBeUndefined();
  }, 20000);

  it('حجب الخدمة عن المساعد بيمنع التعيين — طبقة إضافية فوق اعتماد التخصص', async () => {
    await q(
      `INSERT INTO technician_excluded_services (technician_id,service_id,excluded_by_user_id,reason)
       VALUES ($1,$2,$3,'مش بيعرف يعملها')`,
      [ids.assistantProfile, ids.service, ids.adminUser],
    );
    try {
      const { technician, order } = await loadEntities();
      await expect(guard.assertEligible(dataSource.manager, technician, order)).rejects.toThrow();
    } finally {
      await q(`DELETE FROM technician_excluded_services WHERE technician_id = $1`, [ids.assistantProfile]);
    }
  }, 20000);

  it('بعد رفع الحجب التعيين بيرجع يعدّي — الحجب قابل للتراجع', async () => {
    const { technician, order } = await loadEntities();
    await expect(guard.assertEligible(dataSource.manager, technician, order)).resolves.toBeUndefined();
  }, 20000);
});
