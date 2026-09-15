import { Logger } from '@nestjs/common';

/**
 * مسجّل أخطاء **مخنوق** لأحداث `error` بتاعة BullMQ Worker.
 *
 * **البَقّة الحقيقية اللي خلّته موجود (تدقيق ماراثوني 2026-09-14، docs/08 §148)**: كل الأربع
 * processors كانوا بيعملوا `logger.warn()` على **كل** حدث `error`. ووقت انقطاع Redis الـworker
 * بيرمي الخطأ ده مئات المرات في الثانية، فالنتيجة المقاسة فعلاً: **٩ جيجا لوج في نافذة انقطاع
 * واحدة**.
 *
 * والأخطر إنها مش مجرد مساحة قرص: `process.stdout` لما يكون موجّه لملف، الكتابة عليه من Node
 * **متزامنة** — يعني كل سطر لوج بيوقف الـevent loop. الفيضان ده كان بيخنق الـloop فعليًا،
 * فطلب حجز حقيقي كان بيفضل معلّق ٦٠ ثانية وينتهي بـtimeout عند العميل. ده خرق مباشر للقاعدة
 * الحاكمة في CLAUDE.md: «أي فشل في cache/queue/infra… أبداً ميكسرش أو يعلّق العملية الحقيقية
 * للمستخدم».
 *
 * السلوك: أول ظهور لكل رسالة بيتسجّل فورًا (مانخسرش أول إشارة)، وبعدها الرسايل المتطابقة
 * بتتجمّع وبيتسجّل سطر ملخّص كل `windowMs` بعدد المرات — فالإشارة بتفضل موجودة والفيضان بيختفي.
 *
 * المستمع نفسه **لازم يفضل موجود**: Node's EventEmitter بيرمي الخطأ (throw) لو `error` اتبعت
 * وماحدش مستمع، وده كان بيوقف الـmainLoop بتاع الـWorker بصمت للأبد.
 */
export class ThrottledWorkerErrorLogger {
  private readonly seen = new Map<string, { count: number; lastLoggedAt: number }>();

  constructor(
    private readonly logger: Logger,
    private readonly label: string,
    private readonly windowMs = 30_000,
  ) {}

  record(error: Error): void {
    const message = error?.message ?? String(error);
    const now = Date.now();
    const entry = this.seen.get(message);

    if (!entry) {
      this.seen.set(message, { count: 0, lastLoggedAt: now });
      this.logger.warn(`Worker error (${this.label}): ${message}`);
      return;
    }

    entry.count += 1;
    if (now - entry.lastLoggedAt < this.windowMs) return;

    this.logger.warn(`Worker error (${this.label}): ${message} — اتكررت ${entry.count} مرة خلال آخر ${Math.round((now - entry.lastLoggedAt) / 1000)}ث`);
    entry.count = 0;
    entry.lastLoggedAt = now;
  }
}
