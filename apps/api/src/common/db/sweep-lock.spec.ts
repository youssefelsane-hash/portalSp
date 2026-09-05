import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runExclusiveSweep } from './sweep-lock';

/**
 * تدقيق A-2 — كل الـsweeps كانت `setInterval` بتشتغل على **كل** instance.
 *
 * ده كان صح لما كان فيه نسخة واحدة، وبقى غلط بعد ADR-0073 (البث اللحظي بقى بيعبر النسخ، يعني
 * التشغيل متعدد النسخ بقى حقيقي). الاختبار حي عمدًا: القفل الاستشاري سلوك Postgres نفسه —
 * `pg_try_advisory_lock` بيرجّع false للجلسة التانية. mock كان هيختبر إن الكود بينده الدالة،
 * مش إن القفل شغّال.
 */
describe('قفل الدورات المجدولة (تدقيق A-2) — حي', () => {
  jest.setTimeout(30_000);

  const logger = new Logger('SweepLockSpec');
  const lockName = `sweep-lock-spec-${Date.now().toString(36)}`;
  let a: DataSource;
  let b: DataSource;

  const url = process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak';

  beforeAll(async () => {
    // اتصالين مستقلين تمامًا = محاكاة نسختين من التطبيق على نفس القاعدة.
    a = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
    b = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  });

  afterAll(async () => {
    await a.destroy();
    await b.destroy();
  });

  it('نسخة واحدة بس بتشغّل الدورة، والتانية بتتخطّى فورًا', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    let ranA = false;
    const first = runExclusiveSweep(
      a,
      lockName,
      async () => {
        ranA = true;
        await held; // ماسك القفل لحد ما نسمح له
        return 'A';
      },
      logger,
    );

    // نستنى لحد ما A تكون ماسكة القفل فعلاً قبل ما B تحاول.
    while (!ranA) await new Promise((r) => setTimeout(r, 10));

    let ranB = false;
    const second = await runExclusiveSweep(
      b,
      lockName,
      async () => {
        ranB = true;
        return 'B';
      },
      logger,
    );

    expect(ranB).toBe(false);
    expect(second).toBeNull();

    release();
    expect(await first).toBe('A');
  });

  it('بعد ما الدورة تخلص، القفل بيترفع فالنسخة الجاية بتشتغل عادي', async () => {
    expect(await runExclusiveSweep(a, lockName, async () => 1, logger)).toBe(1);
    expect(await runExclusiveSweep(b, lockName, async () => 2, logger)).toBe(2);
  });

  it('فشل جوّه الدورة بيترفع القفل برضه — مفيش قفل ميت', async () => {
    const failed = await runExclusiveSweep(
      a,
      lockName,
      () => {
        throw new Error('انفجار متعمّد');
      },
      logger,
    );
    expect(failed).toBeNull();
    // لو القفل ماكانش اترفع، النداء ده كان هيرجّع null.
    expect(await runExclusiveSweep(b, lockName, async () => 'بعد الفشل', logger)).toBe('بعد الفشل');
  });

  it('أقفال بأسماء مختلفة مابيعطّلوش بعض', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runExclusiveSweep(a, `${lockName}-x`, async () => {
      await held;
      return 'x';
    }, logger);
    await new Promise((r) => setTimeout(r, 50));
    expect(await runExclusiveSweep(b, `${lockName}-y`, async () => 'y', logger)).toBe('y');
    release();
    expect(await first).toBe('x');
  });
});
