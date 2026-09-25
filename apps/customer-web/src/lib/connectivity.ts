/**
 * **حالة الاتصال كحقيقة واحدة** (طلب مالك 2026-09-25: «مفيش إنترنت» و«السيرفر مش متاح»).
 *
 * قبل ده كل شاشة كانت تكتشف لوحدها إن النداء فشل، وتعرض (أو ماتعرضش) رسالة بشكلها الخاص. النتيجة
 * إن المستخدم اللي الإنترنت قطع عنده يشوف رسائل مختلفة في كل صفحة — أو مايشوفش حاجة ويفضل قاعد
 * على مؤشر تحميل بيلف.
 *
 * ### ليه اتنين حالتين منفصلتين
 *
 * «مفيش إنترنت» و«مش واصلين للسيرفر» سببهم مختلف وحل المستخدم فيهم مختلف: الأولى بيحلها هو
 * (واي فاي/بيانات)، والتانية مالوش فيها حاجة غير الانتظار. خلطهم في رسالة واحدة بيخلّي واحدة
 * منهم كذب.
 *
 * `navigator.onLine` وحده **مش كفاية**: بيرجّع `true` على شبكة متصلة بلا إنترنت فعلي (فندق،
 * captive portal) — وده أشهر شكل للحالة دي. فالإشارة الحقيقية هي فشل النداءات نفسها.
 */

export type ConnectivityStatus = 'ok' | 'offline' | 'server-unreachable';

/** عدد الفشل المتتالي قبل ما نقول «السيرفر مش متاح» — نداء واحد فاشل ممكن يكون حادث فردي. */
const FAILURES_BEFORE_ALERT = 2;

let consecutiveFailures = 0;
const listeners = new Set<(status: ConnectivityStatus) => void>();

function current(): ConnectivityStatus {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return consecutiveFailures >= FAILURES_BEFORE_ALERT ? 'server-unreachable' : 'ok';
}

function publish(): void {
  const status = current();
  for (const listener of listeners) listener(status);
}

export function notifyNetworkFailure(): void {
  consecutiveFailures += 1;
  publish();
}

/** أي نداء ناجح بيصفّر العدّاد فورًا — الشريط بيختفي من غير ما المستخدم يعمل حاجة. */
export function notifyNetworkSuccess(): void {
  if (consecutiveFailures === 0) return;
  consecutiveFailures = 0;
  publish();
}

export function subscribeConnectivity(listener: (status: ConnectivityStatus) => void): () => void {
  listeners.add(listener);
  listener(current());
  if (typeof window !== 'undefined') {
    window.addEventListener('online', publish);
    window.addEventListener('offline', publish);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined' && listeners.size === 0) {
      window.removeEventListener('online', publish);
      window.removeEventListener('offline', publish);
    }
  };
}
