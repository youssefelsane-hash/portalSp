import { DataSource } from 'typeorm';
import { City } from '../geo/entities/city.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Area } from '../geo/entities/area.entity';
import { GeoService } from '../geo/geo.service';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechniciansService } from './technicians.service';

// docs/08 §38 (طلب مالك صريح 2026-08-21) — "اعتماد" لازم يفضل نفس قايمة "فردي" بالحرف إلا فلترة
// مستوى الفني (محترف فأعلى)، والشركات تندمج في نفس القايمة بس في اعتماد. اختبار حي ضد Postgres
// حقيقي يثبت الفرق الوحيد المطلوب بين الوضعين.
describe('TechniciansService.listForServiceBooking — فلترة مستوى "اعتماد" + دمج الشركات (docs/08 §38)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: TechniciansService;
  const runId = Date.now().toString(36);
  const ids = {
    countryId: '',
    cityId: '',
    zoneId: '',
    addressUserId: '',
    addressId: '',
    categoryId: '',
    serviceId: '',
    newTechUserId: '',
    newTechId: '',
    proTechUserId: '',
    proTechId: '',
    companyMemberUserId: '',
    companyMemberTechId: '',
    companyId: '',
  };

  async function makeTechnician(level: string, label: string, companyId: string | null = null) {
    const [user] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+204${label}${runId}`.slice(0, 15), `فني ${label} ${runId}`],
    );
    const [profile] = await dataSource.query(
      `INSERT INTO technician_profiles
         (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location, company_id)
       VALUES ($1,$2,$3,'approved',true,true, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography, $4) RETURNING id`,
      [user.id, `TB${label}${runId}`.slice(0, 20), level, companyId],
    );
    await dataSource.query(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [
      profile.id,
      ids.serviceId,
    ]);
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
    ids.countryId = country.id;
    const [category] = await dataSource.query(`SELECT id FROM service_categories LIMIT 1`);
    ids.categoryId = category.id;

    const [city] = await dataSource.query(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.countryId, `مدينة اعتماد ${runId}`, `TeamCity${runId}`, `team-city-${runId}`],
    );
    ids.cityId = city.id;

    const [zone] = await dataSource.query(
      `INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [ids.cityId, `نطاق اعتماد ${runId}`, `TeamZone${runId}`],
    );
    ids.zoneId = zone.id;

    const [addressUser] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+205${runId}`.slice(0, 15), `عميل اعتماد ${runId}`],
    );
    ids.addressUserId = addressUser.id;

    const [address] = await dataSource.query(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.addressUserId, ids.cityId, 'شارع اعتماد'],
    );
    ids.addressId = address.id;

    const [svc] = await dataSource.query(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active)
       VALUES ($1,$2,$3,'formula',10000,true) RETURNING id`,
      [ids.categoryId, `خدمة اعتماد ${runId}`, `team-service-${runId}`],
    );
    ids.serviceId = svc.id;

    // شركة نشطة — منشأة مباشرة بـSQL (bypass لفحوصات إنشاء الشركة نفسها، مش موضوع الاختبار ده).
    const [companyOwnerUser] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+206${runId}`.slice(0, 15), `مالك شركة ${runId}`],
    );
    const [company] = await dataSource.query(`INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`, [
      companyOwnerUser.id,
      `شركة اختبار ${runId}`,
    ]);
    ids.companyId = company.id;

    const newTech = await makeTechnician('new', 'new');
    ids.newTechUserId = newTech.userId;
    ids.newTechId = newTech.techId;

    const proTech = await makeTechnician('professional', 'pro');
    ids.proTechUserId = proTech.userId;
    ids.proTechId = proTech.techId;

    // عضو الشركة نفسه مستواه new عمدًا — الهدف إثبات إن ظهور الشركة كـكارت لا يعتمد على مستوى
    // الفني الفردي بتاعها (الشركة موثوقة كوحدة، راجع تعليق technicians.service.ts).
    const companyMember = await makeTechnician('new', 'comp', ids.companyId);
    ids.companyMemberUserId = companyMember.userId;
    ids.companyMemberTechId = companyMember.techId;

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
    const techIds = [ids.newTechId, ids.proTechId, ids.companyMemberTechId];
    await q(`DELETE FROM technician_zones WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM technician_services WHERE technician_id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.addressId]);
    await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [techIds]);
    await q(`DELETE FROM technician_companies WHERE id = $1`, [ids.companyId]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [ids.addressUserId, ids.newTechUserId, ids.proTechUserId, ids.companyMemberUserId],
    ]);
    const [ownerRow] = await q(`SELECT owner_user_id FROM technician_companies WHERE id = $1`, [ids.companyId]).catch(() => [null]);
    if (ownerRow?.owner_user_id) await q(`DELETE FROM users WHERE id = $1`, [ownerRow.owner_user_id]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.serviceId]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zoneId]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.cityId]);
    await dataSource.destroy();
  });

  it('فردي (isTeamBooking=false) — فني new وfني professional الاتنين بيظهروا، صفر شركات', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId, undefined, null, false);
    const ourItems = items.filter((i) => [ids.newTechId, ids.proTechId].includes(i.technicianId));
    expect(ourItems.map((i) => i.technicianId).sort()).toEqual([ids.newTechId, ids.proTechId].sort());
    expect(items.some((i) => i.isCompany)).toBe(false);
  });

  it('اعتماد (isTeamBooking=true) — فني new بيتحجب، professional يظهر، والشركة تظهر كارت منفصل', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId, undefined, null, true);
    expect(items.some((i) => i.technicianId === ids.newTechId)).toBe(false);
    expect(items.some((i) => i.technicianId === ids.proTechId)).toBe(true);

    const companyItem = items.find((i) => i.isCompany && i.technicianId === ids.companyId);
    expect(companyItem).toBeDefined();
    expect(companyItem?.staffCount).toBe(1);
    expect(companyItem?.branchCount).toBe(0);

    // عضو الشركة نفسه (مستواه new) مبيظهرش كصف فردي منفصل في اعتماد — بس شركته ظهرت.
    expect(items.some((i) => i.technicianId === ids.companyMemberTechId)).toBe(false);
  });
});
