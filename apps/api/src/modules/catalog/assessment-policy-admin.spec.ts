import { DataSource } from 'typeorm';
import { AdminCatalogService } from './admin-catalog.service';
import { AuditLogService } from '../audit/audit-log.service';
import { Service, PriceCertaintyMode, AssessmentRoutePolicy, AssessmentFeeCreditMode } from './entities/service.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { ServicePricingTierPricing } from './entities/service-pricing-tier-pricing.entity';
import { TechnicianService } from './entities/technician-service.entity';
import { toAdminServiceResponseDto } from './dto/admin-catalog-response.dto';

/**
 * **ADR-0063/0066 — سياسة تحديد السعر والمعاينة وصلت الأدمن فعليًا.**
 *
 * الأعمدة الـ13 دي كانت في الداتابيز والكيان من migration 0247، وماكانتش في أي DTO ولا في رد
 * الأدمن — يعني الأدمن **مايقدرش يشغّل رحلة التقييم من الشاشة أصلاً**. نفس فئة البَقّة اللي
 * ADR-0064 §2 قفلها لحالات الطلب: العمود موجود والقدرة غير موجودة عمليًا.
 *
 * الاختبار بيغطي الكتابة والقراءة والتحقق من التركيبات المستحيلة — التحقق في الباك-إند مش في
 * الواجهة، عشان أي كولر (شاشة، سكربت، تطبيق) يتمنع بنفس القاعدة.
 */
describe('AdminCatalogService — سياسة تحديد السعر والمعاينة (ADR-0063/0066)', () => {
  jest.setTimeout(45_000);

  let dataSource: DataSource;
  let service: AdminCatalogService;
  const runId = Date.now().toString(36);
  const ids = { category: '', service: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon,
        ServiceStandardData, ServicePricingTierPricing, TechnicianService,
      ],
    });
    await dataSource.initialize();
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة سياسة ${runId}`, `Policy Cat ${runId}`, `policy-cat-${runId}`,
    ]);
    ids.category = category.id;

    service = new AdminCatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServicePricingTierPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      {} as never, // productivityActuals — بره نطاق الاختبار ده
      dataSource.getRepository(TechnicianService),
      {} as never, // techniciansService
      { record: async () => undefined } as unknown as AuditLogService,
      {} as never, // storage
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM services WHERE category_id = $1`, [ids.category]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('خدمة جديدة بلا سياسة: الافتراضيات الآمنة — سعر مؤكد وكل مسارات التقييم مقفولة', async () => {
    const created = await service.createService('admin-policy-spec', {
      category_id: ids.category,
      name_ar: `خدمة افتراضية ${runId}`,
      slug: `policy-default-${runId}`,
      pricing_model: 'formula',
      base_price_cents: 10_000,
    } as never);
    ids.service = created.id;

    const dto = toAdminServiceResponseDto(created);
    expect(dto.price_certainty_mode).toBe(PriceCertaintyMode.CONFIRMED_PRICE);
    expect(dto.remote_assessment_enabled).toBe(false);
    expect(dto.onsite_assessment_enabled).toBe(false);
    expect(dto.assessment_fee_credit_mode).toBe(AssessmentFeeCreditMode.NONE);
    expect(dto.quote_validity_minutes).toBeGreaterThan(0);
  });

  it('«تقييم بالصور» على خدمة معادلة بيترفض — مسار الصور مقصور على «كشف ثم عرض سعر» (docs/08 §131)', async () => {
    // البَقّة اللي الاختبار ده بيقفلها: الشرط ده كان موجود في `assessmentRouteRejection()` وقت
    // إنشاء الطلب بس، ومكانش موجود في طبقة الأدمن خالص. النتيجة إن الأدمن يحفظ خدمة `formula`
    // وعليها «تقييم بالصور — مفعّل»، والعميل مايشوفش المسار أصلاً — الزرار بلا أثر. وأسوأ
    // تركيبة (formula + assessment_required + remote_only) كانت بتطلّع خدمة مش قابلة للحجز
    // بأي مسار: الصور مرفوضة لأنها مش كشف-ثم-سعر، والمعاينة مرفوضة لأن السياسة «بالصور فقط».
    await expect(
      service.updateService('admin-policy-spec', ids.service, {
        price_certainty_mode: PriceCertaintyMode.ASSESSMENT_REQUIRED,
        remote_assessment_enabled: true,
        onsite_assessment_enabled: true,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });

    const [row] = await q(`SELECT pricing_model, remote_assessment_enabled FROM services WHERE id = $1`, [ids.service]);
    expect(row.pricing_model).toBe('formula');
    expect(row.remote_assessment_enabled).toBe(false);
  });

  it('تفعيل «محتاج تقييم» بالصور برسوم وخصم بنسبة: بيتحفظ وبيرجع في رد الأدمن كامل', async () => {
    const updated = await service.updateService('admin-policy-spec', ids.service, {
      // مسار الصور محتاج غياب السعر وقت الحجز — يعني `inspection_then_quote` (ADR-0060 §1).
      pricing_model: 'inspection_then_quote',
      price_certainty_mode: PriceCertaintyMode.ASSESSMENT_REQUIRED,
      assessment_route_policy: AssessmentRoutePolicy.REMOTE_ONLY,
      remote_assessment_enabled: true,
      remote_assessment_fee_cents: 5_000,
      assessment_fee_credit_mode: AssessmentFeeCreditMode.PERCENTAGE,
      assessment_fee_credit_bps: 5_000,
      quote_validity_minutes: 1_440,
    } as never);

    const dto = toAdminServiceResponseDto(updated);
    expect(dto.price_certainty_mode).toBe(PriceCertaintyMode.ASSESSMENT_REQUIRED);
    expect(dto.assessment_route_policy).toBe(AssessmentRoutePolicy.REMOTE_ONLY);
    expect(dto.remote_assessment_enabled).toBe(true);
    expect(dto.remote_assessment_fee_cents).toBe(5_000);
    expect(dto.assessment_fee_credit_mode).toBe(AssessmentFeeCreditMode.PERCENTAGE);
    expect(dto.assessment_fee_credit_bps).toBe(5_000);
    expect(dto.quote_validity_minutes).toBe(1_440);

    const [row] = await q(`SELECT price_certainty_mode, remote_assessment_fee_cents FROM services WHERE id = $1`, [ids.service]);
    expect(row.price_certainty_mode).toBe('assessment_required');
    expect(row.remote_assessment_fee_cents).toBe(5_000);
  });

  it('«محتاج تقييم» بمسارين مقفولين بيترفض — خدمة العميل مايقدرش يحجزها ولا يطلب تقييم لها', async () => {
    await expect(
      service.updateService('admin-policy-spec', ids.service, {
        price_certainty_mode: PriceCertaintyMode.ASSESSMENT_REQUIRED,
        assessment_route_policy: AssessmentRoutePolicy.ADMIN_TRIAGE,
        remote_assessment_enabled: false,
        onsite_assessment_enabled: false,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('«تقييم بالصور فقط» والصور مقفولة بيترفض برسالة تخص السياسة نفسها', async () => {
    await expect(
      service.updateService('admin-policy-spec', ids.service, {
        assessment_route_policy: AssessmentRoutePolicy.REMOTE_ONLY,
        remote_assessment_enabled: false,
        onsite_assessment_enabled: true,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('«نطاق تقديري» بلا حدود عرض بيترفض — النطاق ده غير حدود قصّ المعادلة', async () => {
    await expect(
      service.updateService('admin-policy-spec', ids.service, {
        price_certainty_mode: PriceCertaintyMode.ESTIMATED_RANGE,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });

    const ranged = await service.updateService('admin-policy-spec', ids.service, {
      price_certainty_mode: PriceCertaintyMode.ESTIMATED_RANGE,
      display_price_min_cents: 20_000,
      display_price_max_cents: 45_000,
      require_admin_review_above_range: true,
      max_quote_increase_without_admin_review_bps: 2_000,
    } as never);
    const dto = toAdminServiceResponseDto(ranged);
    expect(dto.display_price_min_cents).toBe(20_000);
    expect(dto.display_price_max_cents).toBe(45_000);
    expect(dto.require_admin_review_above_range).toBe(true);
    expect(dto.max_quote_increase_without_admin_review_bps).toBe(2_000);
  });

  it('حد أقصى أقل من الحد الأدنى بيترفض', async () => {
    await expect(
      service.updateService('admin-policy-spec', ids.service, {
        display_price_min_cents: 90_000,
        display_price_max_cents: 10_000,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });
});
