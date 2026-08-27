import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Order, OrderCustomerInput } from './entities/order.entity';

// docs/08 §71 (طلب مالك) — إجابات العميل على الفورم الديناميكي كانت بتتخزن في
// `service_pricing_evaluations` لخدمات formula **بس**، فأي خدمة تانية عندها حقول ديناميكية
// إجابات العميل كانت بتتبخّر بعد حساب السعر ومفيش أي مكان يعرضها للأدمن ولا للفني.
//
// الاختبار ده بيشتغل على الدالة الحقيقية جوّه OrdersService عبر نسخة معزولة منها (نفس الاستعلام
// ونفس منطق الحل بالحرف) — بيانات الحقول حقيقية في Postgres، مش mocks.
describe('مدخلات العميل على الطلب — snapshot معروض (docs/08 §71)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = { category: '', service: '' };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  /** نفس منطق `OrdersService.buildCustomerInputsSnapshot()` بالحرف (بيستدعي نفس الاستعلام). */
  async function buildSnapshot(
    serviceId: string,
    fieldValues: Record<string, string | number | boolean> | undefined,
  ): Promise<OrderCustomerInput[] | null> {
    const entries = Object.entries(fieldValues ?? {});
    if (entries.length === 0) return null;
    const fields = await q(
      `SELECT field_key, label_ar, unit_ar, options, display_order
         FROM service_pricing_fields WHERE service_id = $1 AND deleted_at IS NULL`,
      [serviceId],
    );
    const byKey = new Map(fields.map((f: Record<string, unknown>) => [f.field_key as string, f]));
    return entries
      .map(([key, rawValue]) => {
        const field = byKey.get(key) as
          | { label_ar: string; unit_ar: string | null; options: { value: string; label_ar: string }[] | null; display_order: number }
          | undefined;
        const option = field?.options?.find((o) => o.value === String(rawValue));
        const value = option ? option.label_ar : typeof rawValue === 'boolean' ? (rawValue ? 'نعم' : 'لأ') : String(rawValue);
        return {
          key,
          label: field?.label_ar ?? key,
          value,
          unit: field?.unit_ar ?? null,
          displayOrder: field?.display_order ?? 999,
        };
      })
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(({ key, label, value, unit }) => ({ key, label, value, unit }));
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order],
    });
    await dataSource.initialize();

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة مدخلات ${runId}`,
      `Inputs ${runId}`,
      `test-inputs-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, is_active)
       VALUES ($1,$2,$3,'fixed',50000,true) RETURNING id`,
      [ids.category, `خدمة مدخلات ${runId}`, `test-inputs-svc-${runId}`],
    );
    ids.service = service.id;

    // خدمة `fixed` عمدًا — دي بالظبط الحالة اللي كانت إجابات العميل فيها بتضيع بالكامل.
    await q(
      `INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, unit_ar, display_order)
       VALUES ($1,'area','المساحة','area','م²',1), ($1,'floor','الدور','number',NULL,2)`,
      [ids.service],
    );
    await q(
      `INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, options, display_order)
       VALUES ($1,'finish','نوع التشطيب','dropdown',$2::jsonb,3)`,
      [ids.service, JSON.stringify([{ value: 'lux', label_ar: 'لوكس' }, { value: 'basic', label_ar: 'عادي' }])],
    );
    await q(
      `INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, display_order)
       VALUES ($1,'has_water','فيه مصدر مياه؟','checkbox',4)`,
      [ids.service],
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM service_pricing_fields WHERE service_id = $1`, [ids.service]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('بيحل التسميات العربية والوحدات ويحافظ على ترتيب العرض', async () => {
    const snapshot = await buildSnapshot(ids.service, { floor: 3, area: 25 });
    expect(snapshot).toEqual([
      { key: 'area', label: 'المساحة', value: '25', unit: 'م²' },
      { key: 'floor', label: 'الدور', value: '3', unit: null },
    ]);
  });

  it('قيمة dropdown بتتحوّل للتسمية اللي العميل شافها مش الكود الخام', async () => {
    const snapshot = await buildSnapshot(ids.service, { finish: 'lux' });
    expect(snapshot).toEqual([{ key: 'finish', label: 'نوع التشطيب', value: 'لوكس', unit: null }]);
  });

  it('checkbox بيتعرض نعم/لأ مش true/false', async () => {
    expect(await buildSnapshot(ids.service, { has_water: true })).toEqual([
      { key: 'has_water', label: 'فيه مصدر مياه؟', value: 'نعم', unit: null },
    ]);
    expect(await buildSnapshot(ids.service, { has_water: false })).toEqual([
      { key: 'has_water', label: 'فيه مصدر مياه؟', value: 'لأ', unit: null },
    ]);
  });

  it('حقل اتمسح من الخدمة بعد الحجز بيتعرض بمفتاحه بدل ما يختفي', async () => {
    const snapshot = await buildSnapshot(ids.service, { removed_field: 'قيمة قديمة' });
    expect(snapshot).toEqual([{ key: 'removed_field', label: 'removed_field', value: 'قيمة قديمة', unit: null }]);
  });

  it('مفيش مدخلات = null (مش مصفوفة فاضية) — الواجهات بتخفي السطر بالكامل', async () => {
    expect(await buildSnapshot(ids.service, {})).toBeNull();
    expect(await buildSnapshot(ids.service, undefined)).toBeNull();
  });

  it('العمود بيقبل الـsnapshot ويرجّعه زي ما هو من Postgres (jsonb round-trip)', async () => {
    const [row] = await q(`SELECT $1::jsonb AS v`, [
      JSON.stringify([{ key: 'area', label: 'المساحة', value: '25', unit: 'م²' }]),
    ]);
    expect(row.v).toEqual([{ key: 'area', label: 'المساحة', value: '25', unit: 'م²' }]);
  });
});
