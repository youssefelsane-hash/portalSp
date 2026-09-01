import { DataSource } from 'typeorm';
import { PricingEngineService } from './pricing-engine.service';
import { PricingFieldsService } from './pricing-fields.service';
import { ServicePricingField } from './entities/service-pricing-field.entity';
import { ServicePricingRule } from './entities/service-pricing-rule.entity';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';

/**
 * ADR-0050 §6 — «الفلتر» على خدمة بلا سعر (طلب مالك صريح).
 *
 * «في شغلانات معينة هتنزل من غير أصلًا ما يتحط لها أسعار. هينزل بس إن هو يتحط فلتر للعميل أو
 * مكان يرفع فيه الصور بتاعت الحاجة البايظة، والمفروض إحنا نرد عليه بالسعر».
 *
 * **الاختبار ده على قاعدة بيانات حقيقية** — بيثبت إن نفس التحقق اللي خدمات `formula` بتاخده
 * بقى شغّال على خدمات «كشف ثم عرض سعر» كمان، **من غير ما يحسب سعر**. قبل كده الحقول دي كانت
 * بتتخزّن بلا أي فحص: حقل إجباري فاضي وقيمة برّه الخيارات كانوا بيعدّوا، والإدارة تسعّر على
 * بيانات ناقصة.
 */
describe('فورم الأسئلة على خدمة «كشف ثم عرض سعر» (ADR-0050 §6)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let engine: PricingEngineService;
  const runId = Date.now().toString(36).toUpperCase().slice(-6);
  const ids = { category: '', service: '' };
  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [ServicePricingField, ServicePricingRule, ServicePricingEvaluation],
    });
    await dataSource.initialize();

    const [cat] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`كشف ${runId}`, `insp ${runId}`, `insp-${runId.toLowerCase()}`],
    );
    ids.category = cat.id;
    // **الخدمة نازلة بلا سعر خالص** — base_price_cents = 0 ورسم كشف = 0.
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, base_price_cents, inspection_fee_cents, pricing_model)
       VALUES ($1,$2,$3,$4,0,0,'inspection_then_quote') RETURNING id`,
      [ids.category, `تصليح غسالة ${runId}`, `washer ${runId}`, `washer-${runId.toLowerCase()}`],
    );
    ids.service = svc.id;

    await q(
      `INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, is_required, options, display_order)
       VALUES ($1,'brand','ماركة الجهاز','dropdown',true,$2::jsonb,1)`,
      [ids.service, JSON.stringify([{ value: 'lg', label_ar: 'إل جي' }, { value: 'samsung', label_ar: 'سامسونج' }])],
    );
    await q(
      `INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, is_required, min_value, max_value, display_order)
       VALUES ($1,'age_years','عمر الجهاز بالسنين','number',false,0,40,2)`,
      [ids.service],
    );

    const fields = new PricingFieldsService(
      dataSource.getRepository(ServicePricingField),
      dataSource.getRepository(ServicePricingRule),
      { record: async () => undefined } as never,
    );
    engine = new PricingEngineService(
      dataSource.getRepository(ServicePricingEvaluation),
      fields,
      {} as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM service_pricing_fields WHERE service_id = $1`, [ids.service]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('إجابات صحيحة بتعدّي وبترجع منسّقة — بلا أي حساب سعر', async () => {
    const values = await engine.validateFieldValuesOnly(ids.service, { brand: 'lg', age_years: 6 });
    expect(values).toEqual({ brand: 'lg', age_years: 6 });
  });

  // **أهم تأكيد في الملف**: ده اللي مكانش بيتفحص خالص قبل ADR-0050 §6.
  it('حقل إجباري ناقص بيترفض باسمه العربي', async () => {
    await expect(engine.validateFieldValuesOnly(ids.service, { age_years: 3 })).rejects.toThrow(/ماركة الجهاز/);
  });

  it('قيمة برّه خيارات الحقل بترفض', async () => {
    await expect(engine.validateFieldValuesOnly(ids.service, { brand: 'toshiba' })).rejects.toThrow(
      /قيمة غير مسموحة/,
    );
  });

  it('رقم برّه المدى المسموح بيترفض', async () => {
    await expect(engine.validateFieldValuesOnly(ids.service, { brand: 'lg', age_years: 99 })).rejects.toThrow(
      /أعلى من الحد الأقصى/,
    );
  });

  it('حقل اختياري متلمسش مابيكسرش الحجز', async () => {
    const values = await engine.validateFieldValuesOnly(ids.service, { brand: 'samsung' });
    expect(values).toEqual({ brand: 'samsung' });
  });
});
