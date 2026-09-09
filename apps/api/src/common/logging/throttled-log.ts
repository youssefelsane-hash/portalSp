/**
 * **مانع طوفان اللوج** — قياس حي من تدقيق ج-٦ (2026-09-09).
 *
 * القياس: أثناء انقطاع Redis، ملف لوج الـAPI وصل **٢.١ چيجابايت في ١٨ دقيقة**. السبب مش خطأ
 * واحد — كل أمر Redis فاشل بيولّد `unhandledRejection` («Connection is closed.») بـstack كامل،
 * وكل واحد بيتطبع سطر. مع عشرات الأوامر في الثانية، اللوج بيكبر بمئات الميجابايت في الدقيقة.
 *
 * **ليه ده كارثة مش إزعاج**: امتلاء القرص بيوقف Postgres (WAL) ورفع الملفات والـAPI نفسه — يعني
 * انقطاع Redis (اللي النظام مصمَّم يعيش من غيره أصلاً، وقياس ج-٦ أثبت إنه بيعيش) بيتحوّل بسبب
 * **اللوج بس** لانقطاع خدمة كامل. ده بالظبط عكس قاعدة المالك: «ضعيف بطيء ماشي، بس ما يقعش».
 *
 * الحل: نفس الرسالة المتكررة تتطبع **أول مرة فورًا**، وبعدها تتكتم لنافذة زمنية، وفي آخر النافذة
 * يتطبع سطر واحد بيقول اتكررت كام مرة. المعلومة التشخيصية بتفضل كاملة (أول ظهور + العدد)،
 * والحجم بيفضل ثابت مهما طال الانقطاع.
 */

const DEFAULT_WINDOW_MS = 60_000;

interface WindowState {
  /** آخر مرة اتطبع فيها سطر لهذه الرسالة. */
  lastLoggedAt: number;
  /** المكتوم من ساعتها. */
  suppressed: number;
}

const windows = new Map<string, WindowState>();

/**
 * بيرجّع `null` لو الرسالة دي مكتومة دلوقتي، أو **النص اللي المفروض يتطبع** (ممكن يبقى النص
 * الأصلي، أو النص + لاحقة بتقول كام واحدة اتكتمت في النافذة اللي فاتت).
 */
export function throttleMessage(key: string, message: string, windowMs = DEFAULT_WINDOW_MS): string | null {
  const now = Date.now();
  const state = windows.get(key);

  if (!state || now - state.lastLoggedAt >= windowMs) {
    const suffix =
      state && state.suppressed > 0
        ? ` [اتكتمت ${state.suppressed} رسالة مطابقة خلال آخر ${Math.round(windowMs / 1000)} ثانية]`
        : '';
    windows.set(key, { lastLoggedAt: now, suppressed: 0 });
    return `${message}${suffix}`;
  }

  state.suppressed += 1;
  return null;
}

/** توقيع مستقر لأي سبب rejection — الرسالة بس، من غير الـstack (اللي بيختلف كل مرة). */
export function reasonSignature(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason)?.slice(0, 200) ?? 'unknown';
  } catch {
    return 'unserializable';
  }
}

/** للاختبارات بس — بيصفّر النوافذ عشان كل حالة تبدأ من نضيف. */
export function resetThrottleWindows(): void {
  windows.clear();
}
