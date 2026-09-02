import { DataSource } from 'typeorm';
import { City } from '../geo/entities/city.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Area } from '../geo/entities/area.entity';
import { GeoService } from '../geo/geo.service';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechniciansService } from './technicians.service';

// ADR-0039 / docs/08 §62 — اختبار حي ضد Postgres حقيقي.
//
// البند اللي بيتثبت هنا هو **بالظبط** اللي المالك اشتكى منه: قبل الشغل ده، أي فني بيعدّي المرحلة
// الصارمة (verification_status='approved') كان بياخد `isVerified: true` من طبقة العرض حرفيًا.
// الاختبار ده بيثبت إن العلامة بقت مربوطة بعمود حقيقي الأدمن بيتحكم فيه، وإن نفس القاعدة سارية
// على الشركات، وإن أرقام الشركة بقت حقيقية مش صفر ثابت.
describe('علامة التوثيق + عرض الشركة (ADR-0039، docs/08 §62)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: TechniciansService;
  const runId = Date.now().toString(36);
  const ids = {
    cityId: '',
    zoneId: '',
    addressUserId: '',
    addressId: '',
    categoryId: '',
    serviceId: '',
    plainTechUserId: '',
    plainTechId: '',
    badgedTechUserId: '',
    badgedTechId: '',
    companyOwnerUserId: '',
    companyMemberUserId: '',
    companyMemberTechId: '',
    companyId: '',
  };

  async function makeTechnician(label: string, companyId: string | null = null) {
    const [user] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2071${label}${runId}`.slice(0, 15), `فني ${label} ${runId}`],
    );
    const [profile] = await dataSource.query(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, current_location, company_id)
       VALUES ($1,$2,'professional','approved', ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography, $3)
       RETURNING id`,
      [user.id, `TR${label}${runId}`.slice(0, 20), companyId],
    );
    await dataSource.query(
      `INSERT INTO technician_services (technician_id, service_id, is_active, completed_count) VALUES ($1,$2,true,$3)`,
      [profile.id, ids.serviceId, companyId ? 7 : 0],
    );
    await dataSource.query(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [
      profile.id,
      ids.zoneId,
    ]);
    return { userId: user.id as string, techId: profile.id as string };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, TechnicianProfile, City, Area, ServiceZone],
    });
    await dataSource.initialize();

    const [country] = await dataSource.query(`SELECT id FROM countries LIMIT 1`);
    const [category] = await dataSource.query(`SELECT id FROM service_categories LIMIT 1`);
    ids.categoryId = category.id;

    const [city] = await dataSource.query(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة توثيق ${runId}`, `TrustCity${runId}`, `trust-city-${runId}`],
    );
    ids.cityId = city.id;

    const [zone] = await dataSource.query(
      `INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [ids.cityId, `نطاق توثيق ${runId}`, `TrustZone${runId}`],
    );
    ids.zoneId = zone.id;

    const [addressUser] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2072${runId}`.slice(0, 15), `عميل توثيق ${runId}`],
    );
    ids.addressUserId = addressUser.id;

    const [address] = await dataSource.query(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.addressUserId, ids.cityId, 'شارع التوثيق'],
    );
    ids.addressId = address.id;

    const [svc] = await dataSource.query(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active)
       VALUES ($1,$2,$3,'formula',10000,true) RETURNING id`,
      [ids.categoryId, `خدمة توثيق ${runId}`, `trust-service-${runId}`],
    );
    ids.serviceId = svc.id;

    const [companyOwner] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2073${runId}`.slice(0, 15), `مالك شركة توثيق ${runId}`],
    );
    ids.companyOwnerUserId = companyOwner.id;
    const [company] = await dataSource.query(
      `INSERT INTO technician_companies (owner_user_id, name, commercial_registration_number, is_active)
       VALUES ($1,$2,$3,true) RETURNING id`,
      [ids.companyOwnerUserId, `شركة توثيق ${runId}`, `CR-${runId}`],
    );
    ids.companyId = company.id;

    const plain = await makeTechnician('plain');
    ids.plainTechUserId = plain.userId;
    ids.plainTechId = plain.techId;

    const badged = await makeTechnician('badge');
    ids.badgedTechUserId = badged.userId;
    ids.badgedTechId = badged.techId;

    const member = await makeTechnician('comp', ids.companyId);
    ids.companyMemberUserId = member.userId;
    ids.companyMemberTechId = member.techId;

    const geoService = new GeoService(
      dataSource.getRepository(City),
      dataSource.getRepository(Area),
      dataSource.getRepository(ServiceZone),
      dataSource,
    );
    const settingsServiceStub = { getNumber: async (_key: string, defaultValue: number) => defaultValue };
    service = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      {} as never,
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as never,
      geoService,
      settingsServiceStub as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const techIds = [ids.plainTechId, ids.badgedTechId, ids.companyMemberTechId];
    await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.addressId]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM technician_companies WHERE id = $1`, [ids.companyId]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [ids.addressUserId, ids.plainTechUserId, ids.badgedTechUserId, ids.companyMemberUserId, ids.companyOwnerUserId],
    ]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.serviceId]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zoneId]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.cityId]);
    await dataSource.destroy();
  });

  it('فني معتمد لكن من غير مِنحة الأدمن: بيظهر في القايمة بس من غير علامة توثيق', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId, undefined, null, false);
    const row = items.find((i) => i.technicianId === ids.plainTechId);
    // بيظهر فعلاً — العلامة مالهاش أي علاقة بالأهلية.
    expect(row).toBeDefined();
    expect(row?.isVerified).toBe(false);
  });

  it('بعد ما الأدمن يمنح العلامة، نفس الفني بيرجع isVerified=true', async () => {
    await dataSource.query(`UPDATE technician_profiles SET is_trust_verified = true, trust_verified_at = now() WHERE id = $1`, [
      ids.badgedTechId,
    ]);
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId, undefined, null, false);
    expect(items.find((i) => i.technicianId === ids.badgedTechId)?.isVerified).toBe(true);
    // والتاني اللي مأخدش المِنحة لسه من غير علامة — المِنحة فردية مش عامة.
    expect(items.find((i) => i.technicianId === ids.plainTechId)?.isVerified).toBe(false);
  });

  it('الشركة: العلامة بتيجي من technician_companies، وأرقام الشغل المكتمل حقيقية مش صفر ثابت', async () => {
    const before = await service.listForServiceBooking(ids.serviceId, ids.addressId, undefined, null, true);
    const companyBefore = before.items.find((i) => i.isCompany && i.technicianId === ids.companyId);
    expect(companyBefore).toBeDefined();
    expect(companyBefore?.isVerified).toBe(false);
    // كان 0 ثابت في الكود قبل §62.2 — دلوقتي مجموع completed_count الحقيقي لأعضاء الشركة.
    expect(companyBefore?.serviceCompletedCount).toBe(7);
    expect(companyBefore?.isCommercialCompany).toBe(true);

    await dataSource.query(`UPDATE technician_companies SET is_trust_verified = true, trust_verified_at = now() WHERE id = $1`, [
      ids.companyId,
    ]);
    const after = await service.listForServiceBooking(ids.serviceId, ids.addressId, undefined, null, true);
    expect(after.items.find((i) => i.isCompany && i.technicianId === ids.companyId)?.isVerified).toBe(true);
  });
});
