import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { PromoCodesService, PromoApplicationContext } from './promo-codes.service';
import { DiscountType, PromoCode } from './entities/promo-code.entity';
import { PromoCodeUsage } from './entities/promo-code-usage.entity';

// اختبار حي ضد Postgres حقيقي — §24 (تدقيق الاكتمال الداخلي): كانت فجوة موثّقة صراحة —
// promo_codes.used_count/spent_cents بيتزودوا وقت الاستخدام (validateAndApply) بس مفيش أي
// decrement/release في أي مسار إلغاء طلب بالكامل، فكود محدود الاستخدام كان ممكن "يخلص" بسبب
// طلبات اتلغت قبل أي خدمة فعلية. الاختبار ده بيثبت releaseUsage() نفسها (المنطق المالي الدقيق)،
// والتكامل مع مسارات الإلغاء الأربعة (OrdersService.cancel/technicianCancel غير المطبّق هنا،
// OrderAutoCancelService، AdminOrdersService) اتأكد بمراجعة الكود المباشرة — استدعاء سطر واحد
// جوّه نفس transaction الإلغاء الموجودة ومختبرة بالفعل في specs تانية.
describe('PromoCodesService.releaseUsage() — ترجيع استخدام كود الخصم بعد إلغاء الطلب (docs/08 §24)', () => {
  let dataSource: DataSource;
  let service: PromoCodesService;
  const runId = Date.now().toString(36);
  const ids = { user: '', service: '', zone: '', address: '', customerProfile: '' };

  async function insertPromoCode(suffix: string) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [row] = await q(
      `INSERT INTO promo_codes (code, name_ar, discount_type, discount_value, usage_limit_total, usage_limit_per_user, valid_from, valid_until, created_by_user_id)
       VALUES ($1,$2,$3,$4,5,10, now() - interval '1 day', now() + interval '30 day', $5) RETURNING id, code`,
      [`RELTEST${runId}${suffix}`.slice(0, 24).toUpperCase(), `كود اختبار ترجيع ${runId}`, DiscountType.FIXED_AMOUNT, '20', ids.user],
    );
    return { id: row.id as string, code: row.code as string };
  }

  async function insertOrder(label: string) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, placed_at)
       VALUES ($1,$2,$3,$4,$5,'searching_technician','unpaid',10000,0, now()) RETURNING id`,
      [`TESTREL-${label}-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    return order.id as string;
  }

  const ctxFor = (): PromoApplicationContext => ({
    serviceId: ids.service,
    zoneId: ids.zone,
    totalBeforeDiscountCents: 10000,
    inspectionFeeCents: 0,
    isNewCustomer: false,
  });

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [PromoCode, PromoCodeUsage],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      country.id,
      `مدينة اختبار ${runId}`,
      `Test City ${runId}`,
      `test-city-rel-${runId}`,
    ]);
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      city.id,
      `نطاق اختبار ${runId}`,
      `Test Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اختبار ${runId}`,
      `Test Category ${runId}`,
      `test-category-rel-${runId}`,
    ]);
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [category.id, `خدمة اختبار ${runId}`, `test-service-rel-${runId}`],
    );
    ids.service = serviceRow.id;
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2018${runId}`.slice(0, 15),
      `عميل اختبار ترجيع ${runId}`,
    ]);
    ids.user = user.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.user]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.user, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    service = new PromoCodesService(
      dataSource.getRepository(PromoCode),
      dataSource.getRepository(PromoCodeUsage),
      { record: async () => undefined } as unknown as AuditLogService,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM promo_code_usages WHERE user_id = $1`, [ids.user]);
    await q(`DELETE FROM promo_codes WHERE created_by_user_id = $1`, [ids.user]);
    await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE name_ar LIKE $1`, [`%${runId}%`]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE name_ar LIKE $1`, [`%${runId}%`]);
    await q(`DELETE FROM countries WHERE name_ar LIKE $1`, [`%${runId}%`]);
    await dataSource.destroy();
  });

  it('استخدام الكود بيزوّد used_count/spent_cents، والإلغاء بيرجعهم بالظبط لنفس القيمة قبل الاستخدام', async () => {
    const { id: promoCodeId, code } = await insertPromoCode('A');
    const orderId = await insertOrder('a');

    await dataSource.transaction(async (manager) => {
      await service.validateAndApply(manager, code, ids.user, orderId, ctxFor());
    });

    const [afterUse] = await dataSource.query(`SELECT used_count, spent_cents FROM promo_codes WHERE id = $1`, [promoCodeId]);
    expect(afterUse.used_count).toBe(1);
    expect(afterUse.spent_cents).toBe(2000); // FIXED_AMOUNT discount_value=20 جنيه = 2000 قرش

    await dataSource.transaction(async (manager) => {
      await service.releaseUsage(manager, orderId);
    });

    const [afterRelease] = await dataSource.query(`SELECT used_count, spent_cents FROM promo_codes WHERE id = $1`, [promoCodeId]);
    expect(afterRelease.used_count).toBe(0);
    expect(afterRelease.spent_cents).toBe(0);

    const [usageRow] = await dataSource.query(`SELECT released_at FROM promo_code_usages WHERE order_id = $1`, [orderId]);
    expect(usageRow.released_at).not.toBeNull();
  });

  it('استدعاء releaseUsage() مرتين على نفس الطلب — الترجيع بيحصل مرة واحدة بس (idempotent، مفيش رصيد سالب)', async () => {
    const { id: promoCodeId, code } = await insertPromoCode('B');
    const orderId = await insertOrder('b');

    await dataSource.transaction(async (manager) => {
      await service.validateAndApply(manager, code, ids.user, orderId, ctxFor());
    });

    await dataSource.transaction(async (manager) => {
      await service.releaseUsage(manager, orderId);
    });
    await dataSource.transaction(async (manager) => {
      await service.releaseUsage(manager, orderId); // نداء تاني — لازم يبقى no-op آمن
    });

    const [row] = await dataSource.query(`SELECT used_count, spent_cents FROM promo_codes WHERE id = $1`, [promoCodeId]);
    expect(row.used_count).toBe(0); // مش -1
    expect(row.spent_cents).toBe(0); // مش سالب
  });

  it('طلب ماستخدمش أي كود خصم — releaseUsage() بترجع من غير أي أثر (no-op آمن)', async () => {
    const orderId = await insertOrder('c');
    await expect(dataSource.transaction(async (manager) => service.releaseUsage(manager, orderId))).resolves.toBeUndefined();
  });
});
