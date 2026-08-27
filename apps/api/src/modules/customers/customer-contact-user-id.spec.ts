import { DataSource } from 'typeorm';
import { CustomerProfilesService } from './customer-profiles.service';

/**
 * docs/08 §77-A1 — **بلاغ مالك**: «لما تيجي تدوس على اسم الكاستمر بيدوسك على صفحة بتجيب error…
 * الصفحة بيقولك غير موجودة».
 *
 * السبب الجذري مش في الواجهة: `orders.customer_id` بيشاور على **`customer_profiles(id)`** مش
 * على `users(id)` (infra/migrations/0007_orders.sql:25). ولوحة الأدمن كانت بتبني اللينك
 * `/customers/${order.customer_id}`، وصفحة العميل بتنادي `GET /admin/customers/:userId` اللي
 * بياخد **user id**. يعني اللينك كان مكسور **دايمًا** — مش أحيانًا، ومش حالة حدّية.
 *
 * الاختبار ده بيقفل الباب على تكرار الخلط: بيتأكد إن الخدمة بترجّع الـuser id الحقيقي، وإنه
 * **مختلف عن** مُعرّف البروفايل. الجملة التانية هي اللي بتمسك البَقّة — لو حد يوم رجّع
 * البروفايل مكان الـuser، `notToBe` هيفشل حتى لو الحقل موجود بالاسم الصح.
 */
describe('CustomerProfilesService.findContactInfoOrThrow — بيرجّع user id مش profile id', () => {
  let dataSource: DataSource;
  let service: CustomerProfilesService;
  const runId = Date.now().toString(36).toUpperCase();
  const ids = { userId: '', profileId: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
    service = Object.create(CustomerProfilesService.prototype) as CustomerProfilesService;
    Object.assign(service, { dataSource });

    const [u] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2036${runId}`.slice(0, 15), `عميل لينك ${runId}`],
    );
    ids.userId = u.id;
    const [cp] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.userId]);
    ids.profileId = cp.id;
  });

  afterAll(async () => {
    if (ids.profileId) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.profileId]);
    if (ids.userId) await q(`DELETE FROM users WHERE id = $1`, [ids.userId]);
    await dataSource.destroy();
  });

  it('بيرجّع الاسم والتليفون و**user id** الحقيقي', async () => {
    const contact = await service.findContactInfoOrThrow(ids.profileId);
    expect(contact.name).toBe(`عميل لينك ${runId}`);
    expect(contact.userId).toBe(ids.userId);
  });

  it('الـuser id **مش** هو مُعرّف البروفايل — ده جوهر البَقّة', async () => {
    const contact = await service.findContactInfoOrThrow(ids.profileId);
    expect(contact.userId).not.toBe(ids.profileId);
  });

  it('عميل ممسوح (soft-deleted): بيرمي 404 بدل ما يرجّع بيانات', async () => {
    await q(`UPDATE customer_profiles SET deleted_at = now() WHERE id = $1`, [ids.profileId]);
    try {
      await expect(service.findContactInfoOrThrow(ids.profileId)).rejects.toThrow();
    } finally {
      await q(`UPDATE customer_profiles SET deleted_at = NULL WHERE id = $1`, [ids.profileId]);
    }
  });
});
