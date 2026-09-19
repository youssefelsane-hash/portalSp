import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AdminEarningsPolicyService } from './admin-earnings-policy.service';

/**
 * **جُمل SQL الخام لسياسة أجر المهارة — حي على Postgres** (docs/08 §172).
 *
 * المسارات دي كانت **بلا أي تغطية**، وهي كلها `dataSource.query()` بنصوص خام: `tsc` مابيشوفش
 * أسماء الأعمدة جوّاها، فأي إعادة تسمية بتعدّي البناء نضيفة وتقع وقت التشغيل. اتكشف فعلاً وقت
 * migration 0356 (`skill_level` → `wage_tier`): الاستعلامات اشتغلت، بس **مفتاح الرد اتغيّر**
 * من `skill_level` لـ`wage_tier` وكسر عقد الـAPI من غير ما أي اختبار يقع.
 *
 * السويت دي بتقفل الاتنين: الـSQL بيشتغل على الأعمدة الجديدة، **والرد بيفضل بالمفاتيح القديمة**.
 *
 * بتنادي الـservice مباشرةً مش عبر HTTP عن قصد: المسارات دي وراها حارس Passkey (ADR-0011)
 * مايتعملش في اختبار مؤتمت، والمقصود هنا هو الـSQL نفسه مش طبقة الصلاحيات.
 */
describe('AdminEarningsPolicyService — SQL سياسة أجر المهارة (docs/08 §172)', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let service: AdminEarningsPolicyService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { adminUserId: '', categoryId: '', serviceId: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
  /** عوامل الأجر الأصلية — بترجع مكانها في `afterAll` عشان السويت ماتسيبش أثر مالي. */
  const originalFactors = new Map<string, number>();

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();

    const [admin] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2099${runId}`.slice(0, 15), `أدمن أجر ${runId}`],
    );
    ids.adminUserId = admin.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة أجر ${runId}`, `WageCat ${runId}`, `wage-cat-${runId}`],
    );
    ids.categoryId = category.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.categoryId, `خدمة أجر ${runId}`, `wage-service-${runId}`],
    );
    ids.serviceId = svc.id;

    for (const row of (await q(`SELECT wage_tier, factor_bps FROM earnings_skill_policy`)) as {
      wage_tier: string;
      factor_bps: number;
    }[]) {
      originalFactors.set(row.wage_tier, Number(row.factor_bps));
    }

    const auditStub = { record: async () => undefined } as never;
    service = new AdminEarningsPolicyService(dataSource, auditStub);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM service_earnings_skill_overrides WHERE service_id = $1`, [ids.serviceId]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.serviceId]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.categoryId]);
    for (const [tier, factor] of originalFactors) {
      await q(`UPDATE earnings_skill_policy SET factor_bps = $2, updated_by_user_id = NULL WHERE wage_tier = $1`, [tier, factor]);
    }
    await q(`DELETE FROM users WHERE id = $1`, [ids.adminUserId]);
    await dataSource.destroy();
  });

  it('`overview()` بترجّع الدرجات التلاتة بمفتاح `skill_level` — عقد الـAPI بعد إعادة التسمية', async () => {
    const overview = await service.overview();
    const skills = overview.skills as { skill_level?: string; wage_tier?: string; factor_bps: number }[];
    expect(skills).toHaveLength(3);
    // الحارس الحقيقي: العمود اتسمّى `wage_tier` في القاعدة، والمفتاح على السلك لازم يفضل القديم.
    expect(skills.map((s) => s.skill_level).sort()).toEqual(['beginner', 'expert', 'standard']);
    expect(skills.every((s) => s.wage_tier === undefined)).toBe(true);
  });

  it('`updateSkill()` بتعدّل العامل فعلاً وبترجّع `skill_level` مش `wage_tier`', async () => {
    const updated = (await service.updateSkill(ids.adminUserId, 'expert', {
      factor_bps: 11_750,
      reason: 'اختبار حي لجملة UPDATE الخام',
    })) as Record<string, unknown>;
    expect(updated.skill_level).toBe('expert');
    expect(updated.wage_tier).toBeUndefined();
    expect(Number(updated.factor_bps)).toBe(11_750);

    const [row] = await q(`SELECT factor_bps FROM earnings_skill_policy WHERE wage_tier = 'expert'`);
    expect(Number(row.factor_bps)).toBe(11_750);
  });

  it('`updateSkill()` بترفض درجة مش موجودة في السلّم', async () => {
    await expect(
      service.updateSkill(ids.adminUserId, 'advanced', { factor_bps: 10_000, reason: 'درجة سعر مش درجة أجر' }),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('`upsertServiceSkillOverride()` بتضيف ثم تحدّث على نفس المفتاح (ON CONFLICT على العمود الجديد)', async () => {
    const created = (await service.upsertServiceSkillOverride(ids.adminUserId, ids.serviceId, 'standard', {
      factor_bps: 12_500,
      reason: 'إضافة',
    })) as Record<string, unknown>;
    expect(Number(created.factor_bps)).toBe(12_500);

    const updated = (await service.upsertServiceSkillOverride(ids.adminUserId, ids.serviceId, 'standard', {
      factor_bps: 13_000,
      reason: 'تحديث نفس الصف مش صف جديد',
    })) as Record<string, unknown>;
    expect(Number(updated.factor_bps)).toBe(13_000);
    expect(updated.id).toBe(created.id);

    const rows = await q(`SELECT wage_tier, factor_bps FROM service_earnings_skill_overrides WHERE service_id = $1`, [
      ids.serviceId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].wage_tier).toBe('standard');
  });

  it('واستثناء الخدمة بيظهر في `overview()` بمفتاح `skill_level` كمان', async () => {
    const overview = await service.overview();
    const overrides = overview.service_skill_overrides as { service_id: string; skill_level?: string; wage_tier?: string }[];
    const mine = overrides.find((o) => o.service_id === ids.serviceId);
    expect(mine?.skill_level).toBe('standard');
    expect(mine?.wage_tier).toBeUndefined();
  });
});
