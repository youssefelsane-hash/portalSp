import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runExclusiveSweep } from './sweep-lock';

/**
 * **إعادة إنتاج استنزاف الـpool من الدورات المجدولة — حي على Postgres حقيقي.**
 *
 * السيناريو اللي حصل فعلاً على `main`: ١٦ دورة مجدولة بتولع في نفس اللحظة (كلها `setInterval`
 * بـ60 ثانية اتسجّلت وقت الإقلاع)، كل واحدة كانت بتحجز اتصال من الـpool **طول مدة الدورة**
 * عشان القفل الاستشاري على مستوى الجلسة، وجوّه الدورة بتعمل استعلام تاني محتاج اتصال تاني.
 * الـpool الافتراضي ١٠، منهم ٢ محجوزين لـLISTEN دايم ⇒ ٨ متاحين ⇒ ٨ أقفال بتاكل الـpool كله
 * وكل واحدة مستنية اتصال تاسع مش هييجي أبدًا. مافيش مهلة اقتناء افتراضية في node-postgres،
 * فالانتظار أبدي — والـAPI بيقف تمامًا (`/health` نفسه محتاج اتصال).
 *
 * الاختبار ده بيصغّر نفس الشروط: pool = 3، عدد دورات أكبر من الـpool، وكل دورة بتعمل استعلام
 * حقيقي جوّاها، وطلب «HTTP» متزامن بيمثّل حركة المستخدمين. لازم كله يخلص.
 */
describe('استنزاف الـpool من الدورات المجدولة — حي', () => {
  jest.setTimeout(60_000);

  const logger = new Logger('SweepPoolStarvationSpec');
  const url = process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak';
  const POOL = 3;
  const SWEEPS = 6; // ضعف الـpool — لازم يعدّي برضه

  let ds: DataSource;

  beforeAll(async () => {
    ds = await new DataSource({
      type: 'postgres',
      url,
      entities: [],
      // نفس شكل الإعداد الحقيقي بعد الإصلاح: مهلة اقتناء صريحة بدل انتظار أبدي.
      extra: { max: POOL, connectionTimeoutMillis: 5_000 },
    }).initialize();
  });

  afterAll(async () => {
    // نظافة بيانات الاختبار **قبل** إغلاق الاتصال (CLAUDE.md — كل spec ينضّف وراه). Jest
    // بينفّذ الـafterAll بترتيب التعريف، فتنظيف في هوك تاني بعد `destroy` مكانش هيلاقي اتصال.
    // كل الأسماء فيها بادئة زمنية، فمفيش أي خطر على إيجارات دورات حقيقية.
    await ds.query(
      `DELETE FROM sweep_leases
        WHERE lock_name LIKE 'starvation-%' OR lock_name LIKE 'exclusive-under-pressure-%'
           OR lock_name LIKE 'no-held-connection-%' OR lock_name LIKE 'expired-lease-%'
           OR lock_name LIKE 'fencing-%'`,
    );
    await ds.destroy();
  });

  it('دورات أكتر من حجم الـpool + استعلام جوّه كل دورة + حركة متزامنة = مفيش تعليق', async () => {
    const prefix = `starvation-${Date.now().toString(36)}`;
    let started = 0;
    const allStarted = new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        if (started >= SWEEPS) {
          clearInterval(tick);
          resolve();
        }
      }, 10);
      tick.unref?.();
    });

    const sweeps = Array.from({ length: SWEEPS }, (_, i) =>
      runExclusiveSweep(
        ds,
        `${prefix}-${i}`,
        async () => {
          started += 1;
          // كل الدورات تكون ماسكة أقفالها في نفس اللحظة قبل ما أي واحدة تستعلم — ده
          // بالظبط اللي بيحصل لما ١٦ مؤقّت يولعوا في نفس التِك.
          await allStarted;
          // استعلام حقيقي جوّه الدورة — ده اللي كان بيطلب اتصال مش موجود.
          const rows = (await ds.query('SELECT $1::int AS n', [i])) as { n: number }[];
          return rows[0].n;
        },
        logger,
      ),
    );

    // حركة «المستخدمين» بالتوازي — لازم تعدّي وإحنا في نص الدورات.
    const traffic = allStarted.then(() => ds.query('SELECT 1 AS alive'));

    const results = await Promise.all([...sweeps, traffic]);
    const sweepResults = results.slice(0, SWEEPS) as (number | null)[];

    // كل الدورات اشتغلت فعلاً (مش اتخطّت) ورجّعت قيمها.
    expect(sweepResults).toEqual(Array.from({ length: SWEEPS }, (_, i) => i));
    expect(results[SWEEPS]).toEqual([{ alive: 1 }]);
  });

  it('الحصرية عبر النسخ لسه شغّالة تحت نفس الضغط', async () => {
    const other = await new DataSource({
      type: 'postgres',
      url,
      entities: [],
      extra: { max: POOL, connectionTimeoutMillis: 5_000 },
    }).initialize();
    try {
      const lock = `exclusive-under-pressure-${Date.now().toString(36)}`;
      let inside = 0;
      let maxInside = 0;
      const body = async (): Promise<string> => {
        inside += 1;
        maxInside = Math.max(maxInside, inside);
        await ds.query('SELECT pg_sleep(0.3)');
        inside -= 1;
        return 'ran';
      };

      const [first, second] = await Promise.all([
        runExclusiveSweep(ds, lock, body, logger),
        runExclusiveSweep(other, lock, body, logger),
      ]);

      // واحدة بس هي اللي اشتغلت — التانية اتخطّت لأن القفل مأخوذ.
      expect([first, second].filter((r) => r === 'ran')).toHaveLength(1);
      expect([first, second].filter((r) => r === null)).toHaveLength(1);
      expect(maxInside).toBe(1);
    } finally {
      await other.destroy();
    }
  });

  /**
   * دي الضمانة البنيوية نفسها، مش عَرَض من أعراضها: **مفيش اتصال محجوز طول الدورة.** طول ما
   * الشرط ده صحيح، أي عدد دورات مهما طال زمنها مايقدرش يستنزف الـpool.
   */
  it('الدورة الشغّالة مش ماسكة أي اتصال من الـpool', async () => {
    // `totalCount`/`idleCount` في pg.Pool **getters على الـprototype**، فالنسخ بـ`{...pool}`
    // بيرجّع كائن فاضي وقيَم NaN. لازم تتقرا صريح وقت اللقطة.
    const poolOf = (source: DataSource): { total: number; idle: number } => {
      const p = (source.driver as unknown as { master: { totalCount: number; idleCount: number } }).master;
      return { total: p.totalCount, idle: p.idleCount };
    };

    // نسخّن الـpool الأول عشان نقارن حالة مستقرة بحالة «دورة شغّالة».
    await ds.query('SELECT 1');
    const before = poolOf(ds);

    let insidePool: { total: number; idle: number } | null = null;
    const result = await runExclusiveSweep(
      ds,
      `no-held-connection-${Date.now().toString(36)}`,
      async () => {
        // جوّه الدورة بالظبط: كل الاتصالات لازم تكون راجعة خاملة، مفيش واحد متشال للقفل.
        insidePool = poolOf(ds);
        return 'ok';
      },
      logger,
    );

    expect(result).toBe('ok');
    expect(insidePool).not.toBeNull();
    const inside = insidePool as unknown as { total: number; idle: number };
    // مفيش اتصال مشغول أثناء الدورة (`total === idle`)، والعدد الكلي ما زادش عن قبلها.
    expect(inside.total - inside.idle).toBe(0);
    expect(inside.total).toBeLessThanOrEqual(before.total);
  });

  /** الإيجار المنتهي لازم يتاخد من نسخة تانية — ده بديل «القفل بيتسحب لما الجلسة تموت». */
  it('إيجار نسخة ماتت بيتاخد بعد انتهاء مهلته', async () => {
    const lock = `expired-lease-${Date.now().toString(36)}`;
    // مهلة قصيرة جدًا = محاكاة نسخة أخدت الإيجار وماتت من غير ما تحرّره.
    await ds.query(
      `INSERT INTO sweep_leases (lock_name, holder_token, holder_instance, expires_at)
       VALUES ($1, gen_random_uuid(), 'نسخة-ماتت', now() - interval '1 second')`,
      [lock],
    );

    const ran = await runExclusiveSweep(ds, lock, async () => 'أُخِذ', logger);
    expect(ran).toBe('أُخِذ');

    // وبعد التحرير، الصف بيفضل موجود كأثر تشغيلي مش بيتمسح.
    const rows = (await ds.query(
      `SELECT holder_instance, last_released_at IS NOT NULL AS released FROM sweep_leases WHERE lock_name = $1`,
      [lock],
    )) as { holder_instance: string; released: boolean }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].holder_instance).not.toBe('نسخة-ماتت');
    expect(rows[0].released).toBe(true);
  });

  /** التوكن (fencing): نسخة ضاع منها الإيجار مايصحّش تحرّر إيجار نسخة تانية. */
  it('التحرير مشروط بالتوكن — نسخة متأخرة مابتفتحش قفل غيرها', async () => {
    const lock = `fencing-${Date.now().toString(36)}`;
    let sawLeaseOfOther = false;

    // A بتاخد الإيجار بمهلة قصيرة وتفضل شغّالة بعد ما يخلص.
    const slow = runExclusiveSweep(
      ds,
      lock,
      async () => {
        await new Promise((r) => setTimeout(r, 2_500));
        return 'A';
      },
      logger,
      { ttlMs: 1_000 },
    );

    // بعد ما مهلة A تخلص، B بتاخد الإيجار.
    await new Promise((r) => setTimeout(r, 1_400));
    const stolen = await runExclusiveSweep(
      ds,
      lock,
      async () => {
        sawLeaseOfOther = true;
        return 'B';
      },
      logger,
      { ttlMs: 10_000 },
    );

    expect(stolen).toBe('B');
    expect(sawLeaseOfOther).toBe(true);
    await slow;

    // A خلصت **بعد** B وحاولت تحرّر — لازم تكون ماسّتش الصف، فالتوكن بتاع B لسه هو الحائز.
    const rows = (await ds.query(`SELECT holder_instance, run_count FROM sweep_leases WHERE lock_name = $1`, [
      lock,
    ])) as { holder_instance: string; run_count: string }[];
    expect(rows).toHaveLength(1);
    // اتاخد مرتين (A ثم B) — والصف صف واحد، مفيش تكرار.
    expect(Number(rows[0].run_count)).toBe(2);
  });

  /**
   * حارس بنيوي: أي رجوع لـ`createQueryRunner` جوّه `sweep-lock.ts` معناه رجوع القفل المربوط
   * بالجلسة — يعني رجوع العطل نفسه. الاختبارات فوق بتثبت السلوك، والحارس ده بيمنع النمط.
   */
  it('تنفيذ القفل مايمسكش QueryRunner ولا قفل استشاري على مستوى الجلسة', () => {
    // التعليقات بتشرح النمط القديم بالاسم عمدًا، فالحارس بيفحص الكود بس.
    const code = readFileSync(join(__dirname, 'sweep-lock.ts'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/createQueryRunner/);
    expect(code).not.toMatch(/pg_try_advisory_lock|pg_advisory_unlock/);
  });

});
