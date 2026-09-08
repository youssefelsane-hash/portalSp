'use client';

/**
 * تتبّع رحلة الحجز من المتصفح (ADR-0081 §3، إحصائيات-٦).
 *
 * ## المشكلة اللي الملف ده بيحلّها
 *
 * السيرفر بيسجّل المراحل اللي ليها نداء حقيقي (السعر، الفنيين، تأكيد الطلب). بس «فتح صفحة
 * الخدمة» و«ضغط احجز» بيحصلوا **جوّه المتصفح من غير أي نداء**، فمن غير التسجيل ده أول رقم في
 * الفنل بيبقى «شاف السعر» — والسؤال «كام حد فتح الصفحة وما كمّلش؟» يفضل بلا إجابة.
 *
 * ## معرّف المحاولة
 *
 * UUID واحد لكل محاولة حجز، عايش في `sessionStorage` (مش `localStorage`): المحاولة بتخلص بقفل
 * التاب. لو استخدمنا `localStorage` كانت زيارتين مختلفتين بأيام هيبقى ليهم نفس المعرّف،
 * والتسرّب بين المراحل يتحسب غلط.
 *
 * **مش معرّف تتبّع للشخص**: مالوش أي علاقة بهوية المستخدم، وبيتولد من جديد كل تاب. الغرض
 * الوحيد إننا نربط خطوات **نفس المحاولة** ببعض.
 */

const SESSION_KEY = 'baytak_funnel_session';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

/** المراحل اللي السيرفر بيقبلها من الكلاينت — الباقي بيتسجّل سيرفر-سايد. */
export type ClientFunnelStage = 'service_viewed' | 'booking_started';

function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // متصفح قديم أو سياق مش آمن (http على IP): بنولّد UUIDv4 يدوي بدل ما نرمي — التتبّع
  // مايستاهلش يكسر الصفحة.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * معرّف المحاولة الحالي — بيتولد أول مرة بس.
 *
 * بيرجّع `null` على السيرفر (SSR): مفيش `sessionStorage` هناك، ومحاولة القراءة كانت هترمي.
 */
export function getFunnelSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = randomUuid();
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // تخزين متوقّف (وضع خاص/إعدادات صارمة) — بنكمّل بلا معرّف. الحدث هيتسجّل ويدخل في عدّاد
    // المرحلة، بس مش في حساب التسرّب. أحسن من إننا نكسر الصفحة عشان إحصائية.
    return null;
  }
}

/** الهيدر اللي بيربط أي نداء API بمحاولة الحجز — بيتحط على كل نداء في `api-client`. */
export function funnelHeaders(): Record<string, string> {
  const id = getFunnelSessionId();
  return id ? { 'x-funnel-session': id } : {};
}

/**
 * تسجيل مرحلة من الكلاينت. **مابيرميش أبدًا ومابيتستنّاش**: الشاشة ماينفعش تتأخر ولا تقع
 * عشان رقم في تقرير. أسوأ نتيجة ممكنة هنا حدث ضايع.
 */
export function trackFunnelStage(
  stage: ClientFunnelStage,
  payload: { service_id?: string; city_id?: string } = {},
): void {
  if (typeof window === 'undefined') return;
  void fetch(`${API_URL}/analytics/funnel-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...funnelHeaders() },
    body: JSON.stringify({ stage, channel: 'web', ...payload }),
    // `keepalive` عشان الحدث يوصل حتى لو المستخدم قفل التاب أو انتقل بره في نفس اللحظة —
    // من غيرها «شاف الخدمة وخرج» (وهو بالظبط التسرّب اللي بندوّر عليه) بيضيع أكتر ما يتسجّل.
    keepalive: true,
  }).catch(() => {
    // متعمّد: الفشل مالوش أي أثر على المستخدم.
  });
}
