import { assertSettingWithinRange } from './settings.service';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { REGISTERED_SETTING_KEYS, SETTINGS_REGISTRY } from './settings-registry';

/**
 * **الحارس اللي كان هيمنع أربع نتايج تدقيق من الأساس** (C-3، D-2، L-1، L-3).
 *
 * ١٦٦٧ اختبار كانوا بيعدّوا نضاف و٢٠ مفتاح إعدادات مكسور جوّه النظام — لأن كل الاختبارات بتحقن
 * إعدادات أو بتعتمد على الـfallback، فمفيش ولا واحد كان بيسأل السؤالين دول:
 *   ١. المفتاح اللي الكود بيقراه — **موجود في القاعدة** ولا الأدمن مش قادر يضبطه أصلاً؟
 *   ٢. الصف اللي في القاعدة — **فيه حد بيقراه** ولا الأدمن بيعدّله ومفيش حاجة بتحصل؟
 *
 * الاختبار ده بيسأل الاتنين على قاعدة حيّة.
 */
describe('سجل الإعدادات — تطابق الكود والقاعدة في الاتجاهين (تدقيق C-3/D-2)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let dbKeys: Set<string>;
  let dbTypes: Map<string, string>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    });
    await dataSource.initialize();
    const rows: { key: string; value_type: string }[] = await dataSource.query(
      `SELECT key, value_type FROM settings`,
    );
    dbKeys = new Set(rows.map((r) => r.key));
    dbTypes = new Map(rows.map((r) => [r.key, r.value_type]));
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('كل مفتاح مسجّل له صف فعلي في القاعدة (يعني الأدمن يقدر يضبطه)', () => {
    const missing = REGISTERED_SETTING_KEYS.filter((key) => !dbKeys.has(key));
    // ده بالظبط اللي كان مكسور في مفاتيح الطوارئ الخمسة: الكود بيقراها، ومفيش صف، فـ
    // `SettingsService.update()` بيرمي 404 ومفيش endpoint إنشاء — الضبط مستحيل من اللوحة.
    expect({ مفاتيح_مسجّلة_ومش_في_القاعدة: missing }).toEqual({ مفاتيح_مسجّلة_ومش_في_القاعدة: [] });
  });

  it('كل صف في القاعدة مسجّل هنا (يعني مفيش إعداد ظاهر للأدمن ومالوش أثر)', () => {
    const unregistered = [...dbKeys].filter((key) => !(key in SETTINGS_REGISTRY)).sort();
    expect({ صفوف_في_القاعدة_ومش_مسجّلة: unregistered }).toEqual({ صفوف_في_القاعدة_ومش_مسجّلة: [] });
  });

  it('نوع كل مفتاح في السجل مطابق للنوع في القاعدة', () => {
    const mismatched = REGISTERED_SETTING_KEYS.filter(
      (key) => dbKeys.has(key) && dbTypes.get(key) !== SETTINGS_REGISTRY[key].type,
    ).map((key) => `${key}: القاعدة=${dbTypes.get(key)} السجل=${SETTINGS_REGISTRY[key].type}`);
    expect({ أنواع_مختلفة: mismatched }).toEqual({ أنواع_مختلفة: [] });
  });

  it('كل مفتاح في السجل له وصف حقيقي — الوصف هو اللي الأدمن بيقرا منه', () => {
    const undescribed = REGISTERED_SETTING_KEYS.filter(
      (key) => SETTINGS_REGISTRY[key].description.trim().length < 10,
    );
    expect({ بلا_وصف: undescribed }).toEqual({ بلا_وصف: [] });
  });

  /**
   * الاتجاه التالت: مفتاح **بيتقرا من الكود** ومش مسجّل هنا.
   *
   * المسح نصّي على نداءات `SettingsService` وثوابت `*_SETTING` — مش تحليل AST كامل، وده مقصود:
   * الهدف حارس رخيص بيمسك الحالة الشايعة (حد ضاف `getNumber('x.y', 5)` جديدة ونسي يسجّلها)،
   * مش إثبات رياضي. الحالات اللي بيفوتها (مفتاح مركّب في وقت التشغيل) نادرة ومكتوبة هنا صراحة
   * عشان محدش يفتكر إن التغطية كاملة.
   */
  it('كل مفتاح بيتقرا من الكود مسجّل هنا', () => {
    const srcDir = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) files.push(full);
      }
    };
    walk(srcDir);

    // `getNumber('a.b', …)` / `getBoolean("a.b")` / `getString`/`getJson`، وكمان
    // `const X_SETTING = 'a.b'` (النمط اللي بيخبّي المفتاح ورا ثابت).
    const callPattern = /\.get(?:Number|Boolean|String|Json)\s*(?:<[^>]*>)?\s*\(\s*['"]([a-z][a-z0-9_]*\.[a-z0-9_.]+)['"]/g;
    const constPattern = /_SETTING\s*=\s*['"]([a-z][a-z0-9_]*\.[a-z0-9_.]+)['"]/g;

    const found = new Map<string, string>();
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of [callPattern, constPattern]) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
          if (!found.has(match[1])) found.set(match[1], file.replace(srcDir, 'src'));
        }
      }
    }

    const unregistered = [...found.entries()]
      .filter(([key]) => !(key in SETTINGS_REGISTRY))
      .map(([key, file]) => `${key} (${file})`)
      .sort();
    expect({ مفاتيح_بتتقرا_ومش_مسجّلة: unregistered }).toEqual({ مفاتيح_بتتقرا_ومش_مسجّلة: [] });
  });

  /*
    ═══ الحدود المسموحة (docs/08 §188) ═══

    الحدود لازم تطابق الواقع في الاتجاهين: القيمة الافتراضية **و** القيمة الحالية في القاعدة
    جوّه الحدود. من غير ده، حد غلط هنا كان هيمنع الأدمن يحفظ حتى القيمة اللي النظام شغّال بيها
    دلوقتي — أو يبان إنه بيحمي وهو بيرفض الإعداد الصح.
  */
  it('كل حد مسجّل بيحتوي القيمة الافتراضية والقيمة الحالية في القاعدة', async () => {
    const ranged = Object.entries(SETTINGS_REGISTRY).filter(([, def]) => def.range);
    expect(ranged.length).toBeGreaterThan(20);
    const rows: { key: string; value: unknown }[] = await dataSource.query(
      `SELECT key, value FROM settings WHERE key = ANY($1::text[])`,
      [ranged.map(([key]) => key)],
    );
    const current = new Map(rows.map((r) => [r.key, r.value]));
    const violations: string[] = [];
    for (const [key, def] of ranged) {
      for (const [label, value] of [['الافتراضي', def.default], ['الحالي', current.get(key)]] as const) {
        if (typeof value !== 'number') continue;
        try {
          assertSettingWithinRange(key, value);
        } catch {
          violations.push(`${key}: ${label}=${value} بره [${def.range!.min}, ${def.range!.max}]`);
        }
      }
    }
    expect({ قيم_بره_الحدود: violations }).toEqual({ قيم_بره_الحدود: [] });
  });

  it('الحد بيرفض فعلاً: رسوم طوارئ ٩٠٠٪، دفعة ٤.٥ فني، ويوم شغل ٢٠ ساعة', () => {
    expect(() => assertSettingWithinRange('pricing.emergency_surcharge_percentage', 900)).toThrow(/من 0 لـ100/);
    expect(() => assertSettingWithinRange('pricing.emergency_surcharge_percentage', 20)).not.toThrow();
    expect(() => assertSettingWithinRange('matching.batch_size', 4.5)).toThrow(/عدد صحيح/);
    // الرسالتين اللي كانوا مكتوبين `if` جوّه `update()` اتنقلوا للسجل بنفس النص بالحرف.
    expect(() => assertSettingWithinRange('matching.daily_capacity_minutes', 20 * 60)).toThrow(
      'يوم العمل لازم يكون عدد دقائق صحيحًا من ساعة إلى 12 ساعة كحد أقصى',
    );
    expect(() => assertSettingWithinRange('matching.additional_request_batch_size', 0)).toThrow(
      'عدد الفنيين في الدفعة لازم يكون عددًا صحيحًا من 1 إلى 100',
    );
    // مفتاح مالوش حد بيعدّي زي ما هو — الحدود مقصودة، مش على كل حاجة.
    expect(() => assertSettingWithinRange('booking.suggestion_count', 999)).not.toThrow();
  });
});
