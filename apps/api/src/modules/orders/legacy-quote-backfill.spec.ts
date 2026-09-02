import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

/**
 * **migration 0250** — الطلبات اللي كانت واقفة على `awaiting_initial_quote_approval` قبل 0247
 * مالهاش صف في `order_quotes` (الجدول اتعمل في 0247 نفسها)، فالعميل كان **مستحيل** يوافق عليها:
 * `approveInitialQuote()` بتدوّر على أحدث صف وبترمي «مفيش سعر بعد معاينة مستني الموافقة».
 *
 * الاختبار بينفّذ **ملف الـmigration نفسه** مش نسخة من الـSQL بتاعه — لو الملف اتغيّر، الاختبار
 * بيختبر التغيير مش نص قديم متكرر.
 */
describe('migration 0250 — backfill عروض السعر القديمة', () => {
  jest.setTimeout(45_000);

  let dataSource: DataSource;
  const runId = Date.now().toString(36);
  const ids = {
    city: '', zone: '', category: '', service: '',
    customerUser: '', customerProfile: '', address: '',
    techUser: '', tech: '',
    orderWithPrice: '', orderWithoutTechnician: '',
  };
  const LEGACY_PRICE_CENTS = 27_500;

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  async function seedLegacyOrder(technicianId: string | null, priceCents: number): Promise<string> {
    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    const [row] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
                            order_type, booking_mode, order_status, scheduled_at, total_amount_cents,
                            estimated_price_cents, payment_status, placed_at, source_channel)
       VALUES ($1,$2,$3,$4,$5,$6,'standard','individual','awaiting_initial_quote_approval', now() + interval '5 days',
               0,$7,'unpaid', now(), 'customer_app') RETURNING id`,
      [orderNumber, ids.customerProfile, technicianId, ids.service, ids.address, ids.zone, priceCents],
    );
    return row.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      country.id, `مدينة ترحيل ${runId}`, `Backfill City ${runId}`, `backfill-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `منطقة ترحيل ${runId}`, `Backfill Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة ترحيل ${runId}`, `Backfill Cat ${runId}`, `backfill-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, quote_validity_minutes)
       VALUES ($1,$2,$3,'formula',1000,2880) RETURNING id`,
      [ids.category, `خدمة ترحيل ${runId}`, `backfill-svc-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2101${runId}`.slice(0, 15), `عميل ترحيل ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع ترحيل ${runId}`],
    );
    ids.address = address.id;
    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2102${runId}`.slice(0, 15), `فني ترحيل ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [tech] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, verification_status, current_level)
       VALUES ($1,$2,'x','approved','professional') RETURNING id`,
      [ids.techUser, `BKF${runId}`.slice(0, 20)],
    );
    ids.tech = tech.id;

    ids.orderWithPrice = await seedLegacyOrder(ids.tech, LEGACY_PRICE_CENTS);
    // طلب بلا فني معروف — مفيش `submitted_by_user_id` صادق نكتبه، فالمفروض يتساب.
    ids.orderWithoutTechnician = await seedLegacyOrder(null, LEGACY_PRICE_CENTS);

    const migrationSql = readFileSync(
      join(__dirname, '../../../../../infra/migrations/0250_backfill_legacy_initial_quotes.sql'),
      'utf8',
    );
    await q(migrationSql);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const orders = [ids.orderWithPrice, ids.orderWithoutTechnician].filter(Boolean);
    await q(`DELETE FROM order_quotes WHERE order_id = ANY($1::uuid[])`, [orders]);
    await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [orders]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.tech]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.customerUser, ids.techUser]]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('طلب قديم بسعر وفني معروف: بقى له عرض سعر إصدار 1 مستني موافقة العميل بنفس القيمة', async () => {
    const [quote] = await q(
      `SELECT version, source, status, amount_cents, submitted_by_user_id, valid_until
         FROM order_quotes WHERE order_id = $1`,
      [ids.orderWithPrice],
    );
    expect(quote).toBeDefined();
    expect(quote.version).toBe(1);
    expect(quote.status).toBe('pending_customer');
    expect(quote.source).toBe('technician_onsite');
    expect(quote.amount_cents).toBe(LEGACY_PRICE_CENTS);
    expect(quote.submitted_by_user_id).toBe(ids.techUser);
    // الصلاحية لازم تكون في المستقبل — وإلا العميل هيلاقي عرض «منتهي» لحظة الترقية.
    expect(new Date(quote.valid_until).getTime()).toBeGreaterThan(Date.now());
  });

  it('طلب قديم بلا فني معروف: بيتساب صراحة، مش بيتخترعله سعر ولا مستخدم', async () => {
    const rows = await q(`SELECT 1 FROM order_quotes WHERE order_id = $1`, [ids.orderWithoutTechnician]);
    expect(rows).toHaveLength(0);
  });

  it('تكرار الترحيل مابيعملش إصدار تاني (NOT EXISTS هو الحارس)', async () => {
    const migrationSql = readFileSync(
      join(__dirname, '../../../../../infra/migrations/0250_backfill_legacy_initial_quotes.sql'),
      'utf8',
    );
    await q(migrationSql);
    const rows = await q(`SELECT version FROM order_quotes WHERE order_id = $1`, [ids.orderWithPrice]);
    expect(rows).toHaveLength(1);
  });
});
