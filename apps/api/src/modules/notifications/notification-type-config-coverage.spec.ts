import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { NotificationTypeConfig } from './entities/notification-type-config.entity';

/**
 * **كل نوع إشعار في الكود لازم يكون له صف في `notification_type_configs`** (docs/08 §148).
 *
 * ## البَقّة اللي الاختبار ده موجود عشانها
 *
 * `NotificationsService.resolveConfiguredChannels()` بتقرا القنوات من الجدول ده لما الكولر
 * مايحددش قناة. **نوع بلا صف ⇒ `in_app` بس** — الإشعار يتسجّل في التطبيق ومايوصلش الموبايل
 * خالص. تدقيق ٢٠٢٦-٠٩-١٣ لقى ٥٢ نوع كده، منهم ٢٢ بيتبعتوا بـ`notify()` بلا قناة:
 * `payment_instapay_confirmed`، `payment_instapay_rejected`، `order_reassigned_to_you`،
 * `installment_payment_failed`، `preferred_crew_invited`… كلهم كانوا بلا push.
 *
 * والأسوأ إن الشاشة `/admin/notification-types` بتعرض الصفوف الموجودة بس (مفيش create عمدًا)،
 * فالنوع اللي مالوش صف **مالوش أي مقبض** — لا الأدمن يشوفه ولا يقدر يفعّله.
 *
 * الـmigration بتقفل اللي كان موجود؛ الاختبار ده بيمنع النوع الجديد الجاي من إنه يعدّي ساكت.
 * بيمشي على الكود الحقيقي (مش قايمة مكتوبة بالإيد) عشان مايتقادمش.
 */
describe('تغطية إعدادات أنواع الإشعارات (docs/08 §148)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;

  /**
   * `otp` مستثنى بسبب مكتوب: بيتبعت عبر مزوّد SMS مباشرةً (`auth.service.ts` بـ`targets`)،
   * مش عبر `notify()`، فمابيمرش على الجدول ده أصلاً.
   */
  const INTENTIONALLY_UNCONFIGURED = new Set(['otp']);

  function collectTsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        collectTsFiles(full, out);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [NotificationTypeConfig],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('مفيش نوع إشعار في الكود بلا صف إعدادات (وإلا بيوصل in_app بس، بلا push وبلا مقبض للأدمن)', async () => {
    const srcRoot = join(__dirname, '..', '..');
    const emitted = new Set<string>();
    for (const file of collectTsFiles(srcRoot)) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/notificationType:\s*'([a-z0-9_.]+)'/g)) {
        emitted.add(match[1]);
      }
    }
    // حارس على الحارس: لو الـregex بطل يلاقي حاجة (تغيّر شكل النداء مثلاً)، الاختبار كان
    // هيعدّي بصمت وهو مش بيقيس أي حاجة.
    expect(emitted.size).toBeGreaterThan(40);

    const configured = new Set(
      (await dataSource.getRepository(NotificationTypeConfig).find()).map((row) => row.notificationType),
    );
    const missing = [...emitted].filter(
      (type) => !configured.has(type) && !INTENTIONALLY_UNCONFIGURED.has(type),
    );
    expect(missing).toEqual([]);
  });
});
