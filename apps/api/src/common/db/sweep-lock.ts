import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * **قفل الدورات المجدولة — إيجار بمهلة، مش قفل مربوط بجلسة.**
 *
 * ## الغرض
 *
 * كل الـsweeps في المشروع `setInterval` جوّه العملية نفسها. ده كان صح لما كان فيه instance
 * واحدة، وبقى غلط بعد ما ADR-0073 خلّى التشغيل متعدد النسخ حقيقي: كل نسخة بتشغّل **نفس**
 * الدورة على **نفس** الصفوف في نفس الثانية. النتيجة مش بطء بس — دي سباقات حقيقية: طلبين
 * اتلغوا بدل واحد، تذكير اتبعت مرتين، دفعة اتحصّلت مرتين.
 *
 * ## ليه اتغيّر التنفيذ (ADR-0076)
 *
 * التنفيذ الأول كان `pg_try_advisory_lock` على مستوى الجلسة. القفل ده **مربوط بالاتصال**:
 * عشان يفضل ماسك طول الدورة، لازم الاتصال يفضل محجوز طول الدورة. يعني كل دورة شغّالة كانت
 * بتشيل اتصال من pool التطبيق — والدورات بتولع كلها في نفس التِك:
 *
 *   pool = ١٠، منهم ٢ محجوزين دايمًا لـ`LISTEN` ⇒ ٨ متاحين.
 *   ٨ دورات بتاخد الـ٨ كلهم للأقفال، وكل واحدة بتطلب اتصال تاني لاستعلامها الحقيقي.
 *   الاتصال التاني مش هييجي أبدًا — اللي ماسكينه هم اللي مستنيينه. **قفل ميت بنفسه على نفسه.**
 *
 * ومفيش مهلة اقتناء افتراضية في node-postgres، فالانتظار أبدي: `/health` وطلبات الدخول وكل
 * حركة المستخدمين بتتعلّق، والعملية مابترجعش لوحدها. اتعاد إنتاجه حرفيًا في
 * `sweep-pool-starvation.spec.ts`.
 *
 * ## التصميم الحالي
 *
 * إيجار بمهلة في `sweep_leases`. الاقتناء والتجديد والتحرير **استعلام قصير واحد** كل مرة،
 * والاتصال بيرجع للـpool فورًا. **مفيش أي اتصال محجوز طول الدورة** — ومن هنا يستحيل بنيويًا
 * إن عدد الدورات المتزامنة يستنزف الـpool، مهما كان عددها أو طولها.
 *
 * - **الحصرية**: `ON CONFLICT ... DO UPDATE ... WHERE expires_at <= now()` عبارة ذرّية واحدة —
 *   نسخة واحدة بس بتاخد الصف، والباقي بيرجعوا فورًا (مش بيستنوا؛ الدورة الجاية بعد دقيقة أهي).
 * - **موت النسخة**: الإيجار بيخلص لوحده بعد `ttl`، فالدورة بترجع تشتغل من غير تنظيف يدوي.
 *   ده اللي كان Postgres بيعمله لوحده مع القفل الاستشاري، وبقى صريح دلوقتي.
 * - **التوكن (fencing)**: التجديد والتحرير مشروطين بـ`holder_token`. نسخة اتأخرت وضاع منها
 *   الإيجار مش هتقدر تجدّده ولا تحرّر إيجار بقى ملك نسخة تانية.
 * - **التجديد**: نبضة كل `ttl/3` طول ما الدورة شغّالة. دورة أطول من الـttl بتفضل ماسكة، وبس
 *   العملية اللي واقفة فعلاً (أطول من ttl من غير ما تنفّذ نبضة) هي اللي بتفقد الإيجار.
 * - **`AbortSignal`**: لو التجديد لقى الإيجار ضاع، بيتبعت إشارة إلغاء للدورة. الدورات الطويلة
 *   تقدر تقراها وتقف؛ اللي مابتقراهاش بتكمّل — والتوكن بيضمن إنها على الأقل مش هتحرّر إيجار غيرها.
 *
 * **القفل على الجدولة مش على العملية**: `runExclusiveSweep` بتتلفّ حوالين نداء المؤقّت بس.
 * نداء مباشر (أدمن بيضغط زرار، سبيك بيختبر المنطق) بيفضل فوري بلا قفل — القفل غرضه يمنع تكرار
 * **الجدولة** عبر النسخ، مش يمنع حد ينادي العملية عن قصد.
 */

/** مهلة الإيجار الافتراضية. أطول من أطول دورة عادية بهامش واسع، ومساوية لفاصل الجدولة الأساسي. */
const DEFAULT_LEASE_TTL_MS = 60_000;

/** نبضة التجديد — تلت المهلة، فلازم تفشل نبضتين ورا بعض قبل ما الإيجار يضيع. */
const RENEW_DIVISOR = 3;

/** هوية النسخة — بتظهر في `sweep_leases.holder_instance` عشان تعرف مين شغّال إيه وقت التشخيص. */
const INSTANCE_ID = `${hostname()}:${process.pid}`;

export interface SweepLockOptions {
  /** مهلة الإيجار بالمللي ثانية (افتراضي ٦٠ ثانية). */
  ttlMs?: number;
}

/**
 * بيشغّل الدورة لو نسخة تانية مش شغّالاها دلوقتي.
 *
 * بيرجّع نتيجة الدورة، أو `null` لو الدورة اتخطّت (إيجار مأخوذ / القاعدة مش متاحة / فشل جوّه
 * الدورة). الفشل بيتسجّل ومابيترميش — دورة واقعة مايصحّش تكسر العملية (CLAUDE.md #2).
 */
export async function runExclusiveSweep<T>(
  dataSource: DataSource,
  lockName: string,
  sweep: (signal: AbortSignal) => Promise<T>,
  logger: Logger,
  options: SweepLockOptions = {},
): Promise<T | null> {
  const ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  const token = randomUUID();

  let acquired: boolean;
  try {
    acquired = await acquireLease(dataSource, lockName, token, ttlMs);
  } catch (err) {
    // القاعدة مش متاحة — الدورة دي بتتخطّى بأمان، والجاية هتلاقي الدنيا رجعت.
    logger.warn(`تخطّي دورة ${lockName}: تعذّر اقتناء الإيجار — ${message(err)}`);
    return null;
  }
  // نسخة تانية ماسكة الدورة دي دلوقتي — سلوك طبيعي متوقّع، مش خطأ.
  if (!acquired) return null;

  const controller = new AbortController();
  const renewEvery = Math.max(1_000, Math.floor(ttlMs / RENEW_DIVISOR));
  const heartbeat = setInterval(() => {
    void renewLease(dataSource, lockName, token, ttlMs)
      .then((stillOurs) => {
        if (stillOurs) return;
        // ضياع الإيجار وإحنا شغّالين معناه إن النسخة دي وقفت أطول من المهلة كلها — حالة
        // تستاهل صوت عالي، مش سطر warn مبتلع.
        logger.error(`ضاع إيجار ${lockName} أثناء التشغيل (النسخة اتأخرت أطول من ${ttlMs}ms) — بيتبعت إلغاء.`);
        controller.abort(new Error(`sweep lease lost: ${lockName}`));
      })
      .catch((err: unknown) => logger.warn(`تعذّر تجديد إيجار ${lockName}: ${message(err)}`));
  }, renewEvery);
  heartbeat.unref?.();

  try {
    return await sweep(controller.signal);
  } catch (err) {
    logger.error(`فشل دورة ${lockName}`, err instanceof Error ? err.stack : err);
    return null;
  } finally {
    clearInterval(heartbeat);
    // التحرير مشروط بالتوكن: لو الإيجار ضاع وبقى لنسخة تانية، مابنلمسهوش.
    await releaseLease(dataSource, lockName, token).catch((err: unknown) =>
      logger.warn(`تعذّر تحرير إيجار ${lockName} (هيخلص لوحده بعد ${ttlMs}ms): ${message(err)}`),
    );
  }
}

/**
 * عبارة واحدة ذرّية. `DO UPDATE ... WHERE expires_at <= now()` بيخلّي الصف يتاخد **بس** لو
 * الإيجار الموجود خلص؛ غير كده الـ`RETURNING` بيرجع فاضي = نسخة تانية ماسكة.
 */
async function acquireLease(
  dataSource: DataSource,
  lockName: string,
  token: string,
  ttlMs: number,
): Promise<boolean> {
  const rows = (await dataSource.query(
    `INSERT INTO sweep_leases (lock_name, holder_token, holder_instance, expires_at, run_count)
     VALUES ($1, $2::uuid, $3, now() + make_interval(secs => $4::double precision / 1000), 1)
     ON CONFLICT (lock_name) DO UPDATE
       SET holder_token = EXCLUDED.holder_token,
           holder_instance = EXCLUDED.holder_instance,
           acquired_at = now(),
           renewed_at = now(),
           expires_at = EXCLUDED.expires_at,
           run_count = sweep_leases.run_count + 1,
           updated_at = now()
       WHERE sweep_leases.expires_at <= now()
     RETURNING id`,
    [lockName, token, INSTANCE_ID, ttlMs],
  )) as unknown[];
  return rows.length > 0;
}

async function renewLease(
  dataSource: DataSource,
  lockName: string,
  token: string,
  ttlMs: number,
): Promise<boolean> {
  const rows = (await dataSource.query(
    `UPDATE sweep_leases
        SET expires_at = now() + make_interval(secs => $3::double precision / 1000),
            renewed_at = now(),
            updated_at = now()
      WHERE lock_name = $1 AND holder_token = $2::uuid AND expires_at > now()
      RETURNING id`,
    [lockName, token, ttlMs],
  )) as unknown[];
  return rows.length > 0;
}

/**
 * الصف بيفضل موجود بعد التحرير عمدًا (`expires_at` في الماضي) — أثر تشغيلي بيجاوب على «آخر
 * مرة الدورة دي اشتغلت إمتى ومن أنهي نسخة» باستعلام واحد. الحذف كان هيضيّع المعلومة دي.
 */
async function releaseLease(dataSource: DataSource, lockName: string, token: string): Promise<void> {
  await dataSource.query(
    `UPDATE sweep_leases
        SET expires_at = now() - interval '1 millisecond',
            last_released_at = now(),
            updated_at = now()
      WHERE lock_name = $1 AND holder_token = $2::uuid`,
    [lockName, token],
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
