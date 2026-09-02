import { DataSource } from 'typeorm';
import { AdminCampaignsService } from './admin-campaigns.service';
import { CustomerServiceIntent } from './entities/customer-service-intent.entity';
import { NotificationCampaign } from './entities/notification-campaign.entity';
import { AuditLogService } from '../audit/audit-log.service';

// "عملاء متروكين" لمركز الاتصال (docs/08 §79، طلب مالك صريح: "ما تفوّتش عميل واحد حتى") —
// اختبار حي على Postgres حقيقي عشان استعلام SQL الخام نفسه (فيه كل منطق الاستبعاد) يتفحص فعليًا،
// مش منطق TypeScript فوقه بس. الفرق الحرج المقصود عن sweepAbandonedIntents() (محرك الحملات
// نفسه): القايمة دي **ما بتستبعدش** marketing_opt_out=true — اختبار مخصوص ليه تحت.
describe('AdminCampaignsService.listAbandonedLeads() — عملاء متروكين (docs/08 §79)', () => {
  let dataSource: DataSource;
  let service: AdminCampaignsService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    address: '',
  };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  async function insertCustomer(label: string, opts?: { blocked?: boolean; deleted?: boolean; optedOut?: boolean }): Promise<{
    userId: string;
    profileId: string;
    phone: string;
  }> {
    // runId لازم يفضل كامل عشان تنظيف afterAll يلاقي الصفوف — الاسم الطويل بيتقص هو، مش runId.
    const phone = `+2018${runId}${label}`.slice(0, 15);
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, is_blocked, deleted_at)
       VALUES ($1,$2,'customer',$3,$4) RETURNING id`,
      [phone, `عميل متروك ${label}`, opts?.blocked ?? false, opts?.deleted ? new Date() : null],
    );
    const [profile] = await q(
      `INSERT INTO customer_profiles (user_id, marketing_opt_out) VALUES ($1,$2) RETURNING id`,
      [user.id, opts?.optedOut ?? false],
    );
    return { userId: user.id, profileId: profile.id, phone };
  }

  async function insertIntent(userId: string, serviceId: string, occurredAt: Date, processedAt: Date | null = null): Promise<string> {
    const [row] = await q(
      `INSERT INTO customer_service_intents (user_id, service_id, intent_stage, occurred_at, processed_at)
       VALUES ($1,$2,'viewed_service',$3,$4) RETURNING id`,
      [userId, serviceId, occurredAt, processedAt],
    );
    return row.id;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [NotificationCampaign, CustomerServiceIntent],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة متروكين ${runId}`, `Leads City ${runId}`, `leads-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق متروكين ${runId}`,
      `Leads Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة متروكين ${runId}`, `Leads Cat ${runId}`, `leads-cat-${runId}`],
    );
    ids.category = category.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, pricing_model, base_price_cents, is_active)
       VALUES ($1,$2,$3,$4,'formula',20000,true) RETURNING id`,
      [ids.category, `خدمة متروكين ${runId}`, `Leads Svc ${runId}`, `leads-svc-${runId}`],
    );
    ids.service = svc.id;
    const [addressOwner] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2019${runId}`.slice(0, 15), `مالك عنوان الاختبار ${runId}`],
    );
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.2,30.05),4326)::geography) RETURNING id`,
      [addressOwner.id, ids.city, `شارع متروكين ${runId}`],
    );
    ids.address = address.id;

    service = new AdminCampaignsService(
      dataSource.getRepository(NotificationCampaign),
      dataSource,
      { record: async () => undefined } as unknown as AuditLogService,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM customer_service_intents WHERE service_id = $1`, [ids.service]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number = $1)`, [
        `TESTLEAD-${runId}`.slice(0, 24),
      ]);
      await q(`DELETE FROM orders WHERE order_number = $1`, [`TESTLEAD-${runId}`.slice(0, 24)]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(
        `DELETE FROM customer_profiles WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE $1 OR phone_number LIKE $2)`,
        [`+2018${runId}%`, `+2019${runId}%`],
      );
      await q(`DELETE FROM users WHERE phone_number LIKE $1 OR phone_number LIKE $2`, [`+2018${runId}%`, `+2019${runId}%`]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('عميل بصّ على خدمة ومكملش — بيظهر برقم تليفونه صح', async () => {
    const customer = await insertCustomer('basic');
    await insertIntent(customer.userId, ids.service, new Date());

    const { items } = await service.listAbandonedLeads(14, 1, 100);
    const found = items.find((i) => i.userId === customer.userId);
    expect(found).toBeDefined();
    expect(found?.customerPhone).toBe(customer.phone);
    expect(found?.serviceId).toBe(ids.service);
    expect(found?.reminderProcessed).toBe(false);
  });

  it('عميل حجز فعلاً الخدمة بعد ما بصّ عليها — بيتشال من القايمة', async () => {
    const customer = await insertCustomer('ordered');
    const [profile] = await q(`SELECT id FROM customer_profiles WHERE user_id = $1`, [customer.userId]);
    const occurredAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await insertIntent(customer.userId, ids.service, occurredAt);
    await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status, payment_status, total_amount_cents, created_at)
       VALUES ($1,$2,$3,$4,'searching_technician','unpaid',20000, now())`,
      [`TESTLEAD-${runId}`.slice(0, 24), profile.id, ids.service, ids.address],
    );

    const { items } = await service.listAbandonedLeads(14, 1, 100);
    expect(items.find((i) => i.userId === customer.userId)).toBeUndefined();
  });

  it('حساب محظور — بيتشال من القايمة', async () => {
    const customer = await insertCustomer('blocked', { blocked: true });
    await insertIntent(customer.userId, ids.service, new Date());

    const { items } = await service.listAbandonedLeads(14, 1, 100);
    expect(items.find((i) => i.userId === customer.userId)).toBeUndefined();
  });

  it('حساب متشال (soft-deleted) — بيتشال من القايمة', async () => {
    const customer = await insertCustomer('deleted', { deleted: true });
    await insertIntent(customer.userId, ids.service, new Date());

    const { items } = await service.listAbandonedLeads(14, 1, 100);
    expect(items.find((i) => i.userId === customer.userId)).toBeUndefined();
  });

  // الفرق الحرج المقصود عن محرك الحملات (campaigns.service.ts's sweepAbandonedIntents) — راجع
  // docs/08 §79: مكالمة كول سنتر مش إعلان تسويقي، رفض التسويق مش رفض للمساعدة البشرية.
  it('عميل رافض الإشعارات التسويقية (marketing_opt_out) — بيفضل ظاهر، عكس محرك الحملات عمداً', async () => {
    const customer = await insertCustomer('optedout', { optedOut: true });
    await insertIntent(customer.userId, ids.service, new Date());

    const { items } = await service.listAbandonedLeads(14, 1, 100);
    const found = items.find((i) => i.userId === customer.userId);
    expect(found).toBeDefined();
    expect(found?.customerPhone).toBe(customer.phone);
  });

  it('نافذة الأيام — اهتمام أقدم من الحد بيتشال', async () => {
    const customer = await insertCustomer('old');
    await insertIntent(customer.userId, ids.service, new Date(Date.now() - 20 * 24 * 60 * 60 * 1000));

    const { items } = await service.listAbandonedLeads(14, 1, 100);
    expect(items.find((i) => i.userId === customer.userId)).toBeUndefined();

    const { items: widerWindow } = await service.listAbandonedLeads(30, 1, 100);
    expect(widerWindow.find((i) => i.userId === customer.userId)).toBeDefined();
  });

  it('reminder_processed بيعكس processed_at صح', async () => {
    const customer = await insertCustomer('processed');
    await insertIntent(customer.userId, ids.service, new Date(), new Date());

    const { items } = await service.listAbandonedLeads(14, 1, 100);
    const found = items.find((i) => i.userId === customer.userId);
    expect(found?.reminderProcessed).toBe(true);
  });
});
