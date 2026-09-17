/**
 * إدخال دولة اختبار بكود ISO **فاضي فعلاً** — مشترك بين كل السبيكات الحيّة.
 *
 * `countries.iso_code` عمود `varchar(2)` وعليه `UNIQUE`، يعني مساحة الأسماء ١٢٩٦ قيمة بس.
 * والسبيكات كانت كلها بتولّد الكود من `Date.now().toString(36).slice(-2)` — وآخر حرفين في
 * base36 بيتغيّروا كل ١٢٩٦ مللي ثانية، فأي سبيكتين بيبدأوا في نفس الثانية-وربع بياخدوا **نفس
 * الكود**، والتانية بتفشل بـ`duplicate key value violates unique constraint
 * "countries_iso_code_key"` في `beforeAll` — يعني الـsuite كلها بتفشل من غير أي علاقة بالمنطق
 * اللي بتختبره. وكمان الكود ممكن يصادف دولة حقيقية (`EG`). حصل فعلاً أكتر من مرة، وكان
 * بيتعالج محليًا في سبيكة واحدة بحذف استباقي بالاسم — ده الحل العام بدل نسخة في كل ملف.
 *
 * الطريقة: بنقرا الأكواد المستخدمة فعلاً ونختار واحد برّاها، وبنعيد المحاولة لو حد سبقنا بين
 * القراءة والإدخال (سباق حقيقي مع `--maxWorkers > 1`).
 */

/** نفس شكل `q` اللي كل سبيكة حيّة بتعرّفه فوق `dataSource.query`. */
type Query = <T = unknown>(sql: string, params?: unknown[]) => Promise<T>;

const ISO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const randomIsoCode = (): string =>
  ISO_ALPHABET[Math.floor(Math.random() * ISO_ALPHABET.length)] +
  ISO_ALPHABET[Math.floor(Math.random() * ISO_ALPHABET.length)];

export interface TestCountry {
  id: string;
  isoCode: string;
}

export async function insertTestCountry(
  query: Query,
  options: { nameAr: string; nameEn: string; phonePrefix?: string; currencyCode?: string },
): Promise<TestCountry> {
  const taken = new Set(
    (await query<{ iso_code: string }[]>(`SELECT iso_code FROM countries`)).map((row) => row.iso_code),
  );
  const phonePrefix = options.phonePrefix ?? '+20';
  const currencyCode = options.currencyCode ?? 'EGP';

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const isoCode = randomIsoCode();
    if (taken.has(isoCode)) continue;
    try {
      const [row] = await query<{ id: string }[]>(
        `INSERT INTO countries (name_ar, name_en, iso_code, currency_code, phone_prefix)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [options.nameAr, options.nameEn, isoCode, currencyCode, phonePrefix],
      );
      return { id: row.id, isoCode };
    } catch (error) {
      // سباق بين القراءة والإدخال: نسجّل الكود كمشغول ونجرّب غيره. أي خطأ تاني بيطلع زي ما هو.
      if (!String((error as Error)?.message ?? '').includes('countries_iso_code_key')) throw error;
      taken.add(isoCode);
    }
  }
  throw new Error(
    `مافيش كود ISO فاضي لدولة اختبار بعد ٤٠ محاولة (${taken.size} كود مستخدم) — نضّف صفوف الاختبار المتروكة.`,
  );
}
