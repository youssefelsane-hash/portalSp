import { DataSource } from 'typeorm';
import { TechnicianCategory } from '../catalog/entities/technician-category.entity';
import { TechnicianService } from '../catalog/entities/technician-service.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { TechnicianCompany } from './entities/technician-company.entity';
import { TechnicianZone } from './entities/technician-zone.entity';
import { ProviderScopeService } from './provider-scope.service';
import { providerServiceQualificationCondition, providerZoneCondition } from './provider-scope.sql';

/**
 * **ADR-0079 — الشركة منفّذ على نفس اللاين**: نفس الجداول، نفس شرط الأهلية، نفس الخدمة.
 *
 * طلب المالك (2026-09-06): «عايز الشركة يكون عندها نفس اللي عند الفني بالضبط… ما تعملهاش
 * حاجات زي الفني، دخّلها على نفس اللاين».
 *
 * الاختبار بيثبت التلاتة على قاعدة بيانات حقيقية:
 *  1. نفس الخدمة بتكتب نطاق للفني وللشركة بنفس الاستدعاء بالظبط.
 *  2. القاعدة بترفض أي صف بمالكين أو بلا مالك (`chk_*_owner`).
 *  3. نفس شرط الـSQL بيدّي إجابة صحيحة للاتنين بمجرد تغيير عمود المالك.
 */
describe('نطاق المنفّذ — الشركة على نفس لاين الفني (ADR-0079)', () => {
  jest.setTimeout(40_000);

  let dataSource: DataSource;
  let scope: ProviderScopeService;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = {
    category: '', service: '', zone: '', city: '',
    company: '', companyOwnerUser: '', tech: '', techUser: '', adminUser: '',
  };
  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [TechnicianService, TechnicianCategory, TechnicianZone, TechnicianCompany, Service, ServiceCategory, ServiceZone],
    });
    await dataSource.initialize();

    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`نطاق ${runId}`, `scope ${runId}`, `scope-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, estimated_duration_minutes, pricing_model)
       VALUES ($1,$2,$3,$4,10000,60,'formula') RETURNING id`,
      [ids.category, `خدمة ${runId}`, `svc ${runId}`, `scope-svc-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [country.id, `مدينة ${runId}`, `city ${runId}`, `scope-city-${runId.toLowerCase()}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `منطقة ${runId}`, `zone ${runId}`],
    );
    ids.zone = zone.id;

    const [ou] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2089${runId}`.slice(0, 15), `مالك ${runId}`],
    );
    ids.companyOwnerUser = ou.id;
    ids.adminUser = ou.id; // أي مستخدم حقيقي يكفي كـactor لسجل التدقيق هنا
    const [company] = await q(
      `INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`,
      [ids.companyOwnerUser, `شركة ${runId}`],
    );
    ids.company = company.id;
    const [tu] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2088${runId}`.slice(0, 15), `فني ${runId}`],
    );
    ids.techUser = tu.id;
    const [tp] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, verification_status)
       VALUES ($1,$2,'approved') RETURNING id`,
      [ids.techUser, `PS-${runId}`],
    );
    ids.tech = tp.id;

    scope = new ProviderScopeService(
      dataSource.getRepository(TechnicianService),
      dataSource.getRepository(TechnicianCategory),
      dataSource.getRepository(TechnicianZone),
      dataSource.getRepository(TechnicianCompany),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(ServiceZone),
      { record: async () => undefined } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const alive = (id: string): string[] => (id ? [id] : []);
    try {
      await q(`DELETE FROM technician_services WHERE company_id = ANY($1) OR technician_id = ANY($2)`, [alive(ids.company), alive(ids.tech)]);
      await q(`DELETE FROM technician_categories WHERE company_id = ANY($1) OR technician_id = ANY($2)`, [alive(ids.company), alive(ids.tech)]);
      await q(`DELETE FROM technician_zones WHERE company_id = ANY($1) OR technician_id = ANY($2)`, [alive(ids.company), alive(ids.tech)]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1)`, [alive(ids.tech)]);
      await q(`DELETE FROM technician_companies WHERE id = ANY($1)`, [alive(ids.company)]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[...alive(ids.techUser), ...alive(ids.companyOwnerUser)]]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [alive(ids.service)]);
      await q(`DELETE FROM service_categories WHERE id = ANY($1)`, [alive(ids.category)]);
      await q(`DELETE FROM service_zones WHERE id = ANY($1)`, [alive(ids.zone)]);
      await q(`DELETE FROM cities WHERE id = ANY($1)`, [alive(ids.city)]);
    } finally {
      await dataSource.destroy();
    }
  });

  const company = () => ({ kind: 'company' as const, id: ids.company });
  const technician = () => ({ kind: 'technician' as const, id: ids.tech });

  it('نفس الاستدعاء بيكتب نطاق للشركة وللفني — والصفوف مابتتلخبطش', async () => {
    await scope.assignService(ids.adminUser, company(), ids.service);
    await scope.assignService(ids.adminUser, technician(), ids.service);

    const companyRows = await scope.listServices(company());
    const technicianRows = await scope.listServices(technician());
    expect(companyRows).toHaveLength(1);
    expect(technicianRows).toHaveLength(1);
    expect(companyRows[0].technicianId).toBeNull();
    expect(companyRows[0].companyId).toBe(ids.company);
    expect(technicianRows[0].companyId).toBeNull();
    expect(technicianRows[0].technicianId).toBe(ids.tech);
  });

  it('نفس شرط الـSQL بيدّي إجابة صحيحة للاتنين — بيتغيّر عمود المالك بس', async () => {
    await scope.assignZone(ids.adminUser, company(), ids.zone, true);
    await scope.assignZone(ids.adminUser, technician(), ids.zone, false);

    const qualified = async (ownerColumn: 'technician_id' | 'company_id', ownerId: string): Promise<boolean> => {
      const [row] = await q<{ ok: boolean }>(
        `SELECT (
           ${providerServiceQualificationCondition({ ownerColumn, ownerIdExpr: '$1::uuid', serviceIdExpr: '$2::uuid', categoryIdExpr: 's.category_id' })}
           AND ${providerZoneCondition({ ownerColumn, ownerIdExpr: '$1::uuid', zoneIdExpr: '$3::uuid' })}
         ) AS ok
         FROM services s WHERE s.id = $2::uuid`,
        [ownerId, ids.service, ids.zone],
      );
      return row.ok;
    };

    expect(await qualified('company_id', ids.company)).toBe(true);
    expect(await qualified('technician_id', ids.tech)).toBe(true);

    // وبعد ما نشيل نطاق الشركة، نفس الشرط بيقول لأ — والفني ما بيتأثرش.
    await scope.removeService(ids.adminUser, company(), ids.service);
    expect(await qualified('company_id', ids.company)).toBe(false);
    expect(await qualified('technician_id', ids.tech)).toBe(true);
  });

  it('القاعدة بترفض صف بمالكين أو بلا مالك (chk_*_owner)', async () => {
    await expect(
      q(`INSERT INTO technician_services (technician_id, company_id, service_id) VALUES ($1,$2,$3)`, [
        ids.tech, ids.company, ids.service,
      ]),
    ).rejects.toThrow(/chk_technician_services_owner/);

    await expect(
      q(`INSERT INTO technician_zones (technician_id, company_id, service_zone_id) VALUES (NULL, NULL, $1)`, [ids.zone]),
    ).rejects.toThrow(/chk_technician_zones_owner/);
  });

  it('الشركة اللي مش موجودة أو متوقفة بتترفض بوضوح', async () => {
    await expect(
      scope.assignService(ids.adminUser, { kind: 'company', id: '00000000-0000-4000-8000-00000000dead' }, ids.service),
    ).rejects.toThrow(/الشركة غير موجودة/);
  });
});
