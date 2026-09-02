import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApiException } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { TechnicianService, TechnicianServiceVerificationStatus } from '../catalog/entities/technician-service.entity';
import { TechnicianCompany } from './entities/technician-company.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { AdminTechniciansService } from './admin-technicians.service';
import { TechniciansService } from './technicians.service';

// Script 4 §2-7 — تصريح مهارات ذاتي + موافقة أدمن: اختبار حي ضد Postgres حقيقي، بيثبت الدورة
// كاملة (تصريح → طابور مراجعة → اعتماد/رفض → أثر على أهلية المطابقة) بدون أي mock لقاعدة البيانات.
describe('تصريح مهارات ذاتي للفني + موافقة أدمن (Script 4 §2-7)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let techniciansService: TechniciansService;
  let adminService: AdminTechniciansService;
  const runId = Date.now().toString(36);
  const ids = { techUser: '', techProfile: '', adminUser: '', category: '', serviceA: '', serviceB: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, TechnicianProfile, TechnicianCompany, TechnicianService, Service, ServiceCategory],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [techUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2032${runId}`.slice(0, 15),
      `فني تصريح ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id,technician_code,verification_status) VALUES ($1,$2,'approved') RETURNING id`,
      [ids.techUser, `SD${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2033${runId}`.slice(0, 15),
      `أدمن تصريح ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تصريح ${runId}`,
      `Declare Category ${runId}`,
      `test-category-sd-${runId}`,
    ]);
    ids.category = category.id;
    const [serviceA] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',10000,20,0) RETURNING id`,
      [ids.category, `خدمة أ ${runId}`, `test-service-sd-a-${runId}`],
    );
    ids.serviceA = serviceA.id;
    const [serviceB] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',10000,20,0) RETURNING id`,
      [ids.category, `خدمة ب ${runId}`, `test-service-sd-b-${runId}`],
    );
    ids.serviceB = serviceB.id;

    const auditLog = { record: async () => undefined } as unknown as AuditLogService;
    techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      dataSource.getRepository(TechnicianService),
      dataSource.getRepository(Service),
      dataSource.getRepository(User),
      {} as never, // portfolioLinksService
      {} as never, // certificatesService
      auditLog,
      {} as never, // geoService
      {} as never, // settingsService
    );
    adminService = new AdminTechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never, // documentsRepo
      {} as never, // levelHistoryRepo
      {} as never, // technicianZonesRepo
      dataSource.getRepository(TechnicianService),
      dataSource.getRepository(Service),
      dataSource.getRepository(User),
      new EventEmitter2(),
      auditLog,
      {} as never, // geoService
      // ADR-0045 §5 — الاعتماد بيسأل عن `technicians.require_national_id_for_approval`.
      { getBoolean: async (_k: string, fallback: boolean) => fallback } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
      await q(`DELETE FROM technician_services WHERE technician_id=$1`, [ids.techProfile]);
      await q(`DELETE FROM services WHERE id IN ($1,$2)`, [ids.serviceA, ids.serviceB]);
      await q(`DELETE FROM service_categories WHERE id=$1`, [ids.category]);
      await q(`DELETE FROM technician_profiles WHERE id=$1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.techUser, ids.adminUser]);
    } finally {
      await dataSource.destroy();
    }
  });

  async function isEligibleForMatching(serviceId: string): Promise<boolean> {
    // نفس شرط الأهلية بالحرف من matching.service.ts (ts.is_active=true AND verification_status='approved')
    const [row] = await dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM technician_services
         WHERE technician_id = $1 AND service_id = $2 AND is_active = true AND verification_status = 'approved'
       ) AS eligible`,
      [ids.techProfile, serviceId],
    );
    return row.eligible as boolean;
  }

  it('التصريح الذاتي بيدخل pending_verification مش أهلية فورية', async () => {
    const row = await techniciansService.declareService(ids.techUser, { service_id: ids.serviceA });
    expect(row.verificationStatus).toBe(TechnicianServiceVerificationStatus.PENDING_VERIFICATION);
    expect(row.isActive).toBe(false);
    expect(row.isSelfDeclared).toBe(true);
    expect(await isEligibleForMatching(ids.serviceA)).toBe(false);
  });

  it('تصريح مكرر لنفس الخدمة وهي لسه pending يترفض بـ409', async () => {
    expect.assertions(1);
    try {
      await techniciansService.declareService(ids.techUser, { service_id: ids.serviceA });
    } catch (err) {
      expect((err as ApiException).getStatus()).toBe(409);
    }
  });

  it('طابور المراجعة بيشوف التصريح الجديد', async () => {
    const pending = await adminService.listPendingServiceDeclarations();
    expect(pending.some((row) => row.technicianId === ids.techProfile && row.serviceId === ids.serviceA)).toBe(true);
  });

  // نسخة apps/admin (اسم الفني/الخدمة محلولين بـjoin واحد، مش UUIDs خام) — واجهة الأدمن الحقيقية
  // مش قابلة لاختبار حي كامل عبر curl في البيئة دي (بوابة WebAuthn MFA على تسجيل دخول الأدمن نفسه
  // مش شيء يتحقق منه بـcurl)، فده الاختبار الحقيقي البديل المتناسب لنفس الـSQL اللي الصفحة هتستخدمه.
  it('نسخة apps/admin الغنية بالأسماء بترجع كود واسم الفني + اسم الخدمة صح', async () => {
    const enriched = await adminService.listPendingServiceDeclarationsWithNames();
    const match = enriched.find((item) => item.row.technicianId === ids.techProfile && item.row.serviceId === ids.serviceA);
    expect(match).toBeDefined();
    expect(match!.technicianCode).toBe(`SD${runId}`.slice(0, 20));
    expect(match!.serviceNameAr).toBe(`خدمة أ ${runId}`);
    expect(match!.technicianFullName).toBe(`فني تصريح ${runId}`);
  });

  it('اعتماد الأدمن بيفعّل الأهلية فورًا في نفس جدول المطابقة', async () => {
    const declared = await techniciansService.listMyServices(ids.techUser);
    const target = declared.find((row) => row.serviceId === ids.serviceA)!;

    const approved = await adminService.approveServiceDeclaration(ids.adminUser, target.id, {});
    expect(approved.verificationStatus).toBe(TechnicianServiceVerificationStatus.APPROVED);
    expect(approved.isActive).toBe(true);
    expect(approved.reviewedByUserId).toBe(ids.adminUser);
    expect(await isEligibleForMatching(ids.serviceA)).toBe(true);
  });

  it('رفض تصريح جديد بسبب — مايفعّلش الأهلية، وإعادة التصريح بعد الرفض ترجع pending', async () => {
    const declared = await techniciansService.declareService(ids.techUser, { service_id: ids.serviceB });
    const rejected = await adminService.rejectServiceDeclaration(ids.adminUser, declared.id, 'مستنداته ناقصة وقت المراجعة');
    expect(rejected.verificationStatus).toBe(TechnicianServiceVerificationStatus.REJECTED);
    expect(rejected.rejectionReason).toBe('مستنداته ناقصة وقت المراجعة');
    expect(await isEligibleForMatching(ids.serviceB)).toBe(false);

    // إعادة الرفض تاني (مش pending) لازم ترفض — قرار نهائي قائم مش قابل لإعادة الرفض المباشر
    let secondRejectStatus: number | null = null;
    try {
      await adminService.rejectServiceDeclaration(ids.adminUser, declared.id, 'رفض تاني على نفس الصف');
    } catch (err) {
      secondRejectStatus = (err as ApiException).getStatus();
    }
    expect(secondRejectStatus).toBe(409);

    const redeclared = await techniciansService.declareService(ids.techUser, { service_id: ids.serviceB });
    expect(redeclared.id).toBe(declared.id); // نفس الصف بيترقّى، مش تكرار
    expect(redeclared.verificationStatus).toBe(TechnicianServiceVerificationStatus.PENDING_VERIFICATION);
    expect(redeclared.rejectionReason).toBeNull();
  });

  it('توقيف خدمة معتمدة بيشيلها من أهلية المطابقة فورًا (مش تعديل تاريخي)', async () => {
    const suspended = await adminService.suspendServiceDeclaration(ids.adminUser, (await techniciansService.listMyServices(ids.techUser)).find((r) => r.serviceId === ids.serviceA)!.id, 'شكوى جودة متكررة');
    expect(suspended.verificationStatus).toBe(TechnicianServiceVerificationStatus.SUSPENDED);
    expect(await isEligibleForMatching(ids.serviceA)).toBe(false);

    // الأدمن يقدر يعتمد تاني من suspended (مش قرار نهائي زي rejected)
    const reapproved = await adminService.approveServiceDeclaration(ids.adminUser, suspended.id, {});
    expect(reapproved.verificationStatus).toBe(TechnicianServiceVerificationStatus.APPROVED);
    expect(await isEligibleForMatching(ids.serviceA)).toBe(true);
  });

  it('سحب الفني لتصريح معتمد بيعطّله بس مايمسحوش (تاريخ الاعتماد يفضل موجود)', async () => {
    const before = await techniciansService.listMyServices(ids.techUser);
    const approvedRow = before.find((r) => r.serviceId === ids.serviceA)!;
    await techniciansService.withdrawService(ids.techUser, approvedRow.id);

    const after = await techniciansService.listMyServices(ids.techUser);
    const stillThere = after.find((r) => r.id === approvedRow.id);
    expect(stillThere).toBeDefined();
    expect(stillThere!.isActive).toBe(false);
    expect(stillThere!.verificationStatus).toBe(TechnicianServiceVerificationStatus.APPROVED);
    expect(await isEligibleForMatching(ids.serviceA)).toBe(false);
  });

  it('فني تاني مايقدرش يسحب/يشوف تصريح فني غير نفسه (IDOR)', async () => {
    const [otherUser] = await dataSource.query(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2034${runId}`.slice(0, 15), `فني تاني ${runId}`],
    );
    const [otherProfile] = await dataSource.query(
      `INSERT INTO technician_profiles (user_id,technician_code,verification_status) VALUES ($1,$2,'approved') RETURNING id`,
      [otherUser.id, `SD2${runId}`.slice(0, 20)],
    );
    try {
      const target = (await techniciansService.listMyServices(ids.techUser)).find((r) => r.serviceId === ids.serviceB)!;
      let withdrawStatus: number | null = null;
      try {
        await techniciansService.withdrawService(otherUser.id, target.id);
      } catch (err) {
        withdrawStatus = (err as ApiException).getStatus();
      }
      expect(withdrawStatus).toBe(404);
    } finally {
      await dataSource.query(`DELETE FROM technician_profiles WHERE id=$1`, [otherProfile.id]);
      await dataSource.query(`DELETE FROM users WHERE id=$1`, [otherUser.id]);
    }
  });
});
