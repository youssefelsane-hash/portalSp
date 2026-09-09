import { Logger } from '@nestjs/common';

/**
 * إعادة محاولة transaction اتقتلت بسبب تعارض تزامن على مستوى Postgres.
 *
 * ## المشكلة اللي الملف ده موجود عشانها (بَقّة حقيقية اتقاست، ج-٢)
 *
 * عميل رصيده يكفي طلب واحد، وبعت دفعتين متزامنتين لطلبين مختلفين. الفلوس طلعت سليمة تمامًا
 * (دفعة واحدة نجحت، الرصيد صفر، مفيش رصيد سالب) — لكن **الخاسر شاف `500`** بدل رسالة عربية
 * واضحة. السبب: `deadlock detected` (SQLSTATE `40P01`) طالع من `WalletsService.doubleEntry()`.
 *
 * ليه بيحصل deadlock رغم إن `doubleEntry()` بتقفل المحفظتين **بترتيب ثابت** (بالـ id)؟ لأن
 * الضمانة دي **لكل نداء، مش للـtransaction كلها**. transaction تسوية واحدة بتعمل أكتر من قيد
 * مزدوج على محافظ متداخلة (عميل↔منصة، وبعدين منصة↔فني)، فبتتراكم عندها أقفال بترتيب هو
 * حاصل ضرب ترتيبين مفروزين منفصلين — وده مش لازم يتوافق مع ترتيب transaction تانية بتلمس
 * نفس المحافظ من ناحية تانية (فني↔منصة مثلاً). النتيجة حلقة انتظار حقيقية.
 *
 * ## ليه إعادة المحاولة هي الحل الصح هنا (مش مجرد تسكين)
 *
 * Postgres لما بيكتشف deadlock بيقتل واحدة من الاتنين ويعمل لها **rollback كامل** — مفيش أي
 * أثر جزئي متسرّب. يعني إعادة تشغيل الدالة من أولها آمنة بالتعريف: هي بتبدأ من نفس الحالة
 * اللي بدأت منها. ودي الوصفة القياسية اللي بتوصي بيها وثائق Postgres نفسها لأي كود بيمسك
 * أقفال متعددة.
 *
 * البديل — إعادة هيكلة كل مسار تسوية عشان يقفل **كل** محافظه مقدّمًا في نداء واحد مفروز —
 * أنضف نظريًا لكنه تغيير واسع في مسار مالي حسّاس. الحمايتين مش بديلين: الترتيب الثابت جوّه
 * `doubleEntry()` بيقلّل احتمال التعارض، وده بيمنع التعارض النادر الباقي من إنه يوصل للعميل.
 *
 * ## اللي **مش** بيتعاد
 *
 * أي خطأ تاني بيتصاعد فورًا زي ما هو. بنعيد بس `40P01` (deadlock) و`40001`
 * (serialization_failure) — الاتنين معناهم بالتعريف «مفيش أي أثر اتكتب، حاول تاني».
 */

const RETRYABLE_SQLSTATES = new Set(['40P01', '40001']);
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 25;

const logger = new Logger('TransactionRetry');

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown; driverError?: { code?: unknown } } | null)?.code
    ?? (error as { driverError?: { code?: unknown } } | null)?.driverError?.code;
  return typeof code === 'string' ? code : undefined;
}

export function isRetryableTransactionConflict(error: unknown): boolean {
  const state = sqlState(error);
  return state !== undefined && RETRYABLE_SQLSTATES.has(state);
}

/**
 * `label` بيظهر في اللوج بس — بيخلّي تكرار التعارض على مسار معيّن قابل للملاحظة بدل ما
 * يفضل مخفي وراء إعادة محاولة صامتة.
 */
export async function withTransactionRetry<T>(
  label: string,
  run: () => Promise<T>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableTransactionConflict(error)) throw error;
      // تأخير عشوائي صغير: من غيره المحاولتين بيرجعوا يتصادموا بنفس التوقيت بالظبط.
      const delayMs = BASE_BACKOFF_MS * attempt + Math.floor(Math.random() * BASE_BACKOFF_MS);
      logger.warn(
        `تعارض تزامن (${sqlState(error)}) في ${label} — المحاولة ${attempt}/${maxAttempts}، إعادة بعد ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
