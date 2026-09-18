import { insertTestCountry } from './insert-test-country';

/**
 * الهيلبر ده هو اللي بيمنع فشل عشوائي في تمن سبيكة حيّة (تصادم `countries.iso_code`)، فلازم
 * يبقى هو نفسه مختبر — أداة بتمنع فشل وهي نفسها ممكن تفشل بصمت = أسوأ من غيابها.
 *
 * الاختبار هنا **بلا قاعدة**: بنمرّر `q` مزيّفة بتحاكي الـUNIQUE بالظبط، فبنمتحن المنطق
 * (تجنّب المستخدم + إعادة المحاولة على السباق + الاستسلام برسالة مفهومة) مش الداتابيز.
 */
describe('insertTestCountry — كود ISO فاضي مضمون', () => {
  /** `q` مزيّفة: مجموعة أكواد محجوزة، وأي إدخال لكود محجوز بيرمي زي Postgres. */
  function fakeQuery(taken: Set<string>, opts: { failFirstNAsRace?: number } = {}) {
    let races = opts.failFirstNAsRace ?? 0;
    const inserted: string[] = [];
    const q = (async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT iso_code')) return [...taken].map((iso_code) => ({ iso_code }));
      const isoCode = params![2] as string;
      if (races > 0) {
        races -= 1;
        throw new Error('duplicate key value violates unique constraint "countries_iso_code_key"');
      }
      if (taken.has(isoCode)) {
        throw new Error('duplicate key value violates unique constraint "countries_iso_code_key"');
      }
      inserted.push(isoCode);
      return [{ id: `country-${isoCode}` }];
    }) as <T>(sql: string, params?: unknown[]) => Promise<T>;
    return { q, inserted };
  }

  it('بيختار كود مش مستخدم ويرجّع معرّف الدولة', async () => {
    const { q, inserted } = fakeQuery(new Set(['EG', 'SA']));
    const country = await insertTestCountry(q, { nameAr: 'دولة', nameEn: 'Country' });
    expect(country.id).toBe(`country-${country.isoCode}`);
    expect(['EG', 'SA']).not.toContain(country.isoCode);
    expect(inserted).toEqual([country.isoCode]);
  });

  it('سباق بين القراءة والإدخال: بيعيد المحاولة بكود تاني بدل ما يفشل', async () => {
    // أول محاولتين بيرجعوا خطأ التفرّد كأن سبيكة تانية سبقتنا بين القراءة والإدخال.
    const { q, inserted } = fakeQuery(new Set(['EG']), { failFirstNAsRace: 2 });
    const country = await insertTestCountry(q, { nameAr: 'دولة', nameEn: 'Country' });
    expect(country.isoCode).toBeDefined();
    expect(inserted).toHaveLength(1);
  });

  it('لما مفيش كود فاضي خالص: رسالة مفهومة بتقول اعمل إيه، مش duplicate key غامض', async () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const everyCode = new Set<string>();
    for (const a of alphabet) for (const b of alphabet) everyCode.add(a + b);
    const { q } = fakeQuery(everyCode);
    await expect(insertTestCountry(q, { nameAr: 'دولة', nameEn: 'Country' })).rejects.toThrow(
      /مافيش كود ISO فاضي/,
    );
  });

  it('أي خطأ غير التفرّد بيطلع زي ما هو (مابنخبّيش أعطال حقيقية)', async () => {
    const q = (async (sql: string) => {
      if (sql.includes('SELECT iso_code')) return [];
      throw new Error('null value in column "name_ar" violates not-null constraint');
    }) as <T>(sql: string, params?: unknown[]) => Promise<T>;
    await expect(insertTestCountry(q, { nameAr: '', nameEn: '' })).rejects.toThrow(/not-null/);
  });
});
