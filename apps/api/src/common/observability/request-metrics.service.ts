import { Injectable } from '@nestjs/common';

/**
 * **عدّاد طلبات في الذاكرة — الأساس اللي إنذارات ج-٧ بتقف عليه.**
 *
 * الفجوة اللي بيسدّها: النظام كان بيسجّل الأعطال في `.dev-logs/errors.log`، وده **متوقّف في
 * الإنتاج عمدًا** (تسريب stacks على القرص). يعني في الإنتاج مكانش فيه أي مصدر يقول «كام 5xx
 * حصلوا آخر ساعة؟» ولا «الطلبات بقت بطيئة؟» — أهم إشارتين في أي مراقبة، ومحدش يقدر يبني عليهم
 * إنذار.
 *
 * **ليه في الذاكرة مش في القاعدة**: العدّ ده بيحصل على **كل** طلب. كتابة صف لكل طلب معناها
 * تحميل الحِمل الأساسي بضِعف على نفس القاعدة اللي بنراقبها — وأول حاجة هتقع تحت الضغط. نافذة
 * دقايق في الذاكرة كافية للسؤال «هل النظام تعبان **دلوقتي**؟»، وهو السؤال اللي الإنذار بيسأله.
 *
 * **الحد المعروف والمقصود**: العدّادات **لكل process**. مع أكتر من نسخة، كل نسخة بتقول عن
 * نفسها — وده الصح للمراقبة (نسخة واحدة تعبانة = مشكلة حقيقية حتى لو المتوسط كويس)، بس لازم
 * يكون معروف إن الرقم مش إجمالي الكلاستر. وبتتصفّر مع إعادة التشغيل، وده مقبول: الإنذار على
 * «الحالة دلوقتي» مش على التاريخ.
 */

/** كل دلو دقيقة واحدة. ١٥ دلو = نافذة ربع ساعة. */
const BUCKET_MS = 60_000;
const BUCKET_COUNT = 15;
/** سقف عيّنات الزمن لكل دلو — الاحتفاظ بكل عيّنة تحت ضغط بيأكل ذاكرة بلا داعي. */
const LATENCY_SAMPLES_PER_BUCKET = 200;

interface Bucket {
  minute: number;
  total: number;
  serverErrors: number;
  clientErrors: number;
  latencies: number[];
}

export interface RequestMetricsSnapshot {
  windowMinutes: number;
  total: number;
  serverErrors: number;
  clientErrors: number;
  serverErrorRate: number;
  latencyMs: { p50: number; p95: number; max: number };
  /** أكتر مسارات رجّعت 5xx في النافذة — بيوفّر خطوة «فين المشكلة؟» بعد الإنذار. */
  topServerErrorRoutes: { route: string; count: number }[];
}

@Injectable()
export class RequestMetricsService {
  private buckets: Bucket[] = [];
  private readonly errorRoutes = new Map<string, { count: number; at: number }>();

  private currentBucket(): Bucket {
    const minute = Math.floor(Date.now() / BUCKET_MS);
    const last = this.buckets[this.buckets.length - 1];
    if (last && last.minute === minute) return last;
    const bucket: Bucket = { minute, total: 0, serverErrors: 0, clientErrors: 0, latencies: [] };
    this.buckets.push(bucket);
    while (this.buckets.length > BUCKET_COUNT) this.buckets.shift();
    return bucket;
  }

  record(statusCode: number, durationMs: number, route: string): void {
    const bucket = this.currentBucket();
    bucket.total += 1;
    if (bucket.latencies.length < LATENCY_SAMPLES_PER_BUCKET) bucket.latencies.push(durationMs);
    if (statusCode >= 500) {
      bucket.serverErrors += 1;
      const prev = this.errorRoutes.get(route);
      this.errorRoutes.set(route, { count: (prev?.count ?? 0) + 1, at: Date.now() });
    } else if (statusCode >= 400) {
      bucket.clientErrors += 1;
    }
  }

  snapshot(): RequestMetricsSnapshot {
    const oldestMinute = Math.floor(Date.now() / BUCKET_MS) - BUCKET_COUNT;
    const live = this.buckets.filter((b) => b.minute > oldestMinute);
    const total = live.reduce((sum, b) => sum + b.total, 0);
    const serverErrors = live.reduce((sum, b) => sum + b.serverErrors, 0);
    const clientErrors = live.reduce((sum, b) => sum + b.clientErrors, 0);
    const latencies = live.flatMap((b) => b.latencies).sort((a, b) => a - b);

    const cutoff = Date.now() - BUCKET_COUNT * BUCKET_MS;
    for (const [route, info] of this.errorRoutes) if (info.at < cutoff) this.errorRoutes.delete(route);

    return {
      windowMinutes: BUCKET_COUNT,
      total,
      serverErrors,
      clientErrors,
      serverErrorRate: total > 0 ? Number((serverErrors / total).toFixed(4)) : 0,
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: latencies.length ? latencies[latencies.length - 1] : 0,
      },
      topServerErrorRoutes: [...this.errorRoutes.entries()]
        .map(([route, info]) => ({ route, count: info.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }

  /** للاختبارات بس. */
  reset(): void {
    this.buckets = [];
    this.errorRoutes.clear();
  }
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return Math.round(sorted[index]);
}
